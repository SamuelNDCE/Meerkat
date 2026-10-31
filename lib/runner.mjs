// Selecting, scheduling and executing checks. Pure functions plus one async scheduler, so the tests can
// drive it with fake checks (including a deliberately hanging one).
import { mkdirSync, writeFileSync } from 'node:fs'
import { freemem, tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand, lastLine } from './exec.mjs'
import { bashFor, wrapForLane, resolveCwd } from './lanes.mjs'
import { matchesAny } from './glob.mjs'
import { missingBinaries } from './which.mjs'

export const DEFAULT_TIMEOUT_SECONDS = 600

// Which checks run, and which are skipped. `mode` is 'changed' | 'all'.
// `groups` (security, functionality, ui, performance) limits a run to those kinds of check; what a chosen check needs (a build) comes with it.
export function selectChecks(checks, { tier, only, include = [], mode, changedFiles, groups = [] }) {
  let run = []
  const skipped = []
  const eligible = []
  for (const c of checks) {
    if (only && only.length) {
      if (only.includes(c.id)) run.push(c)
      continue
    }
    if (c.optIn && !include.includes(c.optIn)) continue
    if (tier === 'fast' && c.tier !== 'fast' && !(mode === 'all' && c.fastWhenAll)) continue
    if (mode === 'changed' && c.paths && c.paths.length && Array.isArray(changedFiles) && !matchesAny(c.paths, changedFiles)) {
      skipped.push(c)
      continue
    }
    eligible.push(c)
    if (!groups.length || groups.includes(c.group)) run.push(c)
  }
  if (!only?.length && groups.length) {
    // Bring in everything a chosen check waits for, and what that waits for in turn.
    const byId = new Map(eligible.map((c) => [c.id, c]))
    const have = new Set(run.map((c) => c.id))
    const queue = [...run]
    while (queue.length) {
      for (const dep of queue.shift().after ?? []) {
        const d = byId.get(dep)
        if (d && !have.has(dep)) {
          have.add(dep)
          run.push(d)
          queue.push(d)
        }
      }
    }
  }
  // A check that a bigger one in the same run fully covers does not run on its own (the short click-through next
  // to the full one, the changed-files unit tests next to every unit test). Running both only made them compete
  // for the machine: the changed-files run died with "Failed to start threads worker" beside the full run.
  const ids = new Set(run.map((c) => c.id))
  const superseded = run.filter((c) => c.supersededBy && ids.has(c.supersededBy))
  const kept = run.filter((c) => !superseded.includes(c))
  return { run: orderForSpeed(kept), skipped, superseded }
}

// Start order. A lane runs its checks one at a time, so the order inside a lane cannot change how long the lane's
// own work takes; what it can change is how soon the OTHER lane gets what it is waiting for. So a check that others
// wait on (through `after`) goes first, longest remaining chain first: on a cold run the sidecar build then starts
// before the parser tests and clippy, and the window checks that wait for it overlap those 481 s of cargo work
// instead of following them. A check of QUICK_SECONDS or less that nothing waits on (formatting, a lint) still goes
// before that build, so a quick failure shows up at once. Every other check keeps the old order, cheapest first.
// Nothing is dropped or reordered across `after`; the scheduler still enforces every dependency.
const QUICK_SECONDS = 10

export function orderForSpeed(checks) {
  const ids = new Set(checks.map((c) => c.id))
  const est = (c) => c.estSeconds ?? 30
  const dependents = new Map(checks.map((c) => [c.id, []]))
  for (const c of checks) for (const d of c.after ?? []) if (ids.has(d)) dependents.get(d).push(c)
  const memo = new Map()
  // Seconds of work from the start of this check to the end of the longest chain that waits on it.
  const chain = (c, seen = new Set()) => {
    if (memo.has(c.id)) return memo.get(c.id)
    if (seen.has(c.id)) return est(c) // a dependency cycle: do not recurse forever, the scheduler reports it
    seen.add(c.id)
    const tail = Math.max(0, ...dependents.get(c.id).map((d) => chain(d, seen)))
    memo.set(c.id, est(c) + tail)
    return est(c) + tail
  }
  const blockers = checks.filter((c) => dependents.get(c.id).length)
  const rest = checks.filter((c) => !dependents.get(c.id).length)
  blockers.sort((a, b) => chain(b) - chain(a) || est(a) - est(b))
  rest.sort((a, b) => est(a) - est(b))
  const quick = rest.filter((c) => est(c) <= QUICK_SECONDS)
  return [...quick, ...blockers, ...rest.filter((c) => !quick.includes(c))]
}

function timeoutMsFor(check) {
  return (check.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000
}

function withTimeout(promise, ms, label) {
  let t
  const timeout = new Promise((resolve) => {
    t = setTimeout(() => resolve({ ok: false, detail: `timed out after ${Math.round(ms / 1000)}s (${label})` }), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

// Execute one command spec or function. Returns { status, detail }. `expectFail` inverts for self-tests.
async function execute(spec, check, ctx, { expectFail = false } = {}) {
  const ms = timeoutMsFor(check)
  if (typeof spec === 'function') {
    let r
    try {
      r = await withTimeout(Promise.resolve().then(() => spec(ctx)), ms, check.id)
    } catch (e) {
      r = { ok: false, detail: String(e?.message ?? e) }
    }
    return finish(r.ok, r.detail ?? '', expectFail)
  }
  // A check's own env is its DEFAULT: an NV_* variable the person set (or a profile set) wins, so a slower PC can
  // lower the window count without editing the check. A self-test env is a requirement and always wins.
  // {repo} and {app} in a command's arguments and environment are the repository root and the app folder (forward slashes), so a check can
  // name a folder without any machine's path in it.
  const expand = (v) => (typeof v === 'string' ? v.split('{repo}').join(String(ctx.repoRoot).replace(/\\/g, '/')).split('{app}').join(String(ctx.appDir).replace(/\\/g, '/')) : v)
  const specEnv = Object.fromEntries(Object.entries(spec.env ?? {}).map(([k, v]) => [k, expand(v)]))
  if (!expectFail) for (const k of Object.keys(specEnv)) if (k.startsWith('NV_') && ctx.env?.[k] !== undefined && ctx.env[k] !== '') specEnv[k] = ctx.env[k]
  const wrapped = wrapForLane(check.lane, spec.cmd, (spec.args ?? []).map(expand), { ...ctx.env, ...specEnv }, ctx.exists)
  if (wrapped.missing) return { status: 'NOT RUN', detail: wrapped.missing }
  const r = await runCommand({
    cmd: wrapped.cmd,
    args: wrapped.args,
    cwd: resolveCwd(spec.cwd, ctx),
    env: { ...specEnv, ...wrapped.env },
    timeoutMs: ms,
    onLine: ctx.onLine,
  })
  let detail = r.timedOut ? `timed out after ${Math.round(ms / 1000)}s` : lastLine(r.output)
  // The table shows one line, which is often not the cause (a click-through failure once showed only its own
  // summary). A check that did not pass keeps its whole output in a file, and the line names the file.
  // The saved path is also returned as its own field (outputFile), so nothing downstream has to dig it out of free text.
  let saved = null
  if (!expectFail && r.code !== 0 && r.code !== 75) {
    saved = saveFailureLog(check.id, r.output, ctx.env)
    if (saved) detail += `  [full output: ${saved}]`
  }
  // Exit 75 means NOT RUN (a tool, service or setting is missing; cargo-lock and electron-lock use it for "waited too long").
  if (r.code === 75 && !r.timedOut) return { status: 'NOT RUN', detail: detail.replace(/^NOT RUN:\s*/i, '') }
  const result = finish(r.code === 0, detail, expectFail)
  return saved ? { ...result, outputFile: saved } : result
}

export function saveFailureLog(id, output, env = process.env) {
  try {
    const dir = env.NV_VERIFY_LOG_DIR || join(tmpdir(), 'nv-verify-logs')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}-${Date.now()}.log`).split('\\').join('/')
    writeFileSync(file, String(output ?? ''))
    return file
  } catch {
    return null
  }
}

function finish(ok, detail, expectFail) {
  if (expectFail) {
    return ok
      ? { status: 'FAIL', detail: 'self-test: the check PASSED a deliberately broken case, so it cannot be trusted' }
      : { status: 'PASS', detail: `self-test: correctly failed (${detail})` }
  }
  return { status: ok ? 'PASS' : 'FAIL', detail }
}

export async function runOne(check, ctx, { selfTest = false } = {}) {
  // `bash` is found the way the lanes find it (NV_BASH, the bash next to git, Git for Windows), not only on PATH: a PowerShell window
  // usually has no bash on PATH although Git's is installed, and that must not turn every cargo check into NOT RUN.
  const needs = (check.needs ?? []).filter((b) => !(b === 'bash' && ctx.platform === 'win32' && bashFor(ctx.env, ctx.exists, ctx.platform)))
  const missing = missingBinaries(needs, ctx.env, ctx.platform)
  if (missing.length) return { status: 'NOT RUN', detail: `missing on PATH: ${missing.join(', ')}` }
  if (selfTest) {
    const st = check.selfTest
    if (!st) return { status: 'FAIL', detail: 'no selfTest defined' }
    if (typeof st === 'function') return execute(st, check, ctx, { expectFail: true })
    return execute(st, check, ctx, { expectFail: st.expectFail !== false })
  }
  return execute(check.run, check, ctx)
}

// Schedule checks: cheap first, free lane in parallel, cargo and electron one at a time each.
// What a check costs the machine while it runs: processor threads and memory. Light checks (a scan, a lint, a quick audit) cost about
// one thread and are run side by side; heavy ones (a build, the unit tests, a window with many windows) cost a lot and are started only
// when the machine has room for them, which in practice means mostly alone. A check can state its own cost (`cost: { cpu, memGB }`);
// otherwise it gets the usual cost of its lane.
const LANE_COST = { cargo: { cpu: 6, memGB: 3 }, electron: { cpu: 4, memGB: 3 }, free: { cpu: 2, memGB: 0.3 } }
// Weight classes, for people writing checks: a run has 10 slots, so about 10 tiny checks, 5 light, 2 or 3 medium, or 1 heavy plus a light
// one can run together, and an "alone" check gets the machine to itself. A check with no weight gets the usual cost of its lane.
export const WEIGHTS = { tiny: { cpu: 1, memGB: 0.1 }, light: { cpu: 2, memGB: 0.3 }, medium: { cpu: 4, memGB: 1.5 }, heavy: { cpu: 8, memGB: 3 } }
export const isAlone = (check) => check.alone === true || check.weight === 'alone'
export const costOf = (check) => ({ ...(WEIGHTS[check.weight] ?? LANE_COST[check.lane] ?? LANE_COST.free), ...(check.cost ?? {}) })

// `budget` ({ cpu, reserveGB }) is how much a run may use at once; null means no limit (the old behaviour). Memory is read from the
// machine each time (freeMemGB), so a PC that is busy with something else starts fewer checks. One check can always run alone.
export async function runAll(checks, ctx, { keepGoing = false, parallel = 2, selfTest = false, log = () => {}, hooks = {}, budget = null, freeMemGB = () => freemem() / 2 ** 30 } = {}) {
  const results = new Map()
  const pending = [...checks]
  const running = new Set()
  const laneBusy = { cargo: false, electron: false }
  const used = new Map() // id -> cost of what is running now
  let freeRunning = 0
  let aloneRunning = false
  const fits = (c) => {
    if (!budget || used.size === 0) return true
    const cost = costOf(c)
    // A check marked `alone` (or any check once `budget.maxParallel` are running) waits for a quiet machine; so does everything while one runs.
    if (isAlone(c) || aloneRunning) return false
    if (budget.maxParallel && used.size >= budget.maxParallel) return false
    let cpu = 0
    for (const u of used.values()) cpu += u.cpu
    if (cpu + cost.cpu > budget.cpu) return false
    return freeMemGB() - (budget.reserveGB ?? 3) >= cost.memGB
  }
  let failed = false
  const ids = new Set(checks.map((c) => c.id))

  const settle = (check, r, ms) => {
    results.set(check.id, { id: check.id, title: check.title, ...r, ms })
    log(`[${r.status.padEnd(7)}] ${check.id} (${(ms / 1000).toFixed(1)}s)${r.detail ? ': ' + r.detail : ''}`)
    hooks.settle?.(check, r, ms)
    if (r.status === 'FAIL' || r.status === 'NOT RUN') failed = true
  }

  await new Promise((resolve) => {
    const pump = () => {
      // Resolve anything that can no longer start.
      for (let i = 0; i < pending.length; ) {
        const c = pending[i]
        const deps = (c.after ?? []).filter((d) => ids.has(d))
        const badDep = deps.find((d) => results.has(d) && results.get(d).status !== 'PASS')
        if (!keepGoing && failed && !selfTest) {
          pending.splice(i, 1)
          settle(c, { status: 'NOT RUN', detail: 'stopped after the first failure (use --keep-going)' }, 0)
        } else if (badDep) {
          pending.splice(i, 1)
          settle(c, { status: 'NOT RUN', detail: `needs ${badDep}, which did not pass` }, 0)
        } else i++
      }
      const waiting = []
      for (let i = 0; i < pending.length; ) {
        const c = pending[i]
        const ready = (c.after ?? []).every((d) => !ids.has(d) || results.has(d))
        const laneFree = c.lane === 'free' ? freeRunning < parallel : !laneBusy[c.lane]
        const roomLeft = ready && laneFree ? fits(c) : true
        if (!ready || !laneFree || !roomLeft) {
          // Say why it waits, so a long pause reads as "queued behind X", not as a hang.
          const unmet = (c.after ?? []).filter((d) => ids.has(d) && !results.has(d))
          waiting.push({ id: c.id, reason: !ready ? `after ${unmet.join(', ')}` : !laneFree ? (c.lane === 'free' ? `all ${parallel} parallel slots busy` : `the ${c.lane} lane is busy`) : 'waiting for free processor or memory' })
          i++
          continue
        }
        pending.splice(i, 1)
        if (c.lane === 'free') freeRunning++
        else laneBusy[c.lane] = true
        used.set(c.id, costOf(c))
        if (isAlone(c)) aloneRunning = true
        log(`[start  ] ${c.id}: ${c.title}${c.estSeconds ? ` (about ${c.estSeconds}s)` : ''}`)
        hooks.start?.(c)
        const t0 = Date.now()
        const p = runOne(c, hooks.output ? { ...ctx, onLine: (line) => hooks.output(c, line) } : ctx, { selfTest })
          .catch((e) => ({ status: 'FAIL', detail: String(e?.message ?? e) }))
          .then((r) => {
            settle(c, r, Date.now() - t0)
            if (c.lane === 'free') freeRunning--
            else laneBusy[c.lane] = false
            used.delete(c.id)
            if (isAlone(c)) aloneRunning = false
            running.delete(p)
            pump()
          })
        running.add(p)
      }
      hooks.queue?.(waiting)
      if (!pending.length && !running.size) resolve()
    }
    pump()
  })
  return checks.map((c) => results.get(c.id))
}

export function summarise(tier, results, skipped, totalMs) {
  const n = (s) => results.filter((r) => r.status === s).length
  const failed = n('FAIL')
  const notRun = n('NOT RUN')
  const line = `MEERKAT ${tier}: ${n('PASS')} passed, ${failed} failed, ${notRun} not run, ${skipped} skipped in ${(totalMs / 1000).toFixed(1)}s`
  return { line, exitCode: failed === 0 && notRun === 0 ? 0 : 1 }
}

export function table(results) {
  const w = Math.max(4, ...results.map((r) => r.id.length))
  return results
    .map((r) => `${r.status.padEnd(7)}  ${r.id.padEnd(w)}  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.detail ?? ''}`)
    .join('\n')
}
