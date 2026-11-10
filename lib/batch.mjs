// `meerkat batch --base <ref> --app <repo> <branch1> <branch2> ...`: gate several branches together in ONE temporary integration checkout.
// Merge the branches in order onto the base, gate the union diff once, and only when that fails find the culprit (one run per branch alone).
// Never touches the user's checkouts: every merge and every gate run happens in a temporary git worktree that is removed at the end.
// Unknown, skipped, timed out or unfinished is INCOMPLETE (exit 75), never PASS.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { runVerdict } from './branchcmds.mjs'
import { dataDir } from './datadir.mjs'

export const BATCH_SCHEMA = 1
// Chosen from a real team's largest batch (about 1,700 lines), so 3,000 lines and 15 PRs leave room. Both are overridable (--max-lines, --max-prs).
export const DEFAULT_MAX_LINES = 3000
export const DEFAULT_MAX_PRS = 15
export const DEFAULT_MAX_RUNS = 12
export const EXIT_BLOCKED = 1
export const EXIT_USAGE = 2
export const EXIT_INCOMPLETE = 75

const NL = String.fromCharCode(10)
const git = (dir, args) => spawnSync('git', ['-C', dir, '-c', 'user.name=meerkat-batch', '-c', 'user.email=meerkat-batch@localhost', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const firstLine = (t) => String(t ?? '').split(NL)[0].trim().slice(0, 160)

// ---- pure functions ------------------------------------------------------------------------------------------------------------------

// { base, app, branches, dryRun, json, maxLines, maxPrs } or { error }. Branches may be comma or space separated.
export function parseBatchArgs(argv) {
  const o = { base: null, app: null, branches: [], dryRun: false, json: false, maxLines: DEFAULT_MAX_LINES, maxPrs: DEFAULT_MAX_PRS }
  const num = (name, v) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 1) return { error: `${name} needs a whole number, 1 or more` }
    return { n }
  }
  const names = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') o.base = argv[++i] ?? ''
    else if (a === '--app') o.app = argv[++i] ?? ''
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--json') o.json = true
    else if (a === '--max-lines' || a === '--max-prs') {
      const r = num(a, argv[++i])
      if (r.error) return r
      if (a === '--max-lines') o.maxLines = r.n
      else o.maxPrs = r.n
    } else if (a.startsWith('-')) return { error: `unknown option ${a}` }
    else names.push(...a.split(',').map((x) => x.trim()).filter(Boolean))
  }
  if (o.base === '') return { error: '--base needs a ref' }
  if (o.app === '') return { error: '--app needs a folder' }
  o.branches = [...new Set(names)]
  if (!o.branches.length) return { error: 'name at least one branch' }
  return o
}

// Splits the branch facts into included and excluded. Input: [{ branch, sha|null, lines|null }]. Order is kept; a branch over the line limit,
// not found, or past the PR cap is excluded with its reason.
export function planBatch(items, { maxLines = DEFAULT_MAX_LINES, maxPrs = DEFAULT_MAX_PRS } = {}) {
  const included = []
  const excluded = []
  for (const it of items) {
    if (!it.sha) excluded.push({ ...it, reason: 'not found' })
    else if (it.lines === null || it.lines === undefined) excluded.push({ ...it, reason: 'could not measure the size of the change' })
    else if (it.lines > maxLines) excluded.push({ ...it, reason: `too big (${it.lines} changed lines, limit ${maxLines})` })
    else if (included.length >= maxPrs) excluded.push({ ...it, reason: `too many branches in one batch (limit ${maxPrs})` })
    else included.push(it)
  }
  return { included, excluded }
}

// The failing checks of a gate result: [{ check, file, line }]. A check with no place still counts, with file null.
export function failingChecks(res) {
  const list = []
  for (const row of res?.checks ?? []) {
    if (row.status !== 'fail' && row.status !== 'crash') continue
    const p = row.places?.[0]
    list.push({ check: row.check, file: p?.file ?? null, line: p?.line ?? null, detail: firstLine(row.detail) })
  }
  return list
}

// Exit code from the final statuses. BLOCKED wins (1), then anything unknown (75); 0 only when every included PR is PASS or MERGEABLE.
export function exitCodeFor(prs) {
  if (prs.some((p) => p.status === 'BLOCKED')) return EXIT_BLOCKED
  if (prs.some((p) => p.status === 'INCOMPLETE' || p.status === 'STALE')) return EXIT_INCOMPLETE
  const included = prs.filter((p) => p.status === 'PASS' || p.status === 'MERGEABLE')
  if (!included.length) return EXIT_INCOMPLETE // nothing was judged: not a pass
  return 0
}

export function newBatchId(now = new Date()) {
  return `batch-${now.toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}-${randomBytes(3).toString('hex')}`
}

// Atomic: temp file in the same folder, then rename.
export function writeResultAtomic(file, doc) {
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}${NL}`)
  renameSync(tmp, file)
}


// How many per-branch gates run at once: MEERKAT_JOBS (the gate's own setting) when set, else max(2, min(4, cpus - 1)). 1 means one after another.
export function batchJobs(env = process.env, cpuCount = cpus().length) {
  // Same rule as the gate's MEERKAT_JOBS (lib/runner.mjs): a whole number 1 or more, capped at 64; anything else is ignored.
  const n = Number(env?.MEERKAT_JOBS)
  if (Number.isInteger(n) && n >= 1) return Math.min(n, 64)
  return Math.max(2, Math.min(4, cpuCount - 1))
}

// Runs fn(item, index) for every item with at most `limit` in flight; results come back in INPUT order, so the output is stable.
export async function poolMap(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

const norm = (f) => String(f ?? '').split(String.fromCharCode(92)).join('/').replace(/^\.\//, '')

// The files a failed gate result points at, or null when any failing check names no place (then nothing can be ruled out).
export function failingFiles(res, sub = '') {
  const files = new Set()
  let any = false
  for (const row of res?.checks ?? []) {
    if (row.status !== 'fail' && row.status !== 'crash') continue
    any = true
    const places = (row.places ?? []).filter((p) => p?.file)
    if (!places.length) return null
    for (const p of places) {
      files.add(norm(p.file))
      if (sub) files.add(norm(`${sub}/${p.file}`))
    }
  }
  return any ? files : null
}

// ---- gate and dev-baseline adapters ---------------------------------------------------------------------------------------------------

// The real gate: the verdict (lib/branchcmds.mjs) in a checkout, compared with `base`, as JSON. Returns { code, verdict, checks, reason }.
export async function verdictGate(dir, { base, only = null, env = process.env, strict = false, err = () => {} } = {}) {
  const lines = []
  const argv = ['--json', '--base', base, '--allow-stale', ...(strict ? ['--strict'] : []), ...(only?.length ? ['--only-checks', only.join(',')] : [])]
  let code
  try {
    // The gate's own progress and lock-wait lines reach the person (were swallowed before, so a batch looked stuck).
    code = await runVerdict(argv, { env, cwd: dir, out: (t) => lines.push(t), err: (t) => err(`[batch gate] ${t}`), memory: false })
  } catch (e) {
    return { code: EXIT_INCOMPLETE, verdict: 'INCOMPLETE', checks: [], reason: `the gate crashed (${firstLine(e?.message ?? e)})` }
  }
  let doc = null
  try {
    doc = JSON.parse(lines.join(NL))
  } catch {
    /* handled below */
  }
  if (!doc) return { code: EXIT_INCOMPLETE, verdict: 'INCOMPLETE', checks: [], reason: firstLine(lines[0]) || 'the gate printed no result' }
  return { code: doc.exitCode ?? code, verdict: doc.verdict, checks: doc.checks ?? [], reason: doc.reason ?? '', checksTotal: doc.checksTotal, checksFinished: doc.checksFinished, skippedByPath: Array.isArray(doc.skippedByPath) ? doc.skippedByPath : [] }
}

// The dev baseline. Uses devBaselineFor(repoRoot, base, checkId) from lib/devbaseline.mjs when that module exists (resolves to true/false or
// { fails } / { failing }); otherwise the fallback in this file runs the check on the base in the batch's temp checkout.
let realBaseline // undefined = not looked up yet, null = module missing
export async function loadRealBaseline() {
  if (realBaseline !== undefined) return realBaseline
  try {
    const m = await import('./devbaseline.mjs')
    realBaseline = typeof m.devBaselineFor === 'function' ? m.devBaselineFor : null
  } catch {
    realBaseline = null
  }
  return realBaseline
}
const asFails = (v) => (v === null || v === undefined ? null : typeof v === 'boolean' ? v : typeof v === 'object' ? (v.fails ?? v.failing ?? v.failed ?? null) : null)

// Fallback: the base itself has no diff to judge, so a temp commit appends a newline to the files the branch changed (that exist on the base),
// then the verdict runs with --strict (pre-existing findings count) on only the named checks. A failing row on the base = the check fails there too.
async function fallbackBaseline(ctx, files, ids) {
  const co = makeCheckout(ctx.root, ctx.baseSha, ctx.sub)
  ctx.cleanups.push(co.cleanup)
  const touched = files.filter((f) => existsSync(join(co.wt, f)))
  if (!touched.length) return Object.fromEntries(ids.map((id) => [id, null]))
  for (const f of touched) appendFileSync(join(co.wt, f), NL)
  git(co.wt, ['commit', '-q', '-a', '-m', 'meerkat batch: touch files for the base check'])
  const res = await ctx.gate(co.dir, { base: ctx.baseSha, only: ids, env: ctx.env, strict: true })
  if (!res || res.verdict === 'NO-RESULT' || res.verdict === 'INCOMPLETE') return Object.fromEntries(ids.map((id) => [id, null]))
  const rows = res.checks ?? []
  return Object.fromEntries(ids.map((id) => [id, rows.some((r) => r.check === id && (r.status === 'fail' || r.status === 'crash' || r.status === 'wide'))]))
}

// { [checkId]: true | false | null } (null = unknown). Counts as ONE run for the fallback.
async function baselineFor(ctx, ids, files) {
  // A baseline passed in by the caller (a test seam) answers one check at a time, as before.
  if (typeof ctx.devBaseline === 'function') {
    const out = {}
    for (const id of ids) {
      try {
        out[id] = asFails(await ctx.devBaseline(ctx.root, ctx.baseSha, id))
      } catch {
        out[id] = null
      }
    }
    return { fails: out, source: 'devbaseline', stored: null }
  }
  const real = ctx.devBaseline === undefined ? await loadRealBaseline() : null
  if (real) {
    // The real store (lib/devbaseline.mjs) takes the whole id list and a runChecks callback; it runs only the ids it does not already hold for this base sha.
    const runChecks = async (checkIds) => {
      const co = makeCheckout(ctx.root, ctx.baseSha, ctx.sub)
      ctx.cleanups.push(co.cleanup)
      const res = await ctx.gate(co.dir, { base: ctx.baseSha, only: checkIds, env: ctx.env, strict: true })
      const rows = res?.checks ?? []
      // 'notrun' (kept as a no-answer for this base sha) only when the gate really finished and the check had no row; a crashed or unfinished gate is 'unknown' and is re-run.
      const finished = !!res && res.verdict !== 'NO-RESULT' && res.verdict !== 'INCOMPLETE' && (res.code === 0 || res.code === 1)
      const out = {}
      for (const id of checkIds) {
        const r = rows.find((x) => x.check === id)
        out[id] = !r ? (finished ? 'notrun' : 'unknown') : r.status === 'pass' ? 'pass' : r.status === 'fail' || r.status === 'crash' || r.status === 'wide' ? 'fail' : 'unknown'
      }
      return out
    }
    let doc = null
    try {
      doc = await real(ctx.root, ctx.baseSha, ids, { dataDir: dataDir(ctx.env), runChecks })
    } catch {
      doc = null
    }
    const out = {}
    for (const id of ids) {
      const st = doc?.checks?.[id]
      out[id] = st === 'fail' ? true : st === 'pass' ? false : null
    }
    return { fails: out, source: 'devbaseline', stored: doc ? doc.source === 'stored' : null, sha: doc?.sha ?? null }
  }
  if (!ctx.takeRun()) return { fails: Object.fromEntries(ids.map((id) => [id, null])), source: 'fallback', capped: true }
  return { fails: await fallbackBaseline(ctx, files, ids), source: 'fallback' }
}

// ---- git checkouts -------------------------------------------------------------------------------------------------------------------

function makeCheckout(root, sha, sub) {
  const tmp = mkdtempSync(join(tmpdir(), 'meerkat-batch-'))
  const wt = join(tmp, 'wt')
  const add = git(root, ['worktree', 'add', '--detach', '--force', wt, sha])
  if (add.status !== 0) {
    rmSync(tmp, { recursive: true, force: true })
    throw new Error(`could not create a temporary checkout (${firstLine(add.stderr)})`)
  }
  for (const rel of new Set(['', sub])) {
    const nm = join(root, rel, 'node_modules')
    const target = join(wt, rel, 'node_modules')
    if (existsSync(nm) && !existsSync(target)) {
      try {
        symlinkSync(nm, target, 'junction')
      } catch {
        /* a missing link only means a tool reports it is not installed */
      }
    }
  }
  const cleanup = () => {
    git(root, ['worktree', 'remove', '--force', wt])
    git(root, ['worktree', 'prune'])
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  return { wt, dir: join(wt, sub), cleanup }
}

// Merges each item (by sha) in order. Returns { co, merged, conflicts: [{ item, detail }] }. A conflicting merge is aborted and the branch left out.
function buildBatch(ctx, items) {
  const co = makeCheckout(ctx.root, ctx.baseSha, ctx.sub)
  ctx.cleanups.push(co.cleanup)
  const merged = []
  const conflicts = []
  for (const it of items) {
    const m = git(co.wt, ['merge', '--no-ff', '--no-edit', '-q', it.sha])
    if (m.status === 0) merged.push(it)
    else {
      git(co.wt, ['merge', '--abort'])
      git(co.wt, ['reset', '-q', '--hard', 'HEAD'])
      conflicts.push({ item: it, detail: firstLine(m.stdout) || firstLine(m.stderr) })
    }
  }
  return { co, merged, conflicts, head: git(co.wt, ['rev-parse', 'HEAD']).stdout.trim() }
}

function changedFiles(root, baseSha, sha) {
  const r = git(root, ['diff', '--name-only', `${baseSha}...${sha}`])
  return r.status === 0 ? r.stdout.split(NL).map((l) => l.trim()).filter(Boolean) : []
}

// Changed lines of one branch against the base: additions plus deletions (the diff a gate reads, and what the cap uses).
// additions is the additions-only count, which GitHub shows as +N. Both are printed so the two sources can be compared.
function changedLines(root, baseSha, sha) {
  const r = git(root, ['diff', '--numstat', `${baseSha}...${sha}`])
  if (r.status !== 0) return null
  let n = 0
  let additions = 0
  for (const l of r.stdout.split(NL)) {
    const [a, d] = l.split('\t')
    if (!l.trim()) continue
    additions += a === '-' ? 0 : Number(a)
    n += (a === '-' ? 0 : Number(a)) + (d === '-' ? 0 : Number(d)) // a binary file counts as 0 lines
  }
  return { lines: n, additions }
}

// ---- the batch -----------------------------------------------------------------------------------------------------------------------

// Core: returns { doc, code, lines } and writes nothing. opts.gate(dir, { base, only, env }) and opts.devBaseline may be injected (tests).
export async function runBatchCore(opts, { env = process.env, cwd = process.cwd(), err = () => {}, gate = verdictGate, devBaseline } = {}) {
  const timing = { startedAt: new Date().toISOString(), totalSeconds: null, gateSeconds: null }
  let batchSkipped = []
  const tAll = Date.now()
  const lines = []
  const say = (t) => lines.push(t)
  const startDir = resolve(cwd, opts.app ?? '.')
  const top = git(startDir, ['rev-parse', '--show-toplevel'])
  if (top.status !== 0) return { fatal: 'not inside a git work tree. next: run it inside a git repository, or pass --app <repo>', code: EXIT_USAGE }
  const root = top.stdout.trim()
  const sub = relative(root, startDir)
  let baseRef = opts.base
  if (!baseRef) baseRef = ['main', 'master', 'origin/main', 'origin/master'].find((r) => git(root, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]).status === 0)
  const baseRes = baseRef ? git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]) : { status: 1 }
  if (baseRes.status !== 0) return { fatal: `git does not know the base ${baseRef ?? '(none found)'}. next: pass --base <ref> that exists`, code: EXIT_USAGE }
  const baseSha = baseRes.stdout.trim()

  const maxRuns = Number(env.MEERKAT_BATCH_MAX_RUNS) > 0 ? Number(env.MEERKAT_BATCH_MAX_RUNS) : DEFAULT_MAX_RUNS
  let runs = 0
  const takeRun = () => (runs < maxRuns ? ((runs += 1), true) : false)
  const cleanups = []
  const ctx = { root, sub, baseSha, env, gate, devBaseline, takeRun, cleanups }

  // Each branch is pinned to the sha it had at the start; the stale guard compares against it at the end.
  const facts = opts.branches.map((branch) => {
    const r = branch.startsWith('-') ? { status: 1 } : git(root, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`])
    const sha = r.status === 0 ? r.stdout.trim() : null
    const m = sha ? changedLines(root, baseSha, sha) : null
    return { branch, sha, lines: m ? m.lines : null, additions: m ? m.additions : null }
  })
  const plan = planBatch(facts, { maxLines: opts.maxLines, maxPrs: opts.maxPrs })
  const prs = new Map(facts.map((f) => [f.branch, { branch: f.branch, headSha: f.sha, status: 'INCOMPLETE', reason: 'not judged', failingChecks: [], culprit: null }]))
  const setPr = (branch, patch) => Object.assign(prs.get(branch), patch)
  for (const e of plan.excluded) setPr(e.branch, { status: 'EXCLUDED', reason: e.reason })

  let batchHead = null
  let note = null
  let gateRuns = 0
  let batchDevBaseline = null
  const skippedAlone = []
  try {
    const first = plan.included.length ? buildBatch(ctx, plan.included) : null
    for (const c of first?.conflicts ?? []) setPr(c.item.branch, { status: 'EXCLUDED', reason: `CONFLICT while merging into the batch${c.detail ? ` (${c.detail})` : ''}` })
    const included = first?.merged ?? []
    for (const it of included) setPr(it.branch, { reason: 'merged into batch' })
    if (opts.dryRun) {
      return { doc: null, plan: { included, excluded: [...plan.excluded.map((e) => ({ branch: e.branch, reason: e.reason })), ...(first?.conflicts ?? []).map((c) => ({ branch: c.item.branch, reason: 'CONFLICT' }))] }, code: 0, lines, baseSha, baseRef, prs }
    }
    if (!included.length) note = 'no branch could be merged into the batch, nothing was gated'
    else {
      batchHead = first.head
      // 2. the batch gate, once
      gateRuns += takeRun() ? 1 : 0
      const t0 = Date.now()
      err(`[batch] gating ${included.length} branch(es) together (one gate run for all of them) ...`)
      const res = await gate(first.co.dir, { base: baseSha, env, err })
      batchSkipped = Array.isArray(res.skippedByPath) ? res.skippedByPath : []
      timing.gateSeconds = Math.round(((Date.now() - t0) / 1000) * 10) / 10
      err(`[batch] batch gate finished in ${timing.gateSeconds} s: ${res.verdict} (${res.code})`)
      const fails = failingChecks(res)
      if (res.code === 0 && res.verdict === 'PASS') {
        for (const it of included) setPr(it.branch, { status: 'PASS', reason: 'the batch passed' })
      } else if (res.code === 1 && fails.length) {
        // 4. find the culprit: the failing checks only, once per branch alone, on that branch's own head
        const ids = [...new Set(fails.map((f) => f.check))]
        const jobs = batchJobs(env)
        // The base side and the per-branch gates do not depend on each other, so they run together (bounded by `jobs`). The per-branch gates are
        // speculative until the base answer is in: if every failing check also fails on the base (DEV-RED) their results are dropped and not counted.
        const failFiles = failingFiles(res, sub)
        const plan = included.map((it) => {
          const own = changedFiles(root, baseSha, it.sha).map(norm)
          const hit = failFiles ? own.some((f) => failFiles.has(f)) : true
          if (!hit) return { it, skip: `none of its ${own.length} changed file(s) is where the batch failed (${[...failFiles].filter((f) => !sub || !f.startsWith(`${sub}/`)).slice(0, 3).join(', ')})` }
          return { it, skip: null }
        })
        const baselineP = baselineFor(ctx, ids, [...new Set(included.flatMap((it) => changedFiles(root, baseSha, it.sha)))])
        const tasks = [{ kind: 'base' }, ...plan.map((p) => ({ kind: 'branch', ...p }))]
        let specRuns = 0
        let dev = null
        const done = await poolMap(tasks, jobs, async (t) => {
          if (t.kind === 'base') {
            dev = await baselineP
            return null
          }
          if (t.skip) return { skipped: t.skip }
          if (!takeRun()) return { limited: true }
          specRuns += 1
          err(`[batch] checking ${t.it.branch} alone ...`)
          const co = makeCheckout(root, t.it.sha, sub)
          ctx.cleanups.push(co.cleanup)
          return { alone: await gate(co.dir, { base: baseSha, only: ids, env }) }
        })
        const aloneBy = new Map(plan.map((p, i) => [p.it.branch, done[i + 1]]))
        batchDevBaseline = { source: dev.source, hit: dev.stored === true, sha: dev.sha ?? baseSha }
        const onBase = (id) => dev.fails[id] === true
        const unknownBase = ids.filter((id) => dev.fails[id] === null || dev.fails[id] === undefined)
        if (!unknownBase.length && ids.every(onBase)) {
          runs -= specRuns // the speculative per-branch gates were not needed: give their runs back
          note = `DEV-RED: every failing check (${ids.join(', ')}) also fails on the base ${baseRef}, so no branch is blamed`
          for (const it of included) setPr(it.branch, { status: 'INCOMPLETE', reason: note, failingChecks: fails.map((f) => ({ ...f, alsoFailsOnBase: true })) })
        } else {
          const culprits = []
          const unknown = []
          let bisected = false
          for (const it of included) {
            const r = aloneBy.get(it.branch)
            if (r.skipped) {
              skippedAlone.push({ branch: it.branch, reason: r.skipped })
              setPr(it.branch, { reason: `not checked alone: ${r.skipped}`, skippedAlone: true })
              continue
            }
            if (r.limited) {
              unknown.push(it)
              setPr(it.branch, { status: 'INCOMPLETE', reason: `gate run limit reached (${maxRuns}, MEERKAT_BATCH_MAX_RUNS) before this branch was checked alone` })
              continue
            }
            bisected = true
            gateRuns += 1
            const alone = r.alone
            const aloneFails = failingChecks(alone).filter((f) => ids.includes(f.check))
            if (alone.code !== 0 && alone.code !== 1) {
              unknown.push(it)
              setPr(it.branch, { status: 'INCOMPLETE', reason: `the single-branch check did not finish (${alone.reason || alone.verdict})` })
            } else if (aloneFails.length) {
              const detail = aloneFails.map((f) => ({ ...f, alsoFailsOnBase: dev.fails[f.check] === true ? true : dev.fails[f.check] === false ? false : null }))
              const own = detail.filter((f) => f.alsoFailsOnBase !== true)
              if (own.length) {
                culprits.push(it)
                const f = own[0]
                setPr(it.branch, { status: 'BLOCKED', reason: `culprit: ${f.check} fails on this branch alone${f.file ? ` at ${f.file}${f.line ? ':' + f.line : ''}` : ''}${f.detail ? `: ${f.detail}` : ''}`, failingChecks: detail, culprit: true })
              } else setPr(it.branch, { failingChecks: detail, reason: `pre-existing / not this PR: ${detail.map((d) => d.check).join(', ')} also fail on the base`, preExistingOnly: true })
            } else setPr(it.branch, { reason: 'passes the failing check(s) alone' })
          }
          if (!bisected && !culprits.length) note = 'the batch failed and the gate run limit stopped the search for the culprit'
          const rest = included.filter((it) => !culprits.includes(it) && !unknown.includes(it))
          if (!culprits.length) {
            note = note ?? 'the batch failed but no branch fails the same check alone (an interaction between branches, or a pre-existing failure): no culprit found'
            for (const it of rest) setPr(it.branch, { status: 'INCOMPLETE', reason: `${prs.get(it.branch).reason}; ${note}` })
          } else if (!rest.length) {
            // nothing left to rebuild
          } else if (unknown.length) {
            for (const it of rest) setPr(it.branch, { status: 'INCOMPLETE', reason: 'another branch in the batch could not be checked, so the rebuilt batch was not gated' })
          } else if (!takeRun()) {
            for (const it of rest) setPr(it.branch, { status: 'INCOMPLETE', reason: `gate run limit reached (${maxRuns}) before the batch without the culprit could be gated` })
          } else {
            // 5. rebuild without the culprit(s) and gate ONCE more
            gateRuns += 1
            err(`[batch] re-gating without ${culprits.map((c) => c.branch).join(', ')} ...`)
            const second = buildBatch(ctx, rest)
            for (const c of second.conflicts) setPr(c.item.branch, { status: 'EXCLUDED', reason: 'CONFLICT while rebuilding the batch without the culprit' })
            const again = second.merged.length ? await gate(second.co.dir, { base: baseSha, env }) : null
            batchHead = second.head
            for (const it of second.merged) {
              if (again && again.code === 0 && again.verdict === 'PASS') setPr(it.branch, { status: 'MERGEABLE', reason: 'MERGEABLE-AFTER-RECHECK: the batch without the culprit passed a fresh gate' })
              else setPr(it.branch, { status: 'INCOMPLETE', reason: `the batch without the culprit did not pass the fresh gate (${again?.reason || again?.verdict || 'no result'})`, failingChecks: failingChecks(again) })
            }
          }
        }
      } else {
        // exit 75, 2, a timeout, or a FAIL with nothing to name: unknown, never a pass
        note = `the batch gate did not finish or gave no usable result (${res.reason || res.verdict})`
        for (const it of included) setPr(it.branch, { status: 'INCOMPLETE', reason: note })
      }
    }
    // Stale guard: a branch whose head moved since the start is marked STALE and left out of the result.
    for (const f of facts) {
      if (!f.sha) continue
      const now = git(root, ['rev-parse', '--verify', '--quiet', `${f.branch}^{commit}`]).stdout.trim()
      const p = prs.get(f.branch)
      if (now !== f.sha && p.status !== 'EXCLUDED') setPr(f.branch, { status: 'STALE', reason: `the branch moved from ${f.sha.slice(0, 12)} to ${now ? now.slice(0, 12) : '(gone)'} while the batch ran; rerun the batch`, failingChecks: [], culprit: null })
    }
  } finally {
    for (const c of cleanups.reverse()) {
      try {
        c()
      } catch {
        /* a leftover temp folder is not a result */
      }
    }
  }
  const list = [...prs.values()]
  const code = exitCodeFor(list.filter((p) => p.status !== 'EXCLUDED'))
  const doc = {
    schema: BATCH_SCHEMA,
    batchId: null,
    skippedByPath: batchSkipped,
    base: { ref: baseRef, sha: baseSha },
    batchHeadSha: batchHead,
    exitCode: code,
    gateRuns,
    maxRuns,
    devBaseline: batchDevBaseline,
    perBranchSkipped: skippedAlone,
    note,
    prs: list.map((p) => ({ branch: p.branch, headSha: p.headSha, status: p.status, reason: p.reason, culprit: !!p.culprit, skippedAlone: !!p.skippedAlone, culpritReason: p.culprit ? p.reason : null, failingChecks: p.failingChecks })),
  }
  timing.totalSeconds = Math.round(((Date.now() - tAll) / 1000) * 10) / 10
  if (doc) doc.timing = timing
  err(`[batch] total ${timing.totalSeconds} s (gate ${timing.gateSeconds ?? 'not run'} s)`)
  return { doc, code, lines, baseSha, baseRef, prs: list }
}

// The command: parse, run, print one line per PR, write the result file. Returns the exit code.
export async function runBatch(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}${NL}`), err = (t) => process.stderr.write(`${t}${NL}`), gate, devBaseline } = {}) {
  const opts = parseBatchArgs(argv)
  if (opts.error) {
    out(`NO-RESULT: ${opts.error}. next: usage: meerkat batch --base <ref> --app <repo> <branch1> <branch2> ... [--dry-run] [--max-lines <n>] [--max-prs <n>] [--json]`)
    return EXIT_USAGE
  }
  const r = await runBatchCore(opts, { env, cwd, err, gate, devBaseline })
  if (r.fatal) {
    out(`NO-RESULT: ${r.fatal}`)
    return r.code
  }
  if (opts.dryRun) {
    out(`PLAN base ${r.baseSha.slice(0, 12)} (${r.baseRef}): ${r.plan.included.length} to merge, ${r.plan.excluded.length} excluded. Nothing was gated and no result file was written.`)
    for (const it of r.plan.included) out(`${it.branch}: would be merged into the batch (${it.lines} changed lines: ${it.additions} additions + ${it.lines - it.additions} deletions; the cap counts the ${it.lines})`)
    for (const e of r.plan.excluded) out(`${e.branch}: EXCLUDED ${e.reason}`)
    // A plan that refuses any branch is not a clean plan: exit 75 (not a pass), so a script cannot read it as success. Nothing is gated in a dry run either way.
    return r.plan.excluded.length ? 75 : 0
  }
  const id = newBatchId()
  r.doc.batchId = id
  const file = join(dataDir(env), 'batches', `${id}.json`)
  let wrote = true
  try {
    writeResultAtomic(file, r.doc)
    // A fixed per-repo latest copy, so a queue can find the newest batch result without searching.
    const repoName = String(basename(r.repoRoot ?? opts.app ?? 'repo')).replace(/[^A-Za-z0-9._-]+/g, '_')
    writeResultAtomic(join(dataDir(env), 'batches', repoName, 'latest.json'), r.doc)
  } catch (e) {
    wrote = false
    err(`note: the result file was not written (${firstLine(e?.message ?? e)})`)
  }
  // A result that could not be saved is not a result: never exit 0 on it.
  const code = wrote ? r.code : r.code === 0 ? EXIT_INCOMPLETE : r.code
  if (opts.json) out(JSON.stringify({ ...r.doc, exitCode: code, resultFile: wrote ? file : null }, null, 2))
  else {
    for (const p of r.doc.prs) out(`${p.branch}: ${p.status}${p.reason ? ` ${p.reason}` : ''}`)
    if (r.doc.note) out(`note: ${r.doc.note}`)
    out(`BATCH ${id}: exit ${code}, ${r.doc.gateRuns} gate run(s)${wrote ? `, result ${file}` : ''}`)
  }
  return code
}
