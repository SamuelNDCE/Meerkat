// Coordination: who has claimed which paths, and a clean way to open and close worktrees.
//   meerkat claim <path...> --by <name> [--ttl 4h]    record a claim; refused when another name holds an overlapping live claim
//   meerkat claims [--json]                           every live claim; expired ones are removed on read
//   meerkat release <path...> [--by <name>] [--force] remove claims
//   meerkat worktrees [--json]                        each worktree with branch, claims, uncommitted count, clean and merged state
//   meerkat worktrees close <path> [--yes]            remove a clean, merged worktree (never --force) and its claims
// Claims live in the git common directory (meerkat-claims.json), so every worktree of one repository sees the same claims and nothing is committed.
// Every write takes a lock file (opened with 'wx'): 10 second timeout, a lock older than 60 seconds is stale and removed. The working tree is never read for claims.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { setProgress, gather, git, norm, closeProblem, removeWorktree, isClean } from './worktrees.mjs'

const LOCK_TIMEOUT_MS = 10000
const LOCK_STALE_MS = 60000
const DEFAULT_TTL = '4h'

// ---- paths ----

// A repo-relative path with forward slashes. Returns null for a path outside the repository or an empty one.
export function normalizePath(p, base, top) {
  let s = String(p ?? '').trim().replace(/\\/g, '/')
  if (!s) return null
  const abs = isAbsolute(s) || /^[a-zA-Z]:\//.test(s) ? resolve(s) : resolve(base, s)
  let rel = relative(top, abs).replace(/\\/g, '/')
  if (rel === '') return '.'
  if (rel === '..' || rel.startsWith('../') || /^[a-zA-Z]:/.test(rel)) return null
  return rel.replace(/\/+$/, '')
}

// "a/b" overlaps "a" and "a/b/c"; "a-b" does not overlap "a". "." is the whole repository.
export function overlaps(a, b) {
  if (a === '.' || b === '.') return true
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function parseTtl(text) {
  const m = /^(\d+)\s*(s|m|h|d)$/i.exec(String(text ?? DEFAULT_TTL).trim())
  if (!m || Number(m[1]) <= 0) return null
  return Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()]
}

export function timeLeft(ms) {
  if (ms <= 0) return 'expired'
  const m = Math.ceil(ms / 60000)
  if (m < 60) return `${m}m left`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m left`
}

// ---- storage ----

export function locate(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return { error: `not a git repository: ${top.err || cwd}` }
  const common = git(cwd, ['rev-parse', '--git-common-dir'])
  if (!common.ok) return { error: `cannot find the git directory: ${common.err}` }
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const gitDir = resolve(top.out, common.out)
  return { top: top.out, gitDir, file: join(gitDir, 'meerkat-claims.json'), branch: branch.ok ? branch.out : null }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

export function withLock(file, fn, { timeoutMs = LOCK_TIMEOUT_MS, staleMs = LOCK_STALE_MS } = {}) {
  const lock = `${file}.lock`
  mkdirSync(dirname(file), { recursive: true })
  const start = Date.now()
  for (;;) {
    try {
      const fd = openSync(lock, 'wx')
      writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`)
      closeSync(fd)
      break
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs) {
          unlinkSync(lock)
          continue
        }
      } catch { /* the holder just released it */ }
      if (Date.now() - start > timeoutMs) throw new Error(`could not take the claims lock within ${timeoutMs / 1000}s (${lock}). If no meerkat command is running, delete that file`)
      sleep(40)
    }
  }
  try {
    return fn()
  } finally {
    try { unlinkSync(lock) } catch { /* already gone */ }
  }
}

function load(file) {
  if (!existsSync(file)) return { version: 1, claims: [] }
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'))
    return { version: 1, claims: Array.isArray(d?.claims) ? d.claims.filter((c) => c && typeof c.owner === 'string' && Array.isArray(c.paths)) : [] }
  } catch {
    return { version: 1, claims: [] }
  }
}

function save(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(tmp, file)
}

// Splits a document into live and expired claims.
function prune(data, now) {
  const live = data.claims.filter((c) => c.expires > now)
  return { live, expired: data.claims.filter((c) => c.expires <= now) }
}

const iso = (ms) => new Date(ms).toISOString()
const describeClaim = (c, now) => `${c.owner}: ${c.paths.join(', ')} (${c.branch ?? 'no branch'}, ${c.worktree ?? '?'}, ${timeLeft(c.expires - now)})`

// ---- argument parsing ----

function parse(args, valued, boolean) {
  const words = []
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i])
    if (a === '--') { words.push(...args.slice(i + 1)); break }
    if (!a.startsWith('--')) { words.push(a); continue }
    const name = a.slice(2)
    if (valued.includes(name)) {
      const v = args[i + 1]
      if (v === undefined || String(v).startsWith('--')) return { error: `--${name} needs a value` }
      flags[name] = String(v)
      i++
    } else if (boolean.includes(name)) flags[name] = true
    else return { error: `unknown option ${a.replace(/[\u0000-\u001f]/g, '?')}` }
  }
  return { words, flags }
}

const usageErr = (err, text) => { err(text); return 2 }

// ---- commands ----

export function runClaim(args, { env = process.env, cwd = process.cwd(), out = console.log, err = console.error, now = Date.now() } = {}) {
  const use = 'usage: meerkat claim <path...> --by <name> [--ttl 4h]'
  const p = parse(args, ['by', 'ttl'], ['json'])
  if (p.error) return usageErr(err, `meerkat claim: ${p.error}\n${use}`)
  const by = (p.flags.by ?? env.MEERKAT_CLAIM_BY ?? '').trim()
  if (!p.words.length || !by) return usageErr(err, `meerkat claim: say the paths and who you are\n${use}`)
  const ttl = parseTtl(p.flags.ttl ?? DEFAULT_TTL)
  if (ttl === null) return usageErr(err, `meerkat claim: --ttl must look like 30m, 4h or 1d\n${use}`)
  const loc = locate(cwd)
  if (loc.error) return usageErr(err, `meerkat claim: ${loc.error}`)
  const paths = []
  for (const w of p.words) {
    const n = normalizePath(w, cwd, loc.top)
    if (!n) return usageErr(err, `meerkat claim: "${w}" is outside this repository`)
    if (!paths.includes(n)) paths.push(n)
  }
  return withLock(loc.file, () => {
    const data = load(loc.file)
    const { live } = prune(data, now)
    const conflicts = []
    for (const path of paths) for (const c of live) if (c.owner !== by) for (const cp of c.paths) if (overlaps(path, cp)) conflicts.push({ path, claim: c, held: cp })
    if (conflicts.length) {
      for (const { path, claim, held } of conflicts) {
        err(`refused: ${path} overlaps ${held}, held by ${claim.owner} (paths: ${claim.paths.join(', ')}, ${timeLeft(claim.expires - now)})`)
        err(`claimed by ${claim.owner} until ${iso(claim.expires)}. Wait, or ask them to: meerkat release ${held}`)
      }
      if (live.length !== data.claims.length) save(loc.file, { version: 1, claims: live })
      return 1
    }
    const expires = now + ttl
    const worktree = loc.top
    const mine = live.find((c) => c.owner === by && norm(c.worktree ?? '') === norm(worktree))
    if (mine) {
      for (const path of paths) if (!mine.paths.includes(path)) mine.paths.push(path)
      mine.expires = Math.max(mine.expires, expires)
      mine.branch = loc.branch
    } else live.push({ owner: by, paths, branch: loc.branch, worktree, created: now, expires })
    save(loc.file, { version: 1, claims: live })
    out(`claimed ${paths.join(', ')} for ${by} until ${iso(expires)} (${timeLeft(ttl)})`)
    return 0
  })
}

export function runClaims(args, { cwd = process.cwd(), out = console.log, err = console.error, now = Date.now() } = {}) {
  const p = parse(args, [], ['json'])
  if (p.error || p.words.length) return usageErr(err, `meerkat claims: ${p.error ?? 'no arguments expected'}\nusage: meerkat claims [--json]`)
  const loc = locate(cwd)
  if (loc.error) return usageErr(err, `meerkat claims: ${loc.error}`)
  const { live, expired } = withLock(loc.file, () => {
    const r = prune(load(loc.file), now)
    if (r.expired.length) save(loc.file, { version: 1, claims: r.live })
    return r
  })
  if (p.flags.json) {
    out(JSON.stringify({ claims: live.map((c) => ({ ...c, expiresAt: iso(c.expires), secondsLeft: Math.round((c.expires - now) / 1000) })), expired: expired.map((c) => ({ ...c, expiresAt: iso(c.expires) })) }, null, 2))
    return 0
  }
  if (!live.length && !expired.length) out('no claims')
  for (const c of live) out(describeClaim(c, now))
  for (const c of expired) out(`${c.owner}: ${c.paths.join(', ')} (expired, removed)`)
  return 0
}

export function runRelease(args, { env = process.env, cwd = process.cwd(), out = console.log, err = console.error, now = Date.now() } = {}) {
  const use = 'usage: meerkat release <path...> [--by <name>] [--force]'
  const p = parse(args, ['by'], ['force'])
  if (p.error) return usageErr(err, `meerkat release: ${p.error}\n${use}`)
  if (!p.words.length) return usageErr(err, `meerkat release: say which paths\n${use}`)
  const by = (p.flags.by ?? env.MEERKAT_CLAIM_BY ?? '').trim() || null
  const loc = locate(cwd)
  if (loc.error) return usageErr(err, `meerkat release: ${loc.error}`)
  const paths = []
  for (const w of p.words) {
    const n = normalizePath(w, cwd, loc.top)
    if (!n) return usageErr(err, `meerkat release: "${w}" is outside this repository`)
    paths.push(n)
  }
  return withLock(loc.file, () => {
    const { live } = prune(load(loc.file), now)
    let code = 0
    for (const path of paths) {
      const holders = live.filter((c) => c.paths.includes(path))
      if (!holders.length) { err(`no claim on ${path}`); code = 1; continue }
      for (const c of holders) {
        if (by && c.owner !== by && !p.flags.force) {
          err(`refused: ${path} is claimed by ${c.owner}, not ${by}. Use --force to release another name's claim`)
          code = 1
          continue
        }
        c.paths = c.paths.filter((x) => x !== path)
        out(`released ${path} (was ${c.owner}${by && c.owner !== by ? ', forced' : ''})`)
      }
    }
    save(loc.file, { version: 1, claims: live.filter((c) => c.paths.length) })
    return code
  })
}

function worktreeRows(cwd, now) {
  setProgress(() => {})
  const data = gather(cwd)
  const loc = locate(cwd)
  const { live } = withLock(loc.file, () => {
    const r = prune(load(loc.file), now)
    return r
  })
  const rows = data.items.map((w) => ({
    path: w.path, branch: w.branch, main: w.main, missing: !!w.missing, uncommitted: w.dirty, clean: isClean(w), merged: !!w.merged,
    claims: live.filter((c) => norm(c.worktree ?? '') === norm(w.path)).map((c) => ({ owner: c.owner, paths: c.paths, timeLeft: timeLeft(c.expires - now) })),
  }))
  return { data, rows }
}

export function runWorktrees(args, { cwd = process.cwd(), out = console.log, err = console.error, now = Date.now() } = {}) {
  const p = parse(args, [], ['json', 'yes'])
  if (p.error) return usageErr(err, `meerkat worktrees: ${p.error}\nusage: meerkat worktrees [--json] | meerkat worktrees close <path> [--yes]`)
  const [sub, ...more] = p.words
  if (sub && sub !== 'close') return usageErr(err, `meerkat worktrees: unknown action "${sub}"\nusage: meerkat worktrees [--json] | meerkat worktrees close <path> [--yes]`)
  const loc = locate(cwd)
  if (loc.error) return usageErr(err, `meerkat worktrees: ${loc.error}`)
  let view
  try { view = worktreeRows(cwd, now) } catch (e) { err(`meerkat worktrees: ${e.message}`); return 1 }
  const { data, rows } = view
  if (!sub) {
    if (p.flags.json) { out(JSON.stringify({ worktrees: rows }, null, 2)); return 0 }
    for (const r of rows) {
      const state = r.main ? 'main checkout' : r.missing ? 'missing' : `${r.clean ? 'clean' : 'dirty'}, ${r.merged ? 'merged into origin/main' : 'not merged'}`
      out(`${r.path}  |  ${r.branch ?? '(detached)'}  |  ${r.uncommitted < 0 ? '?' : r.uncommitted} uncommitted  |  ${state}`)
      out(`    claims: ${r.claims.length ? r.claims.map((c) => `${c.owner} ${c.paths.join(', ')} (${c.timeLeft})`).join('; ') : 'none'}`)
    }
    return 0
  }
  if (more.length !== 1) return usageErr(err, 'usage: meerkat worktrees close <path> [--yes]')
  const target = resolve(cwd, more[0])
  const w = data.items.find((i) => norm(i.path) === norm(target))
  const why = closeProblem(w)
  if (why) {
    err(`refused: ${more[0]}: ${why}`)
    return 1
  }
  const mainPath = data.items[0].path
  if (!p.flags.yes) {
    out(`would remove worktree ${w.path} (branch ${w.branch ?? '(detached)'}, clean, merged) and its claims. Add --yes to do it`)
    return 0
  }
  const r = removeWorktree(mainPath, w.path)
  if (!r.ok) { err(`refused by git: ${r.err || 'git worktree remove failed'}`); return 1 }
  const dropped = withLock(loc.file, () => {
    const { live } = prune(load(loc.file), now)
    const keep = live.filter((c) => norm(c.worktree ?? '') !== norm(w.path))
    save(loc.file, { version: 1, claims: keep })
    return live.length - keep.length
  })
  out(`removed worktree ${w.path} and ${dropped} claim(s)`)
  return 0
}
