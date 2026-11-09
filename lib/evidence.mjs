// Evidence for a dismissal: `meerkat dismiss <id> --reason "..." --evidence <kind>:<value>`.
//   test:<name>            a test that exists in the repo and passed when run by the repo's own test command (commands.test in meerkat.config.json)
//   line:<file>:<line>     a line of the project that holds the text the dismissal names (the line's own text, or `line:<file>:<line>:<text>`)
//   note:<free text>       allowed, but never checked: it is shown as UNVERIFIED everywhere
// A dismissal with `test` or `line` evidence is checked every time it is read. When the evidence no longer holds (the test is gone or failed,
// the line moved or changed) the dismissal is STALE: it is listed as STALE and it stops suppressing the finding, so the finding comes back.
// A dismissal saved before evidence existed has none: it keeps working and is shown as "note (unverified, from before evidence was required)".
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { commandsTrusted, readCommands } from './repocommands.mjs'

export const KINDS = ['test', 'line', 'note']
export const LEGACY_LABEL = 'note (unverified, from before evidence was required)'
const MAX_FILE = 2 * 1024 * 1024
const MAX_FILES = 8000
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', 'coverage', '.venv', 'venv', '__pycache__'])
const UNSAFE_NAME = /["`$&|;<>\\\r\n%^]/

const norm = (p) => String(p).split('\\').join('/')

// 'kind:value' -> { kind, value }. Throws a sentence on anything else.
export function parseEvidence(spec) {
  const s = String(spec ?? '')
  const i = s.indexOf(':')
  const kind = i > 0 ? s.slice(0, i).trim().toLowerCase() : ''
  const value = i > 0 ? s.slice(i + 1).trim() : ''
  if (!KINDS.includes(kind) || !value) throw new Error('--evidence needs <kind>:<value> where kind is test, line or note, for example --evidence line:src/app.js:42 or --evidence test:"rejects an empty name" or --evidence note:"checked with the vendor"')
  return { kind, value }
}

// 'file:line' or 'file:line:text'. The file may hold a drive letter (C:\x\a.js:12).
export function parseLine(value) {
  const m = /^(.+?):(\d+)(?::([\s\S]*))?$/.exec(value)
  if (!m || Number(m[2]) < 1) throw new Error('line evidence is <file>:<line>, for example line:src/app.js:42 (optionally :<text the line must contain>)')
  return { file: m[1], line: Number(m[2]), text: m[3] ?? null }
}

// The file inside the project, or null when it would leave the project.
export function insideProject(projectPath, file) {
  const root = resolve(projectPath)
  const abs = isAbsolute(file) ? resolve(file) : resolve(root, file)
  const rel = relative(root, abs)
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : abs
}

function readLine(projectPath, file, line) {
  const abs = insideProject(projectPath, file)
  if (!abs) return { problem: `${file} is outside the project` }
  if (!existsSync(abs)) return { problem: `${norm(file)} no longer exists` }
  try {
    if (statSync(abs).size > MAX_FILE) return { problem: `${norm(file)} is too large to check` }
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
    if (line > lines.length) return { problem: `${norm(file)} now has only ${lines.length} line(s)` }
    return { text: lines[line - 1] }
  } catch (e) {
    return { problem: `${norm(file)} could not be read (${e?.code ?? 'error'})` }
  }
}

// ---- test evidence ----
const isTestFile = (rel) => /(^|\/)(tests?|__tests__|spec)\//i.test(rel) || /\.(test|spec)\.[a-z0-9]+$/i.test(rel) || /(^|\/)test_[^/]+\.py$/i.test(rel) || /_test\.(go|py|rs|rb)$/i.test(rel) || /(Test|Tests)\.(java|kt|cs)$/.test(rel)

// Does a test file of the project name this test? Plain text search over test files only.
export function testExists(projectPath, name) {
  const root = resolve(projectPath)
  let seen = 0
  const walk = (d) => {
    let ents
    try {
      ents = readdirSync(d, { withFileTypes: true })
    } catch {
      return false
    }
    for (const e of ents) {
      if (seen > MAX_FILES) return false
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && walk(p)) return true
      } else if (e.isFile()) {
        seen++
        if (!isTestFile(norm(relative(root, p)))) continue
        try {
          if (statSync(p).size <= MAX_FILE && readFileSync(p, 'utf8').includes(name)) return true
        } catch {
          /* an unreadable file does not hold the test */
        }
      }
    }
    return false
  }
  return walk(root)
}

// Runs the repo's own test command for one test name. `{name}` in the command is replaced by the quoted name; otherwise ` -t "<name>"` is
// added (vitest, jest and mocha-style runners). Only the trusted commands.test of meerkat.config.json is ever run (meerkat trust).
export function runTest(projectPath, name, { env = process.env, timeoutMs = 120000 } = {}) {
  if (UNSAFE_NAME.test(name)) return { ok: false, why: 'the test name holds a character that is unsafe in a command line (quotes, $, &, |, ;, <, >, \\, %, ^)' }
  const r = readCommands(resolve(projectPath))
  const cmd = r.commands.test
  if (!cmd) return { ok: false, why: 'the repo defines no commands.test in meerkat.config.json, so the test cannot be run' }
  if (!commandsTrusted(r, env)) return { ok: false, why: 'the repo\'s commands are not trusted yet: run `meerkat trust` first' }
  const full = cmd.includes('{name}') ? cmd.split('{name}').join(`"${name}"`) : `${cmd} -t "${name}"`
  const res = spawnSync(full, { cwd: r.dir, shell: true, env, encoding: 'utf8', timeout: timeoutMs }) // meerkat-ignore js-spawn-shell guarded above: only the trusted commands.test, with a name that holds no shell metacharacter
  if (res.error) return { ok: false, why: `the test command could not run (${res.error.code ?? res.error.message})` }
  return res.status === 0 ? { ok: true } : { ok: false, why: `the test command exited ${res.status}` }
}

// ---- building and checking ----
// The evidence record to store with a new dismissal. Throws a sentence when the evidence does not hold right now.
export function buildEvidence(spec, { projectPath, env = process.env, now = new Date() } = {}) {
  const { kind, value } = parseEvidence(spec)
  const at = now.toISOString()
  if (kind === 'note') return { kind, text: value.slice(0, 500), at }
  if (kind === 'line') {
    const p = parseLine(value)
    const got = readLine(projectPath, p.file, p.line)
    if (got.problem) throw new Error(`line evidence does not hold: ${got.problem}`)
    if (p.text !== null) {
      if (!got.text.includes(p.text)) throw new Error(`line evidence does not hold: ${norm(p.file)} line ${p.line} does not contain "${p.text}"`)
      return { kind, file: norm(p.file), line: p.line, text: p.text.slice(0, 300), exact: false, at }
    }
    const t = got.text.trim()
    if (!t) throw new Error(`line evidence needs a line with text: ${norm(p.file)} line ${p.line} is empty`)
    return { kind, file: norm(p.file), line: p.line, text: t.slice(0, 300), exact: true, at }
  }
  if (!testExists(projectPath, value)) throw new Error(`test evidence does not hold: no test file in the project names "${value}"`)
  const r = runTest(projectPath, value, { env })
  if (!r.ok) throw new Error(`test evidence does not hold: ${r.why}`)
  return { kind, name: value, lastResult: 'pass', checkedAt: at, at }
}

// { state: VERIFIED | STALE | UNVERIFIED, label, detail } for one dismissal, read as of now. Never runs a test (that is `dismissals --verify`).
export function checkEvidence(item, projectPath) {
  const ev = item?.evidence
  if (!ev || typeof ev !== 'object' || !KINDS.includes(ev.kind)) return { state: 'UNVERIFIED', label: LEGACY_LABEL, detail: 'saved before evidence was required; it still suppresses the finding' }
  if (ev.kind === 'note') return ev.implicit ? { state: 'UNVERIFIED', label: 'note (unverified, no evidence was given)', detail: 'no --evidence was given; it still suppresses the finding' } : { state: 'UNVERIFIED', label: `note:${ev.text ?? ''}`, detail: 'free text, never checked' }
  if (ev.kind === 'line') {
    const tag = `line:${ev.file}:${ev.line}`
    const got = readLine(projectPath, String(ev.file ?? ''), Number(ev.line))
    if (got.problem) return { state: 'STALE', label: tag, detail: `${got.problem}; the dismissal no longer suppresses the finding` }
    const ok = ev.exact ? got.text.trim() === ev.text : got.text.includes(ev.text)
    return ok ? { state: 'VERIFIED', label: tag, detail: `line ${ev.line} of ${ev.file} still ${ev.exact ? 'reads' : 'contains'} "${ev.text}"` } : { state: 'STALE', label: tag, detail: `line ${ev.line} of ${ev.file} no longer ${ev.exact ? 'reads' : 'contains'} "${ev.text}"; the dismissal no longer suppresses the finding` }
  }
  const tag = `test:${ev.name}`
  if (!testExists(projectPath, String(ev.name ?? ''))) return { state: 'STALE', label: tag, detail: `no test file in the project names "${ev.name}" any more; the dismissal no longer suppresses the finding` }
  if (ev.lastResult === 'fail') return { state: 'STALE', label: tag, detail: `the test failed when last run (${ev.checkedAt ?? 'unknown time'}); the dismissal no longer suppresses the finding` }
  return { state: 'VERIFIED', label: tag, detail: `the test exists and passed when last run (${ev.checkedAt ?? 'unknown time'})` }
}

// Splits dismissals into those that still suppress and those whose evidence went stale. One check per distinct evidence, cached by key.
export function partitionByEvidence(items, projectPath) {
  const live = []
  const stale = []
  const cache = new Map()
  for (const d of items) {
    const ev = d.evidence
    if (!ev || (ev.kind !== 'line' && ev.kind !== 'test')) {
      live.push(d)
      continue
    }
    const key = `${ev.kind}|${ev.file ?? ev.name}|${ev.line ?? ''}|${ev.text ?? ''}|${ev.lastResult ?? ''}`
    if (!cache.has(key)) cache.set(key, checkEvidence(d, projectPath))
    const c = cache.get(key)
    if (c.state === 'STALE') stale.push({ ...d, staleDetail: c.detail })
    else live.push(d)
  }
  return { live, stale }
}

// `dismissals --verify`: re-runs the test of every test-evidence dismissal and returns the items with the new lastResult.
export function reverifyTests(items, projectPath, { env = process.env } = {}) {
  const now = new Date().toISOString()
  return items.map((d) => {
    if (d.evidence?.kind !== 'test') return d
    const r = testExists(projectPath, d.evidence.name) ? runTest(projectPath, d.evidence.name, { env }) : { ok: false, why: 'the test is gone' }
    return { ...d, evidence: { ...d.evidence, lastResult: r.ok ? 'pass' : 'fail', checkedAt: now, ...(r.ok ? {} : { why: r.why }) } }
  })
}
