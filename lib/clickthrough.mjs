// Click-through runner: reads a scenario (a JSON file), starts the app the project names, waits until it is ready, then
// runs each step through a DRIVER, a command the project names. Meerkat has no browser library: the driver is the
// project's own. Contract and format: docs/click-through.md.
//
// Usage: node lib/clickthrough.mjs <scenario.json> [--root <dir>] [--out <dir>]
// Exit codes: 0 every step passed, 1 a step failed (or the scenario is invalid), 75 the app or driver could not start.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { killTreeOf } from './exec.mjs'

export const STEP_TYPES = ['open', 'click', 'type', 'wait-for', 'assert', 'screenshot', 'stop']
const DEFAULT_TIMEOUT_MS = 10_000
const READY_TIMEOUT_MS = 60_000
const KILL_GRACE_MS = 1500
const OUT_LIMIT = 200_000

const isStr = (v) => typeof v === 'string' && v.length > 0

// Returns a list of problems; empty means the scenario is well formed.
export function validateScenario(sc) {
  const bad = []
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return ['scenario is not a JSON object']
  if (!isStr(sc.name)) bad.push('name must be a non-empty string')
  if (!sc.driver || !isStr(sc.driver.cmd)) bad.push('driver.cmd must name the driver command')
  if (sc.app !== undefined && !(sc.app && isStr(sc.app.cmd))) bad.push('app.cmd must be a non-empty string when app is given')
  if (sc.ready !== undefined) {
    const r = sc.ready
    if (!r || typeof r !== 'object' || !(isStr(r.url) || isStr(r.windowTitle))) bad.push('ready needs a url or a windowTitle')
  }
  if (!Array.isArray(sc.steps) || sc.steps.length === 0) bad.push('steps must be a non-empty array')
  else
    sc.steps.forEach((s, i) => {
      const n = i + 1
      if (!s || typeof s !== 'object') return bad.push(`step ${n}: not an object`)
      if (!STEP_TYPES.includes(s.type)) return bad.push(`step ${n}: type must be one of ${STEP_TYPES.join(', ')}`)
      if (s.timeoutMs !== undefined && !(Number.isInteger(s.timeoutMs) && s.timeoutMs > 0)) bad.push(`step ${n}: timeoutMs must be a positive whole number`)
      const need = (ok, what) => { if (!ok) bad.push(`step ${n} (${s.type}): ${what}`) }
      if (s.type === 'open') need(isStr(s.url), 'needs url')
      if (s.type === 'click') need(isStr(s.text) || isStr(s.selector), 'needs text or selector')
      if (s.type === 'type') need((isStr(s.text) || isStr(s.selector)) && typeof s.value === 'string', 'needs a selector or text (the field) and a string value')
      if (s.type === 'wait-for') need(isStr(s.text) || isStr(s.url), 'needs text or url')
      if (s.type === 'assert') need(isStr(s.text) || isStr(s.element) || isStr(s.urlMatches), 'needs text, element or urlMatches')
    })
  return bad
}

// What the step expects, in words. A failure always prints this next to what the driver saw.
export function describeExpected(s) {
  switch (s.type) {
    case 'open': return `page opened at ${s.url}`
    case 'click': return `${s.selector ? `element ${s.selector}` : `element with text "${s.text}"`} found and clicked`
    case 'type': return `${s.selector ? s.selector : `field "${s.text}"`} accepts the text`
    case 'wait-for': return s.text ? `text "${s.text}" appears` : `url becomes ${s.url}`
    case 'assert': return s.text ? `text "${s.text}" is present` : s.element ? `element ${s.element} is present` : `url matches ${s.urlMatches}`
    case 'screenshot': return 'a non-empty PNG is saved'
    default: return 'step succeeds'
  }
}

function label(s) {
  const bit = s.text ?? s.selector ?? s.url ?? s.element ?? s.urlMatches ?? s.name
  return bit ? `${s.type} "${String(bit).slice(0, 40)}"` : s.type
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Run the driver once with `payload` on stdin. Resolves { code, stdout, stderr, timedOut, spawnError }. Never throws.
function runDriver(driver, payload, { cwd, env, timeoutMs }) {
  return new Promise((done) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let child
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); done({ stdout, stderr, timedOut, ...r }) } }
    try {
      child = spawn(driver.cmd, driver.args ?? [], { cwd, env: { ...process.env, ...(driver.env ?? {}), ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(driver.cmd) })
    } catch (e) {
      return done({ code: null, stdout, stderr, timedOut: false, spawnError: String(e?.message ?? e) })
    }
    const timer = setTimeout(() => { timedOut = true; killTreeOf(child.pid); setTimeout(() => finish({ code: null }), 500) }, timeoutMs)
    child.stdout.on('data', (d) => { if (stdout.length < OUT_LIMIT) stdout += d })
    child.stderr.on('data', (d) => { if (stderr.length < OUT_LIMIT) stderr += d })
    child.on('error', (e) => finish({ code: null, spawnError: String(e?.message ?? e) }))
    child.on('close', (code) => finish({ code }))
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(payload))
  })
}

// The last line of stdout that parses as a JSON object (a driver may print noise first).
function parseResult(stdout) {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines[i])
      if (v && typeof v === 'object' && !Array.isArray(v)) return v
    } catch { /* keep looking */ }
  }
  return null
}

async function waitForUrl(url, timeoutMs, appState) {
  const end = Date.now() + timeoutMs
  let last = 'no answer'
  while (Date.now() < end) {
    if (appState.exited) return { ok: false, actual: `the app exited (code ${appState.code}) before ${url} answered` }
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 2000)
      const res = await fetch(url, { signal: ctl.signal })
      clearTimeout(t)
      if (res.status < 500) return { ok: true }
      last = `HTTP ${res.status}`
    } catch (e) {
      last = String(e?.cause?.code ?? e?.message ?? e)
    }
    await sleep(300)
  }
  return { ok: false, actual: `${url} did not answer within ${timeoutMs} ms (last: ${last})` }
}

export async function runScenario(sc, { root = process.cwd(), outDir, log = () => {} } = {}) {
  const t0 = Date.now()
  const result = { schema: 1, scenario: sc?.name ?? null, status: 'fail', exitCode: 1, startedAt: new Date(t0).toISOString(), ms: 0, outDir, steps: [], screenshots: [], failed: null, note: null }
  const finalize = (status, exitCode, note) => { result.status = status; result.exitCode = exitCode; result.note = note ?? result.note; result.ms = Date.now() - t0; return result }

  const problems = validateScenario(sc)
  if (problems.length) return finalize('fail', 1, `scenario invalid: ${problems.join('; ')}`)
  mkdirSync(outDir, { recursive: true })
  const session = join(outDir, 'session')
  mkdirSync(session, { recursive: true })
  const driverCwd = resolve(root, sc.driver.cwd ?? '.')
  const driverEnv = { MEERKAT_CT_SESSION: session, MEERKAT_CT_OUT: outDir }
  const base = { protocol: 1, scenario: sc.name, total: sc.steps.length, session, outDir }
  let app = null
  const appState = { exited: false, code: null }

  const stopApp = () => { if (app?.pid && !appState.exited) killTreeOf(app.pid) }
  const callDriver = (step, extra, timeoutMs) => runDriver(sc.driver, { ...base, ...extra, step, timeoutMs }, { cwd: driverCwd, env: driverEnv, timeoutMs: timeoutMs + KILL_GRACE_MS })

  try {
    if (sc.app) {
      const fd = openSync(join(outDir, 'app.log'), 'w')
      try {
        app = spawn(sc.app.cmd, sc.app.args ?? [], { cwd: resolve(root, sc.app.cwd ?? '.'), env: { ...process.env, ...(sc.app.env ?? {}) }, stdio: ['ignore', fd, fd], windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(sc.app.cmd) })
      } catch (e) {
        return finalize('cannot-start', 75, `app could not start: ${String(e?.message ?? e)}`)
      } finally { closeSync(fd) }
      app.on('error', (e) => { appState.exited = true; appState.code = `spawn error ${e?.code ?? e?.message}` })
      app.on('close', (code) => { appState.exited = true; appState.code = code })
      await sleep(50)
      if (appState.exited && appState.code !== 0) return finalize('cannot-start', 75, `app could not start: ${appState.code}; see app.log in ${outDir}`)
    }

    const ready = sc.ready
    if (ready) {
      const rt = Number.isInteger(ready.timeoutMs) ? ready.timeoutMs : READY_TIMEOUT_MS
      if (isStr(ready.url)) {
        const r = await waitForUrl(ready.url, rt, appState)
        if (!r.ok) return finalize('cannot-start', 75, `app not ready: expected ${ready.url} to answer; actual: ${r.actual}`)
      }
      if (isStr(ready.windowTitle)) {
        const d = await callDriver({ type: 'ready', windowTitle: ready.windowTitle }, { index: 0 }, rt)
        if (d.spawnError || d.code === 75 || d.code === null) return finalize('cannot-start', 75, `driver could not start: ${d.spawnError ?? (d.timedOut ? 'timed out waiting for the window' : 'exit ' + d.code)}`)
        const j = parseResult(d.stdout)
        if (!j || j.ok !== true) return finalize('cannot-start', 75, `app not ready: expected a window titled "${ready.windowTitle}"; actual: ${j?.actual ?? j?.detail ?? (d.stderr.trim().split('\n').pop() || 'no answer')}`)
      }
    }

    let failedAt = -1
    for (let i = 0; i < sc.steps.length; i++) {
      const s = sc.steps[i]
      const n = i + 1
      const timeoutMs = s.timeoutMs ?? sc.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
      const rec = { n, type: s.type, label: label(s), ok: false, ms: 0, expected: describeExpected(s), actual: null, detail: null }
      result.steps.push(rec)
      if (failedAt >= 0) { rec.skipped = true; rec.actual = 'not run: an earlier step failed'; continue }
      const step = { ...s }
      if (s.type === 'screenshot') {
        const name = String(s.name ?? `step-${n}`).replace(/[^a-zA-Z0-9._-]+/g, '-')
        step.path = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`)
      }
      log(`step ${n}/${sc.steps.length} ${rec.label}`)
      const st = Date.now()
      const d = await callDriver(step, { index: n }, timeoutMs)
      rec.ms = Date.now() - st
      const j = parseResult(d.stdout)
      if (d.spawnError) { return failWith(finalize('cannot-start', 75, `driver could not start: ${d.spawnError}`), rec, `driver could not start: ${d.spawnError}`) }
      if (d.code === 75 && !j) { return failWith(finalize('cannot-start', 75, `driver cannot run here (exit 75): ${d.stderr.trim().split('\n').pop() ?? ''}`), rec, 'driver exit 75') }
      if (d.timedOut) { rec.actual = `no answer within ${timeoutMs} ms`; failedAt = i; continue }
      if (!j) { rec.actual = `driver exit ${d.code} with no JSON result${d.stderr.trim() ? `: ${d.stderr.trim().split('\n').pop().slice(0, 200)}` : ''}`; failedAt = i; continue }
      rec.detail = j.detail ?? null
      if (j.ok === true && d.code === 0) {
        rec.ok = true
        rec.actual = j.state ?? j.actual ?? null
        if (s.type === 'screenshot') {
          if (existsSync(step.path) && statSync(step.path).size > 0) { rec.file = step.path; result.screenshots.push(step.path) }
          else { rec.ok = false; rec.actual = 'driver reported ok but no PNG was written at the given path'; failedAt = i }
        }
      } else {
        rec.actual = j.actual ?? j.state ?? j.detail ?? `driver exit ${d.code}`
        if (j.expected) rec.expected = j.expected
        failedAt = i
      }
      if (failedAt === i && s.type !== 'screenshot') {
        // Evidence: try for a screenshot of the failing state; the driver may ignore it.
        const p = join(outDir, `fail-step-${n}.png`)
        const e = await callDriver({ type: 'screenshot', name: `fail-step-${n}`, path: p }, { index: n, evidence: true }, 5000).catch(() => null)
        if (e && existsSync(p) && statSync(p).size > 0) { rec.file = p; result.screenshots.push(p) }
      }
      if (s.type === 'stop' && rec.ok) break
    }
    // Always give the driver a chance to clean up, ignoring its answer.
    if (!sc.steps.some((s, i) => s.type === 'stop' && result.steps[i]?.ok)) await callDriver({ type: 'stop' }, { index: sc.steps.length + 1, implicit: true }, 5000).catch(() => null)

    if (failedAt >= 0) {
      const f = result.steps[failedAt]
      result.failed = { n: f.n, type: f.type, label: f.label, expected: f.expected, actual: f.actual }
      return finalize('fail', 1, `step ${f.n} (${f.label}) failed. expected: ${f.expected}. actual: ${f.actual}`)
    }
    return finalize('pass', 0, `${sc.steps.length} steps passed`)
  } finally {
    stopApp()
    result.ms = Date.now() - t0
    writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2))
  }
}

function failWith(res, rec, why) {
  rec.actual = why
  res.failed = { n: rec.n, type: rec.type, label: rec.label, expected: rec.expected, actual: why }
  return res
}

// A check object for a project's .meerkat/checks/*.mjs file: the scenario runs as a window-lane check, so it follows the same gate as
// every other window check (--include windows, MEERKAT_WINDOWS=1, the ui/app/release presets) and the same lane (a few windows at a time).
export function clickThroughCheck({ id = 'click-through-scenario', scenario, title, group = 'ui', tier = 'thorough', weight = 'medium', estSeconds = 60, timeoutSeconds = 300, cwd = 'app', paths } = {}) {
  const runner = decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  return {
    id,
    group,
    tier,
    lane: 'windows',
    weight,
    found: true,
    title: title ?? `Click-through scenario ${scenario}`,
    estSeconds,
    timeoutSeconds,
    needs: ['node'],
    ...(paths ? { paths } : {}),
    run: { cmd: 'node', args: [runner, scenario, '--root', '{app}', '--out', '{app}/.meerkat/click-through'], cwd },
  }
}

function parseArgs(argv) {
  const o = { scenario: null, root: null, out: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') o.root = argv[++i]
    else if (argv[i] === '--out') o.out = argv[++i]
    else if (!o.scenario) o.scenario = argv[i]
  }
  return o
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (!o.scenario) { console.error('usage: node clickthrough.mjs <scenario.json> [--root <dir>] [--out <dir>]'); process.exit(1) }
  const root = resolve(o.root ?? process.cwd())
  const file = resolve(root, o.scenario)
  let sc
  try { sc = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { console.error(`scenario unreadable: ${file}: ${e.message}`); process.exit(1) }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = resolve(o.out ?? (process.env.MEERKAT_SCRATCH ? join(process.env.MEERKAT_SCRATCH, 'click-through') : join(root, '.meerkat', 'click-through')), stamp)
  const res = await runScenario(sc, { root, outDir, log: (l) => console.log(l) })
  for (const s of res.steps) console.log(`${s.ok ? 'PASS' : s.skipped ? 'SKIP' : 'FAIL'} step ${s.n} ${s.label} (${s.ms} ms)`)
  console.log(`result: ${join(outDir, 'result.json')}`)
  for (const p of res.screenshots) console.log(`screenshot: ${p}`)
  console.log(res.status === 'pass' ? `PASS ${res.note}` : res.status === 'cannot-start' ? `CANNOT START ${res.note}` : `FAIL ${res.note}`)
  process.exit(res.exitCode)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
