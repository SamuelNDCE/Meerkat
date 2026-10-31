// Runtime robustness checks: things most scanners never do because they need to RUN the project. They execute project code, so they are
// opt-in (--include runtime) and only ever run in a temp copy of the git-tracked files, with a scrubbed environment (thorough/sandbox.mjs).
// See docs/robustness.md.
//   node thorough/robustness.mjs <check> [--root <dir>]      node thorough/robustness.mjs <check> --fixtures   (must exit 1)
// Checks: tz-locale-matrix, test-order-independence, parallel-safety, reproducible-build, crash-fuzz, idempotent-cli,
//         unused-dependency-proof, slow-test-regression.
// Budgets: .meerkat-budgets.json under "robustness" (see budgets() below). MEERKAT_ROBUSTNESS_BUDGETS (a JSON object) overrides single values.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism, homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NOT_RUN, finding, main, notRun, readBudgets, withFixture } from './kit.mjs'
import { cleanup, detectCommands, makeCleanCopy, makeTemp, runIn, safe, scrubbedEnv } from './sandbox.mjs'

const MB = 1024 * 1024

// ---------------------------------------------------------------- budgets
export function budgets(root, envText = process.env.MEERKAT_ROBUSTNESS_BUDGETS) {
  let env = {}
  try {
    env = JSON.parse(envText || '{}')
  } catch {
    /* a bad override is no override */
  }
  const b = { ...(readBudgets(root)?.robustness ?? {}), ...env }
  const n = (v, d, lo = 1, hi = 86_400) => (Number.isFinite(Number(v)) && Number(v) >= lo ? Math.min(Number(v), hi) : d)
  const args = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 100 && !/[\0\r\n]/.test(x)).slice(0, 12) : null)
  return {
    tzCases: Math.floor(n(b.tzCases, 4, 1, 5)),
    localeCases: Math.floor(n(b.localeCases, 3, 1, 4)),
    orderRuns: Math.floor(n(b.orderRuns, 2, 1, 6)),
    parallelRuns: Math.floor(n(b.parallelRuns, 2, 1, 5)),
    fuzzCases: Math.floor(n(b.fuzzCases, 400, 10, 5000)),
    seed: Math.floor(n(b.seed, 1, 0, 2 ** 31 - 1)),
    installSeconds: n(b.installSeconds, 600),
    buildSeconds: n(b.buildSeconds, 600),
    testSeconds: n(b.testSeconds, 600),
    totalSeconds: n(b.totalSeconds, 1500),
    depChecks: Math.floor(n(b.depChecks, 12, 1, 12)),
    regressionFactor: n(b.regressionFactor, 3, 1.1, 100),
    regressionMs: n(b.regressionMs, 500, 1, 3_600_000),
    // For runners Meerkat does not know: extra arguments appended to the test command (each entry of orderArgs is one variant; <seed> is replaced).
    orderArgs: args(b.orderArgs),
    serialArgs: args(b.serialArgs),
    parallelArgs: args(b.parallelArgs),
  }
}

// ---------------------------------------------------------------- shared helpers
const sub = (state, id, why = '') => console.log(`MEERKAT-SUB ${state} ${id}${why ? ` ${safe(why).replace(/\s+/g, ' ').slice(0, 190)}` : ''}`)
const lastLines = (text, n = 3) => String(text).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n)
const NETWORK = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|getaddrinfo|network (error|is unreachable)|fetch failed|Could not resolve host|Temporary failure in name resolution|no such host|dial tcp|Failed to fetch|Connection timed out/i
const show = (argv) => argv.join(' ')
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
// A rule id that satisfies /^[a-z0-9][a-z0-9-]{0,60}$/ however long the parts are.
export function subId(...parts) {
  const full = parts.map(slug).filter(Boolean).join('-') || 'x'
  if (full.length <= 60) return full
  return `${full.slice(0, 51)}-${createHash('sha1').update(full).digest('hex').slice(0, 8)}`
}
const secs = (ms) => (ms / 1000).toFixed(1)
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const notRunReason = (reason) => Object.assign(new Error('not run'), { notRunReason: reason })

// A clean copy plus a scrubbed environment, or a NOT RUN reason.
function prepare(root) {
  const copy = makeCleanCopy(root, { trackedOnly: true, maxMb: 200 })
  if (!copy.ok) return { reason: copy.reason }
  const home = makeTemp('meerkat-home-')
  const done = () => {
    cleanup(copy.dir)
    cleanup(home)
  }
  return { copy, home, root, cmds: detectCommands(copy.dir), pkg: readJson(join(copy.dir, 'package.json')), done, env: (extra = {}) => scrubbedEnv(extra, { home }) }
}
// A program that is not installed here is NOT RUN, never a failure of the project.
const step = async (p, argv, seconds, env = p.env()) => {
  const r = await runIn(p.copy.dir, argv[0], argv.slice(1), { timeoutMs: seconds * 1000, env, maxOutputKb: 256 })
  if (r.code === 127 && !r.timedOut && /^(\S+: command not found|spawn .* ENOENT)\s*$/.test(r.output.trim())) throw notRunReason(`${argv[0]} is not installed or not on PATH here`)
  return r
}
const guard = (fn) => async (root) => {
  try {
    return await fn(root)
  } catch (e) {
    if (e?.notRunReason) return notRun(e.notRunReason)
    throw e
  }
}
// Walks a folder (no node_modules, .git) and returns relative paths with forward slashes.
function listFiles(dir, skip = new Set(['node_modules', '.git'])) {
  const out = []
  const go = (d, rel) => {
    let entries = []
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) go(join(d, e.name), r)
      else if (e.isFile()) out.push(r)
    }
  }
  go(dir, '')
  return out
}
// Size of a folder, or null once it passes `cap` bytes (stops early).
function cappedSize(dir, cap) {
  let total = 0
  const go = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (go(p) === null) return null
      } else if (e.isFile()) {
        total += statSync(p).size
        if (total > cap) return null
      }
    }
    return total
  }
  try {
    return go(dir)
  } catch {
    return null
  }
}
// Gives the copy its dependencies. A project with no install step needs none. Otherwise the project's own node_modules is copied (offline,
// the same versions you run), and only when that is missing or huge is the install command run (which may need the network: NOT RUN then).
async function provideDeps(p, b) {
  if (!p.cmds.install) return 'no dependencies to install'
  const nm = join(p.root, 'node_modules')
  if (p.cmds.ecosystems.includes('node') && existsSync(nm) && cappedSize(nm, 300 * MB) !== null) {
    cpSync(nm, join(p.copy.dir, 'node_modules'), { recursive: true })
    return 'copied the project node_modules into the temp copy'
  }
  const r = await step(p, p.cmds.install, b.installSeconds)
  if (r.code !== 0) throw notRunReason(NETWORK.test(r.output) ? `the dependency install (${show(p.cmds.install)}) needs the network and it is not reachable` : `the dependency install (${show(p.cmds.install)}) failed: ${safe(lastLines(r.output, 1)[0] ?? '')}`)
  return `ran ${show(p.cmds.install)}`
}
function printTail(output, n = 3, indent = '    ') {
  for (const l of lastLines(output, n)) console.log(`${indent}${safe(l).slice(0, 200)}`)
}
// Prints the findings summary the way every other check does and returns the exit code.
function conclude(name, count, okNote) {
  if (!count) {
    console.log(`${name}: ${okNote}`)
    return 0
  }
  console.log(`${name}: found ${count}`)
  return 1
}

// ---------------------------------------------------------------- runner detection (pure)
// 'vitest' | 'jest' | 'mocha' | 'pytest' | 'go' | 'cargo' | 'custom' | null
export function detectRunner(pkg, ecosystems = [], testCmd = null) {
  const script = String(pkg?.scripts?.test ?? '')
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  if (/\bvitest\b/.test(script) || (deps.vitest && !/\bjest\b|\bmocha\b/.test(script))) return 'vitest'
  if (/\bjest\b/.test(script) || (deps.jest && !/\bvitest\b|\bmocha\b/.test(script))) return 'jest'
  if (/\bmocha\b/.test(script)) return 'mocha'
  if (ecosystems.includes('go')) return 'go'
  if (ecosystems.includes('rust')) return 'cargo'
  if (ecosystems.includes('python')) return 'pytest'
  if (testCmd) return 'custom'
  return null
}
const fill = (args, seed) => args.map((a) => a.replace(/<seed>/g, String(seed)))
// The full command for the test command plus extra runner arguments. npm passes them after "--".
export function withArgs(testCmd, extra, kind = null) {
  if (testCmd[0] === 'npm' || testCmd[0] === 'pnpm' || testCmd[0] === 'yarn') return [...testCmd, ...(testCmd[0] === 'yarn' ? [] : ['--']), ...extra]
  if (kind === 'go') return [testCmd[0], testCmd[1], ...extra, ...testCmd.slice(2)]
  if (kind === 'cargo') return [...testCmd, '--', ...extra]
  return [...testCmd, ...extra]
}

// Order variants: [{ id, argv, why }]. Empty when the runner has no safe native way to reorder.
export function orderVariants(runner, testCmd, { runs = 2, seeds = [], custom = null } = {}) {
  const seedList = seeds.length ? seeds : Array.from({ length: runs }, (_, i) => i + 1)
  const out = []
  if (custom?.length) {
    custom.slice(0, runs).forEach((a, i) => out.push({ id: `order-${i + 1}`, argv: withArgs(testCmd, fill([a], seedList[i % seedList.length]), runner), why: `${a.replace(/<seed>/g, seedList[i % seedList.length])}` }))
    return out
  }
  for (const seed of seedList.slice(0, runs)) {
    if (runner === 'vitest') out.push({ id: `shuffle-seed-${seed}`, argv: withArgs(testCmd, ['--sequence.shuffle', `--sequence.seed=${seed}`], runner), why: `vitest --sequence.shuffle --sequence.seed=${seed}` })
    else if (runner === 'jest') out.push({ id: `randomize-seed-${seed}`, argv: withArgs(testCmd, ['--randomize', `--seed=${seed}`], runner), why: `jest --randomize --seed=${seed}` })
    else if (runner === 'go') out.push({ id: `shuffle-seed-${seed}`, argv: withArgs(testCmd, [`-shuffle=${seed}`], runner), why: `go test -shuffle=${seed}` })
  }
  return out
}
// Parallel modes: { serial, parallel } argument lists, or null.
export function parallelModes(runner, { cpus = 4, custom = {} } = {}) {
  if (custom.serialArgs?.length && custom.parallelArgs?.length) return { serial: custom.serialArgs, parallel: custom.parallelArgs, serialWhy: custom.serialArgs.join(' '), parallelWhy: custom.parallelArgs.join(' ') }
  if (runner === 'vitest') return { serial: ['--pool=threads', '--no-file-parallelism'], parallel: [], serialWhy: 'vitest --pool=threads --no-file-parallelism', parallelWhy: 'vitest default (files in parallel)' }
  if (runner === 'jest') return { serial: ['-i'], parallel: ['-w', String(Math.max(2, cpus))], serialWhy: 'jest -i (one process)', parallelWhy: `jest -w ${Math.max(2, cpus)}` }
  if (runner === 'go') return { serial: ['-p', '1'], parallel: ['-p', String(Math.max(2, cpus))], serialWhy: 'go test -p 1', parallelWhy: `go test -p ${Math.max(2, cpus)}` }
  if (runner === 'cargo') return { serial: ['--test-threads=1'], parallel: [`--test-threads=${Math.max(2, cpus)}`], serialWhy: 'cargo test -- --test-threads=1', parallelWhy: `cargo test -- --test-threads=${Math.max(2, cpus)}` }
  return null
}
const UNSUPPORTED = /unrecognized (cli )?(parameter|option|argument)|unknown (option|argument|flag)|unexpected argument|flag provided but not defined|no such option|error: unrecognized arguments/i

// ---------------------------------------------------------------- 1. tz-locale-matrix
export const TZ_ORDER = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']
export const LOCALE_ORDER = ['C', 'tr_TR.UTF-8', 'de_DE.UTF-8', 'en_US.UTF-8']
export const TZ_WHY = {
  'America/Los_Angeles': 'it has daylight saving time and sits 7 to 8 hours behind UTC, so "today" is a different date for part of every day',
  'Asia/Kolkata': 'its offset is 5 hours 30 minutes, a half hour, which breaks code that assumes whole hours',
  'Pacific/Kiritimati': 'it is UTC+14, the earliest time on Earth, so its calendar date is ahead of almost everyone',
  'Pacific/Pago_Pago': 'it is UTC-11, the latest time on Earth, so its calendar date is behind almost everyone',
}
export const LOCALE_WHY = {
  'tr_TR.UTF-8': 'Turkish has a dotted and a dotless i, so upper-casing "i" or lower-casing "I" gives different letters than in English',
  'de_DE.UTF-8': 'German writes 1.234,5 where English writes 1,234.5 and orders letters differently',
  'en_US.UTF-8': 'a UTF-8 locale instead of the plain C locale',
}
// Deterministic variants. The first entry is always the baseline (UTC, locale C). Counts include the baseline.
export function tzLocaleVariants(tzCases = 4, localeCases = 3) {
  const base = { id: 'baseline', TZ: 'UTC', LANG: 'C', label: 'TZ=UTC LANG=C' }
  const out = [base]
  for (const tz of TZ_ORDER.slice(0, tzCases).filter((t) => t !== 'UTC')) out.push({ id: subId('tz', tz), TZ: tz, LANG: 'C', label: `TZ=${tz} LANG=C`, kind: 'timezone', value: tz })
  for (const l of LOCALE_ORDER.slice(0, localeCases).filter((x) => x !== 'C')) out.push({ id: subId('locale', l.replace(/\.UTF-8$/, '')), TZ: 'UTC', LANG: l, label: `TZ=UTC LANG=${l}`, kind: 'locale', value: l })
  return out
}
async function tzLocaleMatrix(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    if (!p.cmds.test) {
      sub('NA', 'baseline', 'no test command detected')
      return notRun('no test command could be detected (package.json "test" script, pytest, go.mod, Cargo.toml, .csproj)')
    }
    console.log(`tz-locale-matrix: ${p.copy.copied} tracked file(s) copied; running ${safe(show(p.cmds.test))} under different time zones and locales`)
    console.log(`  deps: ${await provideDeps(p, b)}`)
    let variants = tzLocaleVariants(b.tzCases, b.localeCases)
    const env = (v) => p.env({ TZ: v.TZ, LANG: v.LANG, LC_ALL: v.LANG })
    const base = await step(p, p.cmds.test, b.testSeconds, env(variants[0]))
    if (base.code !== 0) {
      const why = base.timedOut ? `the tests did not finish within ${b.testSeconds}s (budget robustness.testSeconds)` : 'the tests already fail in the baseline (TZ=UTC LANG=C), so a time zone cannot be blamed'
      sub('NA', 'baseline', why)
      console.log(`  baseline: ${why}`)
      printTail(base.output)
      return notRun(why)
    }
    sub('PASS', 'baseline', `${show(p.cmds.test)} passed with TZ=UTC LANG=C in ${secs(base.ms)}s`)
    console.log(`  ${variants[0].label}: passed (${secs(base.ms)}s)`)
    const room = Math.max(0, Math.floor((b.totalSeconds * 1000) / Math.max(base.ms, 1)) - 1)
    const skipped = variants.slice(1).slice(room)
    variants = variants.slice(0, 1 + room)
    for (const v of skipped) sub('NA', v.id, `skipped: ${show(p.cmds.test)} takes ${secs(base.ms)}s, more than fits in robustness.totalSeconds (${b.totalSeconds}s)`)
    let count = 0
    for (const v of variants.slice(1)) {
      const r = await step(p, p.cmds.test, b.testSeconds, env(v))
      if (r.code === 0) {
        sub('PASS', v.id, `passed with ${v.label} in ${secs(r.ms)}s`)
        console.log(`  ${v.label}: passed (${secs(r.ms)}s)`)
        continue
      }
      count++
      const reason = r.timedOut ? `did not finish in ${b.testSeconds}s` : `failed (exit ${r.code})`
      sub('FAIL', v.id, `${reason} with ${v.label} but passed with TZ=UTC LANG=C`)
      console.log(`  ${v.label}: ${reason}, while the same tests PASS with TZ=UTC LANG=C`)
      console.log(`    plain words: a ${v.kind === 'timezone' ? 'time-zone' : 'locale'}-dependent bug. The code or a test only works on machines set to UTC or English. ${v.kind === 'timezone' ? TZ_WHY[v.value] : LOCALE_WHY[v.value]}.`)
      console.log('    last lines of its output:')
      printTail(r.output, 3, '      ')
      finding(v.kind === 'timezone' ? 'medium' : 'low', v.kind === 'timezone' ? 'timezone-dependent-test' : 'locale-dependent-test', '.', 0, `tests pass in UTC but fail with ${v.label} (${show(p.cmds.test)})`)
    }
    if (process.platform === 'win32') console.log('  note: on Windows, Node and many tools ignore LANG and LC_ALL, so locale variants may not change anything here; time zones do apply')
    return conclude('tz-locale-matrix', count, `the tests give the same result in ${variants.length} environment(s)`)
  } finally {
    p.done()
  }
}

// ---------------------------------------------------------------- 2. test-order-independence
async function pytestReversed(p, b, env) {
  const r = await step(p, ['python', '-m', 'pytest', '--collect-only', '-q', '-p', 'no:randomly'], b.testSeconds, env)
  const ids = r.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => /::/.test(l) && !/\s/.test(l))
  if (r.code !== 0 || ids.length < 2 || ids.length > 3000) return null
  return ['python', '-m', 'pytest', '-q', '-p', 'no:randomly', ...ids.reverse()]
}
async function testOrderIndependence(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    if (!p.cmds.test) {
      sub('NA', 'baseline', 'no test command detected')
      return notRun('no test command could be detected')
    }
    const runner = detectRunner(p.pkg, p.cmds.ecosystems, p.cmds.test)
    let variants = orderVariants(runner, p.cmds.test, { runs: b.orderRuns, seeds: [], custom: b.orderArgs })
    if (!variants.length && runner === 'pytest') variants = [{ id: 'reversed', argv: null, why: 'pytest with the collected test ids in reverse order' }]
    if (!variants.length) {
      const why = runner === 'mocha' ? 'mocha has no native way to shuffle tests (set robustness.orderArgs in .meerkat-budgets.json to name a flag of your own runner)' : `no safe native way to reorder tests for this runner (${runner ?? 'unknown'}); set robustness.orderArgs in .meerkat-budgets.json to name one`
      sub('NA', 'order', why)
      return notRun(why)
    }
    console.log(`test-order-independence: runner ${runner}; ${p.copy.copied} tracked file(s) copied`)
    console.log(`  deps: ${await provideDeps(p, b)}`)
    const baseCmd = runner === 'pytest' ? ['python', '-m', 'pytest', '-q', '-p', 'no:randomly'] : p.cmds.test
    const base = await step(p, baseCmd, b.testSeconds)
    if (base.code !== 0) {
      const why = base.timedOut ? `the tests did not finish within ${b.testSeconds}s` : 'the tests already fail in their normal order'
      sub('NA', 'baseline', why)
      printTail(base.output)
      return notRun(why)
    }
    sub('PASS', 'baseline', `${show(baseCmd)} passed in the normal order (${secs(base.ms)}s)`)
    console.log(`  normal order: passed (${secs(base.ms)}s)`)
    let count = 0
    let ran = 0
    for (const v of variants) {
      let argv = v.argv
      if (runner === 'pytest') {
        argv = await pytestReversed(p, b, p.env())
        if (!argv) {
          sub('NA', v.id, 'could not list the pytest test ids safely')
          continue
        }
      }
      const r = await step(p, argv, b.testSeconds)
      if (r.code !== 0 && UNSUPPORTED.test(r.output)) {
        sub('NA', v.id, `the installed runner does not support ${v.why}`)
        console.log(`  ${v.why}: not supported by the installed runner version (skipped)`)
        continue
      }
      ran++
      if (r.code === 0) {
        sub('PASS', v.id, `passed with ${v.why}`)
        console.log(`  ${v.why}: passed (${secs(r.ms)}s)`)
        continue
      }
      count++
      sub('FAIL', v.id, `failed with ${v.why} but passed in the normal order`)
      console.log(`  ${v.why}: FAILED, while the normal order passes`)
      console.log('    plain words: some tests depend on other tests having run first (shared files, globals, a database row, the order of a list). Run the failing test alone to find which one.')
      console.log('    last lines of its output:')
      printTail(r.output, 3, '      ')
      finding('medium', 'order-dependent-tests', '.', 0, `tests pass in their normal order but fail with ${v.why}: hidden coupling between tests`)
    }
    if (!ran) return notRun('the installed test runner supports none of the reordering options')
    return conclude('test-order-independence', count, `the tests pass in ${ran} different order(s) as well`)
  } finally {
    p.done()
  }
}

// ---------------------------------------------------------------- 3. parallel-safety
async function parallelSafety(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    if (!p.cmds.test) {
      sub('NA', 'serial', 'no test command detected')
      return notRun('no test command could be detected')
    }
    const runner = detectRunner(p.pkg, p.cmds.ecosystems, p.cmds.test)
    const modes = parallelModes(runner, { cpus: availableParallelism(), custom: { serialArgs: b.serialArgs, parallelArgs: b.parallelArgs } })
    if (!modes) {
      const why = `no native single-thread versus parallel switch for this runner (${runner ?? 'unknown'}); set robustness.serialArgs and robustness.parallelArgs in .meerkat-budgets.json to name them`
      sub('NA', 'parallel', why)
      return notRun(why)
    }
    console.log(`parallel-safety: runner ${runner}; ${p.copy.copied} tracked file(s) copied`)
    console.log(`  deps: ${await provideDeps(p, b)}`)
    const serial = await step(p, withArgs(p.cmds.test, modes.serial, runner), b.testSeconds)
    if (serial.code !== 0 && UNSUPPORTED.test(serial.output)) {
      sub('NA', 'serial', `the installed runner does not accept ${modes.serialWhy}`)
      return notRun(`the installed runner does not accept ${modes.serialWhy}`)
    }
    const results = [{ mode: 'serial', why: modes.serialWhy, r: serial }]
    for (let i = 0; i < b.parallelRuns; i++) results.push({ mode: 'parallel', why: modes.parallelWhy, r: await step(p, withArgs(p.cmds.test, modes.parallel, runner), b.testSeconds) })
    for (const x of results) console.log(`  ${x.mode} (${x.why}): ${x.r.code === 0 ? 'passed' : x.r.timedOut ? 'timed out' : `FAILED (exit ${x.r.code})`} (${secs(x.r.ms)}s)`)
    const par = results.filter((x) => x.mode === 'parallel')
    const parFail = par.filter((x) => x.r.code !== 0)
    if (serial.code !== 0 && parFail.length === par.length) {
      sub('NA', 'parallel-vs-serial', 'the tests fail in every mode, so they are broken, not racy')
      printTail(serial.output)
      return notRun('the tests fail in every mode (broken, not a race); fix them first')
    }
    if (serial.code === 0 && !parFail.length) {
      sub('PASS', 'serial', `passed one at a time (${secs(serial.ms)}s)`)
      sub('PASS', 'parallel', `passed ${par.length} time(s) in parallel`)
      return conclude('parallel-safety', 0, `the tests pass one at a time and in parallel (${par.length} parallel run(s))`)
    }
    if (serial.code === 0) {
      sub('PASS', 'serial', 'passed one at a time')
      sub('FAIL', 'parallel', `failed in ${parFail.length} of ${par.length} parallel run(s) but passes one at a time`)
      console.log('  plain words: the tests pass one at a time and fail when run together, so they share something (a file, a port, a database, a global) and step on each other. Give each test its own temp folder, port or table.')
      console.log('    last lines of the failing parallel run:')
      printTail(parFail[0].r.output, 3, '      ')
      finding('medium', 'parallel-unsafe-tests', '.', 0, `tests pass one at a time but fail in parallel (${modes.parallelWhy}): shared state between tests`)
      return conclude('parallel-safety', 1, '')
    }
    sub('FAIL', 'serial', 'failed one at a time but passes in parallel')
    sub('PASS', 'parallel', 'passed in parallel')
    console.log('  plain words: the tests pass in parallel and fail one at a time, so some test only works because another one ran at the same time (a leftover server, a shared warm cache).')
    printTail(serial.output, 3, '      ')
    finding('medium', 'serial-only-failure', '.', 0, `tests fail one at a time (${modes.serialWhy}) but pass in parallel: a test relies on another running at the same time`)
    return conclude('parallel-safety', 1, '')
  } finally {
    p.done()
  }
}

// ---------------------------------------------------------------- 4. reproducible-build
const BUILD_SKIP = new Set(['node_modules', '.git', '.cache', '.turbo', '.vite', '.parcel-cache', 'incremental', '.fingerprint'])
const VOLATILE = /\.(tsbuildinfo)$/i
// rel path -> { sha, text } for every file of a copy (text only for small non-binary files).
function hashTree(dir) {
  const map = new Map()
  for (const rel of listFiles(dir, BUILD_SKIP)) {
    if (/\.log$/i.test(rel) || rel.startsWith('.next/cache/')) continue
    let buf
    try {
      buf = readFileSync(join(dir, rel))
    } catch {
      continue
    }
    const text = buf.length <= 2 * MB && !buf.includes(0) ? buf.toString('utf8') : null
    map.set(rel, { sha: sha(buf), text })
  }
  return map
}
// Why two versions of the same file differ, in plain words. Pure.
export function explainDiff(a, b, roots = []) {
  const x = String(a)
  const y = String(b)
  const m = Math.min(x.length, y.length)
  let i = 0
  while (i < m && x[i] === y[i]) i++
  let j = 0
  while (j < m - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++
  const word = /[\w:.\-+/\\]/
  let sx = i
  while (sx > 0 && word.test(x[sx - 1])) sx--
  let ex = x.length - j
  while (ex < x.length && word.test(x[ex])) ex++
  let sy = i - (i - sx)
  let ey = y.length - j
  while (ey < y.length && word.test(y[ey])) ey++
  const ta = x.slice(sx, ex).slice(0, 80)
  const tb = y.slice(sy, ey).slice(0, 80)
  const both = `${ta} ${tb}`
  let reason = 'different content'
  if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(both) || /\b1[5-9]\d{11}\b/.test(both) || /\b1[5-9]\d{8}\b/.test(both) || /^\d{10,}$/.test(ta) || /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*\d{2}:\d{2}:\d{2}/.test(both)) reason = 'an embedded timestamp'
  else if (roots.some((r) => r && (both.includes(r) || both.includes(r.replace(/\\/g, '/'))))) reason = 'an absolute path of the build folder'
  else if (/[0-9a-f]{8,}/i.test(ta) && /[0-9a-f]{8,}/i.test(tb)) reason = 'a random id or a hash of different content'
  return { reason, a: ta.replace(/\s+/g, ' '), b: tb.replace(/\s+/g, ' ') }
}
// Compares two output maps. Returns [{ file, kind: 'differs'|'volatile'|'only-one', reason }]. Pure (roots are the two build folders).
export function compareBuilds(outA, outB, rootA, rootB) {
  const res = []
  const norm = (t, r) => (t === null ? null : t.split(r).join('<ROOT>').split(r.replace(/\\/g, '/')).join('<ROOT>'))
  for (const f of new Set([...outA.keys(), ...outB.keys()])) {
    const a = outA.get(f)
    const b = outB.get(f)
    if (!a || !b) {
      res.push({ file: f, kind: 'only-one', reason: 'the file exists after one build and not after the other' })
      continue
    }
    if (a.sha === b.sha) continue
    if (VOLATILE.test(f)) {
      res.push({ file: f, kind: 'volatile', reason: 'a TypeScript build cache; it records build-folder paths and is expected to differ' })
      continue
    }
    const na = norm(a.text, rootA)
    const nb = norm(b.text, rootB)
    if (na !== null && na === nb) {
      const map = /\.map$/i.test(f)
      res.push({ file: f, kind: map ? 'volatile' : 'differs', reason: map ? 'a source map that records the absolute path of the build folder; only the path differs' : 'it embeds the absolute path of the build folder, so it is different on every machine' })
      continue
    }
    if (na !== null && nb !== null) {
      const d = explainDiff(na, nb, [])
      const d2 = explainDiff(a.text, b.text, [rootA, rootB])
      res.push({ file: f, kind: 'differs', reason: `${d2.reason === 'different content' ? d.reason : d2.reason}: ${safe(d.a).slice(0, 40)} versus ${safe(d.b).slice(0, 40)}` })
    } else res.push({ file: f, kind: 'differs', reason: 'binary content differs between the two builds' })
  }
  return res
}
async function reproducibleBuild(root) {
  const b = budgets(root)
  const p1 = prepare(root)
  if (p1.reason) return notRun(p1.reason)
  const p2 = prepare(root)
  if (p2.reason) {
    p1.done()
    return notRun(p2.reason)
  }
  try {
    if (!p1.cmds.build) {
      sub('NA', 'build', 'no build command detected')
      return notRun('no build command could be detected (package.json "build" script, go.mod, Cargo.toml, pom.xml, .csproj)')
    }
    console.log(`reproducible-build: building twice in two separate clean copies with ${safe(show(p1.cmds.build))}`)
    const out = []
    for (const [n, p] of [[1, p1], [2, p2]]) {
      console.log(`  copy ${n}: deps: ${await provideDeps(p, b)}`)
      const before = hashTree(p.copy.dir)
      const r = await step(p, p.cmds.build, b.buildSeconds)
      if (r.code !== 0) {
        const why = r.timedOut ? `the build did not finish in ${b.buildSeconds}s` : NETWORK.test(r.output) ? 'the build needs the network and it is not reachable' : `the build fails in a clean copy (exit ${r.code}); clean-copy-builds reports why`
        sub('NA', 'build', why)
        printTail(r.output)
        return notRun(why)
      }
      const after = hashTree(p.copy.dir)
      const outputs = new Map()
      for (const [f, v] of after) if (!before.has(f) || before.get(f).sha !== v.sha) outputs.set(f, v)
      out.push(outputs)
      console.log(`  copy ${n}: build passed in ${secs(r.ms)}s, ${outputs.size} output file(s)`)
    }
    if (!out[0].size && !out[1].size) {
      sub('NA', 'outputs', 'the build wrote no files')
      return notRun('the build command wrote no files in the copy, so there is nothing to compare')
    }
    const diffs = compareBuilds(out[0], out[1], p1.copy.dir, p2.copy.dir)
    const bad = diffs.filter((d) => d.kind !== 'volatile')
    const volatile = diffs.filter((d) => d.kind === 'volatile')
    for (const v of volatile) console.log(`  ignored (known to vary): ${safe(v.file)}: ${v.reason}`)
    if (!bad.length) {
      sub('PASS', 'identical-outputs', `${out[0].size} file(s) are byte-identical in both builds${volatile.length ? ` (${volatile.length} known-volatile file(s) ignored)` : ''}`)
      return conclude('reproducible-build', 0, `two clean builds produced identical output (${out[0].size} file(s))`)
    }
    sub('FAIL', 'identical-outputs', `${bad.length} of ${out[0].size} output file(s) differ between two builds of the same source`)
    console.log('  plain words: building the same source twice gave different files, so a build cannot be verified or cached and a release cannot be traced to its source.')
    for (const d of bad.slice(0, 20)) {
      console.log(`  ${safe(d.file)}: ${safe(d.reason)}`)
      finding('medium', 'non-reproducible-build', d.file.length < 280 ? d.file : '.', 0, `differs between two clean builds: ${d.reason}`)
    }
    if (bad.length > 20) console.log(`  ... and ${bad.length - 20} more`)
    return conclude('reproducible-build', bad.length, '')
  } finally {
    p1.done()
    p2.done()
  }
}

// ---------------------------------------------------------------- 5. crash-fuzz
// ---- static scan (pure)
export const DESTRUCTIVE_LONG = ['delete', 'remove', 'drop', 'kill', 'write', 'save', 'send', 'exec', 'spawn', 'unlink', 'fetch', 'request', 'connect', 'listen', 'install', 'publish', 'login']
export function looksDestructive(name) {
  const lower = String(name).toLowerCase()
  if (DESTRUCTIVE_LONG.some((w) => lower.includes(w))) return true
  const tokens = String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_$-]+/).map((t) => t.toLowerCase()).filter(Boolean)
  return tokens.some((t) => t === 'rm' || t.startsWith('pay'))
}
const BANNED_MODULES = new Set(['fs', 'fs/promises', 'child_process', 'net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'cluster', 'worker_threads', 'vm', 'inspector', 'repl', 'readline'])
const BANNED_PACKAGES = /^(axios|node-fetch|got|undici|request|superagent|ws|socket\.io|express|fastify|koa|puppeteer|playwright|execa|shelljs|fs-extra|rimraf|cross-spawn|open|mongodb|mongoose|pg|mysql2?|redis|ioredis|aws-sdk|@aws-sdk\/.*|firebase.*|@supabase\/.*|stripe)$/
// Module specifiers a JS/TS source imports.
export function importSpecifiers(text) {
  const out = new Set()
  for (const re of [/\bfrom\s*['"]([^'"\n]+)['"]/g, /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, /^\s*import\s+['"]([^'"\n]+)['"]/gm]) for (const m of text.matchAll(re)) out.add(m[1])
  return [...out]
}
export function bannedImports(text) {
  return importSpecifiers(text).filter((s) => BANNED_MODULES.has(s.replace(/^node:/, '')) || BANNED_PACKAGES.test(s))
}
function splitTop(s) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of String(s)) {
    if ('([{<'.includes(ch)) depth++
    else if (')]}>'.includes(ch)) depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((x) => x.trim()).filter(Boolean)
}
// How many arguments to call a function with (1 to 3), or 0 when it takes none, more than three or a rest parameter.
export function paramCount(params) {
  const parts = splitTop(params ?? '')
  if (parts.length < 1 || parts.length > 3 || parts.some((x) => x.startsWith('...'))) return 0
  return parts.length
}
// Exported plain functions of a JS/TS source: [{ name, arity, line }].
export function scanJsExports(text) {
  const out = new Map()
  const lineOf = (idx) => text.slice(0, idx).split('\n').length
  const add = (name, params, idx) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || out.has(name)) return
    const arity = paramCount(params)
    if (arity) out.set(name, { name, arity, line: lineOf(idx) })
  }
  const declared = (name) => {
    const f = new RegExp(`\\bfunction\\s+${name.replace(/\$/g, '\\$')}\\s*(?:<[^>(]*>)?\\s*\\(([^)]*)\\)`).exec(text)
    if (f) return [f[1], f.index]
    const a = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\s*\\w*\\s*\\(([^)]*)\\)|\\(([^)]*)\\)\\s*(?::[^=]+)?=>|(\\w+)\\s*=>)`).exec(text)
    if (a) return [a[1] ?? a[2] ?? a[3] ?? '', a.index]
    return null
  }
  for (const m of text.matchAll(/^[ \t]*export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>(]*>)?\s*\(([^)]*)\)/gm)) add(m[1], m[2], m.index)
  for (const m of text.matchAll(/^[ \t]*export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\s*\w*\s*\(([^)]*)\)|\(([^)]*)\)\s*(?::[^=]+)?=>|(\w+)\s*=>)/gm)) add(m[1], m[2] ?? m[3] ?? m[4] ?? '', m.index)
  for (const m of text.matchAll(/^[ \t]*(?:module\.)?exports\.(\w+)\s*=\s*(?:async\s+)?(?:function\s*\w*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|(\w+)\s*=>)/gm)) add(m[1], m[2] ?? m[3] ?? m[4] ?? '', m.index)
  const lists = []
  for (const m of text.matchAll(/^[ \t]*export\s*\{([^}]*)\}/gm)) lists.push(m[1])
  for (const m of text.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) lists.push(m[1])
  for (const l of lists) {
    for (const item of l.split(',')) {
      const nm = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*(?::\s*(\w+))?\s*$/.exec(item)
      if (!nm) continue
      const local = nm[3] ?? nm[1]
      const d = declared(local)
      if (d) add(nm[2] ?? nm[1], d[0], d[1])
    }
  }
  return [...out.values()]
}
export function scanPyFunctions(text) {
  const out = []
  for (const m of text.matchAll(/^def\s+([A-Za-z]\w*)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?:/gm)) {
    const parts = splitTop(m[2])
    if (parts.length < 1 || parts.length > 3 || parts.some((x) => x.startsWith('*') || x === 'self' || x === 'cls' || x === '/')) continue
    out.push({ name: m[1], arity: parts.length, line: text.slice(0, m.index).split('\n').length })
  }
  return out
}
const PY_BANNED_IMPORT = /^\s*(?:import|from)\s+(subprocess|socket|http|urllib|requests|shutil|sqlite3|ftplib|smtplib|multiprocessing|ctypes|asyncio|threading|pickle|marshal|pty|webbrowser|tempfile|httpx|aiohttp|paramiko|boto3)\b/m
const PY_BANNED_USE = /\bos\.(system|remove|unlink|rmdir|removedirs|popen|exec\w*|spawn\w*|kill|rename|replace|chmod|mkdir|makedirs)\b|\bopen\s*\([^)]*['"][^'"]*[wax+][^'"]*['"]|\.write_(text|bytes)\s*\(|\bos\.environ\b\s*\[[^\]]+\]\s*=/
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|node_modules|fixtures?|vendor|dist|build|coverage)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)conftest\.py$|\.d\.ts$/i

// ---- the corpus and the child harnesses
// The JavaScript harness. It runs INSIDE a child node process (as text: its source is written to a temp file), so it must not use anything
// from this module. Protocol on stdout, each line prefixed "@@MKF@@ ": N <count>, S <idx> <ts> <name>, R <idx> <KIND> <detail>, D, E <why>.
async function harnessMain() {
  const fs = await import('node:fs')
  const { pathToFileURL: toUrl } = await import('node:url')
  const [file, fname, startS, seedS, kS, maxS] = process.argv.slice(2)
  const start = Number(startS)
  const seed = Number(seedS)
  const k = Number(kS)
  const max = Number(maxS)
  const out = (s) => {
    try {
      fs.writeSync(1, `@@MKF@@ ${s}\n`)
    } catch {
      /* the pipe is gone */
    }
  }
  const msg = (e) => String(e && e.message !== undefined ? e.message : e).replace(/\s+/g, ' ').slice(0, 100)
  let a = seed | 0
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const deepFreeze = (o) => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o)
      for (const v of Object.values(o)) deepFreeze(v)
    }
    return o
  }
  const nest = (n, arr) => {
    let x = arr ? [] : {}
    for (let i = 0; i < n; i++) x = arr ? [x] : { a: x }
    return x
  }
  const rInt = Math.floor(rand() * 2e9) - 1e9
  const rFrac = (rand() - 0.5) * 1e6
  const rStr = Array.from({ length: 1 + Math.floor(rand() * 40) }, () => String.fromCharCode(Math.floor(rand() * 65536))).join('')
  const corpus = [
    ['null', () => null],
    ['undefined', () => undefined],
    ['NaN', () => NaN],
    ['Infinity', () => Infinity],
    ['neg-zero', () => -0],
    ['empty-string', () => ''],
    ['string-1mb', () => 'a'.repeat(1 << 20)],
    ['odd-unicode', () => 'a\ud800b\udc00‮‏x\u0000y'],
    ['nested-20-object', () => nest(20, false)],
    ['nested-20-array', () => nest(20, true)],
    ['nested-10000', () => nest(10000, false)],
    ['circular', () => { const o = { name: 'c' }; o.self = o; o.list = [o]; return o }],
    ['array-100000', () => Array.from({ length: 100000 }, (_, i) => i)],
    ['bigint', () => 10n ** 20n],
    ['symbol', () => Symbol('s')],
    ['function', () => function f() {}],
    ['invalid-date', () => new Date(NaN)],
    ['typed-array', () => new Uint8Array(16)],
    ['throwing-proxy', () => new Proxy({}, { get() { throw new Error('proxy get') }, has() { throw new Error('proxy has') }, ownKeys() { throw new Error('proxy ownKeys') } })],
    ['proto-key', () => JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}}}')],
    ['numeric-string-400', () => '9'.repeat(400)],
    ['negative', () => -1],
    ['fraction', () => 2.5],
    ['negative-fraction', () => -0.5],
    ['beyond-safe-integer', () => 2 ** 53],
    ['frozen-object', () => deepFreeze({ a: 1, b: [1, 2, { c: 3 }] }), true],
    ['frozen-array', () => deepFreeze([3, 1, 2]), true],
    ['random-int', () => rInt],
    ['random-fraction', () => rFrac],
    ['random-string', () => rStr],
  ]
  const later = new Set(['null', 'NaN', 'undefined', 'empty-string', 'string-1mb', 'circular', 'negative', 'proto-key', 'nested-10000', 'frozen-object'])
  let cases = []
  for (let pos = 0; pos < k; pos++) {
    for (const [name, make, frozen] of corpus) {
      if (pos > 0 && !later.has(name)) continue
      cases.push({ name: k > 1 ? `arg${pos + 1}:${name}` : name, frozen: !!frozen, make: () => Array.from({ length: k }, (_, i) => (i === pos ? make() : {})) })
    }
  }
  if (cases.length > max) {
    for (let i = cases.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[cases[i], cases[j]] = [cases[j], cases[i]]
    }
    cases = cases.slice(0, max)
  }
  let mod
  try {
    mod = await import(toUrl(file).href)
  } catch (e) {
    out(`E load ${msg(e)}`)
    process.exit(3)
  }
  const fn = mod[fname] ?? mod.default?.[fname]
  if (typeof fn !== 'function') {
    out('E not-a-function')
    process.exit(3)
  }
  const targets = [Object.prototype, Array.prototype, Function.prototype, String.prototype]
  const known = targets.map((t) => new Set(Object.getOwnPropertyNames(t)))
  const polluted = () => {
    const added = []
    targets.forEach((t, i) => {
      for (const n of Object.getOwnPropertyNames(t)) {
        if (!known[i].has(n)) {
          added.push(n)
          try { delete t[n] } catch { /* repair is best effort */ }
        }
      }
    })
    return added
  }
  let cur = -1
  process.on('unhandledRejection', () => {})
  process.on('uncaughtException', (e) => out(`R ${cur} THROW async ${msg(e)}`))
  out(`N ${cases.length}`)
  for (let i = start; i < cases.length; i++) {
    cur = i
    const c = cases[i]
    let args
    try {
      args = c.make()
    } catch (e) {
      out(`R ${i} SKIP ${msg(e)}`)
      continue
    }
    out(`S ${i} ${Date.now()} ${c.name}`)
    let kind = 'OK'
    let detail = ''
    try {
      const v = fn(...args)
      if (v && typeof v.then === 'function') {
        await Promise.race([Promise.resolve(v).then(() => {}, (e) => { kind = 'THROW'; detail = msg(e) }), new Promise((r) => setTimeout(r, 300))])
      }
    } catch (e) {
      detail = msg(e)
      if (e instanceof RangeError && /call stack/i.test(e.message)) kind = 'STACK'
      else if (c.frozen && e instanceof TypeError && /read.only|not extensible|Cannot (add|delete|assign|define)|frozen/i.test(e.message)) kind = 'MUT'
      else kind = 'THROW'
    }
    const added = polluted()
    if (added.length) {
      kind = 'POLLUTE'
      detail = added.slice(0, 3).join(',')
    }
    out(`R ${i} ${kind} ${detail}`)
  }
  out('D')
  process.exit(0)
}
export const JS_HARNESS = `(${harnessMain.toString()})()\n`

export const PY_HARNESS = String.raw`import sys, os, random, math, importlib.util
P = '@@MKF@@ '
def out(s):
    sys.stdout.write(P + s + '\n'); sys.stdout.flush()
file, fname, start, seed, k, mx = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
rnd = random.Random(seed)
sys.path.insert(0, os.getcwd()); sys.path.insert(0, os.path.dirname(file))
def msg(e): return ' '.join(str(e).split())[:100]
def nest(n, arr):
    x = [] if arr else {}
    for _ in range(n): x = [x] if arr else {'a': x}
    return x
def circ():
    o = {'name': 'c'}; o['self'] = o; o['list'] = [o]; return o
rint = rnd.randint(-10**9, 10**9)
corpus = [('None', lambda: None), ('nan', lambda: float('nan')), ('inf', lambda: float('inf')), ('neg-zero', lambda: -0.0), ('empty-string', lambda: ''),
 ('string-1mb', lambda: 'a' * (1 << 20)), ('odd-unicode', lambda: 'a\ud800b‮‏x\x00y'), ('nested-20-dict', lambda: nest(20, False)), ('nested-20-list', lambda: nest(20, True)),
 ('nested-100000', lambda: nest(100000, True)), ('circular', circ), ('list-100000', lambda: list(range(100000))), ('huge-int', lambda: 10 ** 400), ('complex', lambda: complex(1, 2)),
 ('object', lambda: object()), ('lambda', lambda: (lambda: 1)), ('bytes', lambda: b'\xff\x00\xfe'), ('set', lambda: {1, 2}), ('numeric-string-400', lambda: '9' * 400),
 ('negative', lambda: -1), ('fraction', lambda: 2.5), ('negative-fraction', lambda: -0.5), ('beyond-safe-integer', lambda: 2 ** 53), ('random-int', lambda: rint)]
later = {'None', 'nan', 'empty-string', 'string-1mb', 'circular', 'negative', 'nested-100000'}
cases = []
for pos in range(k):
    for name, make in corpus:
        if pos > 0 and name not in later: continue
        cases.append(('arg%d:%s' % (pos + 1, name) if k > 1 else name, pos, make))
if len(cases) > mx:
    rnd.shuffle(cases); cases = cases[:mx]
try:
    spec = importlib.util.spec_from_file_location('mk_target', file); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
except BaseException as e:
    out('E load ' + msg(e)); sys.exit(3)
fn = getattr(mod, fname, None)
if not callable(fn):
    out('E not-a-function'); sys.exit(3)
out('N %d' % len(cases))
import time
for i in range(start, len(cases)):
    name, pos, make = cases[i]
    try:
        args = [make() if j == pos else {} for j in range(k)]
    except BaseException as e:
        out('R %d SKIP %s' % (i, msg(e))); continue
    out('S %d %d %s' % (i, int(time.time() * 1000), name))
    kind, detail = 'OK', ''
    try:
        fn(*args)
    except RecursionError as e:
        kind, detail = 'STACK', msg(e)
    except MemoryError as e:
        kind, detail = 'CRASH', 'MemoryError'
    except Exception as e:
        kind, detail = 'THROW', msg(e)
    out('R %d %s %s' % (i, kind, detail))
out('D'); sys.stdout.flush(); os._exit(0)
`

// Parses the child's stdout. Pure.
export function parseHarness(output) {
  const r = { n: null, cases: new Map(), done: false, error: null, last: null }
  for (const raw of String(output).split(/\r?\n/)) {
    if (!raw.startsWith('@@MKF@@ ')) continue
    const line = raw.slice(8)
    const m = /^(N|S|R|D|E)(?: (.*))?$/.exec(line)
    if (!m) continue
    if (m[1] === 'N') r.n = Number(m[2])
    else if (m[1] === 'D') r.done = true
    else if (m[1] === 'E') r.error = m[2] ?? 'error'
    else if (m[1] === 'S') {
      const s = /^(\d+) (\d+) (.*)$/.exec(m[2] ?? '')
      if (s) {
        r.cases.set(Number(s[1]), { idx: Number(s[1]), ts: Number(s[2]), name: s[3], kind: null, detail: '' })
        r.last = Number(s[1])
      }
    } else if (m[1] === 'R') {
      const x = /^(\d+) (\S+)(?: (.*))?$/.exec(m[2] ?? '')
      if (x) {
        const c = r.cases.get(Number(x[1])) ?? { idx: Number(x[1]), ts: 0, name: '?' }
        c.kind = x[2]
        c.detail = x[3] ?? ''
        r.cases.set(c.idx, c)
      }
    }
  }
  return r
}
const DEEP = /nested|circular/
// Turns a harness result kind into { cls, severity, rule } or null when it is not a finding. Pure.
export function classifyCase(kind, name) {
  switch (kind) {
    case 'OK':
    case 'THROW':
    case 'SKIP':
      return null
    case 'HANG':
      return { cls: 'hang', severity: 'high', rule: 'fuzz-hang' }
    case 'CRASH':
      return { cls: 'crash', severity: DEEP.test(name) ? 'low' : 'medium', rule: 'fuzz-crash' }
    case 'STACK':
      return { cls: 'stack-overflow', severity: DEEP.test(name) ? 'low' : 'medium', rule: 'fuzz-stack-overflow' }
    case 'POLLUTE':
      return { cls: 'corruption', severity: 'high', rule: 'fuzz-prototype-pollution' }
    case 'MUT':
      return { cls: 'corruption', severity: 'medium', rule: 'fuzz-mutates-input' }
    default:
      return null
  }
}
const PLAIN = {
  hang: 'it did not return within 3 seconds: an endless loop or a pattern that gets exponentially slower (a "regex denial of service") on that input',
  crash: 'the whole process died (non-zero exit, out of memory or a native crash) instead of throwing an error that a caller could catch',
  'stack-overflow': 'it recursed until the call stack ran out (RangeError: Maximum call stack size exceeded); very deep input can take a server down',
  corruption: 'it changed something it must not: global prototypes (prototype pollution, which can change every object in the app) or an input it was given frozen',
}

function walkSource(dir) {
  return listFiles(dir).filter((f) => !TEST_PATH.test(f))
}
const JS_EXT = /\.(c|m)?js$/i
const TS_EXT = /\.(m)?ts$/i
function resolveRel(fromFile, spec, copyDir) {
  const base = resolve(dirname(join(copyDir, fromFile)), spec)
  for (const cand of [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, join(base, 'index.js'), join(base, 'index.mjs'), join(base, 'index.ts')]) {
    try {
      if (statSync(cand).isFile()) return cand
    } catch {
      /* next */
    }
  }
  return null
}
// Banned imports of a file and of the relative modules it pulls in (three levels).
function transitiveBanned(copyDir, rel, depth = 0, seen = new Set()) {
  const abs = join(copyDir, rel)
  if (seen.has(abs) || depth > 3) return []
  seen.add(abs)
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    return []
  }
  const found = bannedImports(text).map((x) => `${x} (${rel})`)
  for (const s of importSpecifiers(text).filter((x) => x.startsWith('.'))) {
    const r = resolveRel(rel, s, copyDir)
    if (r) found.push(...transitiveBanned(copyDir, r.slice(copyDir.length + 1).replace(/\\/g, '/'), depth + 1, seen))
  }
  return found
}
// Candidate functions: [{ file, name, arity, line, lang }] plus the skipped list [{ file, name, why }].
export function collectFuzzTargets(copyDir, { ts = !!process.features?.typescript } = {}) {
  const targets = []
  const skipped = []
  for (const rel of walkSource(copyDir)) {
    const isJs = JS_EXT.test(rel) || (ts && TS_EXT.test(rel))
    const isPy = /\.py$/i.test(rel)
    if (!isJs && !isPy) continue
    let text
    try {
      if (statSync(join(copyDir, rel)).size > 400_000) continue
      text = readFileSync(join(copyDir, rel), 'utf8')
    } catch {
      continue
    }
    const fns = isJs ? scanJsExports(text) : scanPyFunctions(text)
    if (!fns.length) continue
    let fileSkip = null
    if (isJs) {
      const banned = transitiveBanned(copyDir, rel)
      if (banned.length) fileSkip = `it imports ${[...new Set(banned)].slice(0, 3).join(', ')}, which can touch files, processes or the network`
      else if (/\bprocess\.(exit|kill)\s*\(|\bserver\.listen\s*\(|^\s*#!/m.test(text) && /^\s*#!/.test(text)) fileSkip = 'it is a command-line script (has a shebang), see idempotent-cli'
    } else if (PY_BANNED_IMPORT.test(text) || PY_BANNED_USE.test(text)) fileSkip = 'it imports or uses something that can touch files, processes or the network'
    for (const f of fns) {
      if (looksDestructive(f.name)) skipped.push({ file: rel, name: f.name, why: 'the name looks destructive' })
      else if (fileSkip) skipped.push({ file: rel, name: f.name, why: fileSkip })
      else targets.push({ file: rel, ...f, lang: isPy ? 'python' : 'js' })
    }
  }
  targets.sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name))
  return { targets, skipped }
}
// Seeded choice of which functions fit in the case budget. Pure.
export function planFuzz(targets, { fuzzCases = 400, seed = 1 } = {}) {
  const a = targets.slice()
  let s = (seed | 0) || 1
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  if (a.length * 8 > fuzzCases) for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  const per = Math.max(8, Math.floor(fuzzCases / Math.max(a.length, 1)))
  const picked = []
  let used = 0
  for (const t of a) {
    const cap = Math.min(per, fuzzCases - used)
    if (cap < 8) break
    picked.push({ ...t, maxCases: cap })
    used += cap
  }
  return picked
}
const permissionFlags = () => (process.allowedNodeEnvironmentFlags.has('--permission') ? ['--permission', '--allow-fs-read=*'] : process.allowedNodeEnvironmentFlags.has('--experimental-permission') ? ['--experimental-permission', '--allow-fs-read=*'] : [])
const HANG_MS = 3000
const CHILD_MS = 4500
const FILE_MS = 30_000

// Runs the corpus against one function, respawning the child after a hang or a crash. Returns { ran, counts, issues, loadError }.
async function fuzzOne(p, t, b, harnessPath, env, flags) {
  const counts = { ok: 0, threw: 0, hang: 0, crash: 0, 'stack-overflow': 0, corruption: 0 }
  const issues = []
  const started = Date.now()
  let start = 0
  let total = null
  let respawns = 0
  const slow = new Map()
  for (;;) {
    const t0 = Date.now()
    const argv = t.lang === 'python' ? ['-I', harnessPath, join(p.copy.dir, t.file), t.name, start, b.seed, t.arity, t.maxCases] : [...flags, '--max-old-space-size=256', harnessPath, join(p.copy.dir, t.file), t.name, start, b.seed, t.arity, t.maxCases]
    const r = await runIn(p.copy.dir, t.lang === 'python' ? 'python' : 'node', argv, { timeoutMs: CHILD_MS, env, maxOutputKb: 1024 })
    if (r.code === 127 && !r.timedOut && /command not found|ENOENT/.test(r.output)) return { loadError: t.lang === 'python' ? 'python is not installed here' : r.output.trim().slice(0, 100) }
    const h = parseHarness(r.output)
    if (h.error) return { loadError: `${h.error}${h.error.startsWith('load') ? '' : ''}`.slice(0, 160) }
    if (h.n !== null) total = h.n
    for (const c of h.cases.values()) {
      if (c.kind === null) continue
      const cls = classifyCase(c.kind, c.name)
      if (c.kind === 'OK' || c.kind === 'SKIP') counts.ok++
      else if (c.kind === 'THROW') counts.threw++
      if (cls) {
        counts[cls.cls]++
        issues.push({ ...cls, input: c.name, detail: c.detail })
      }
    }
    if (h.done || total === null) break
    const open = h.last !== null && h.cases.get(h.last)?.kind === null ? h.cases.get(h.last) : null
    if (!open) {
      if (h.last === null || h.last + 1 >= total) break
      start = h.last + 1
    } else {
      const inflight = t0 + r.ms - open.ts
      let cls
      if (r.timedOut && inflight >= HANG_MS) cls = classifyCase('HANG', open.name)
      else if (r.timedOut) {
        const tries = (slow.get(open.idx) ?? 0) + 1
        slow.set(open.idx, tries)
        if (tries < 2) {
          start = open.idx
          if (++respawns > 12 || Date.now() - started > FILE_MS) break
          continue
        }
        cls = classifyCase('HANG', open.name)
      } else cls = classifyCase('CRASH', open.name)
      counts[cls.cls]++
      issues.push({ ...cls, input: open.name, detail: r.timedOut ? `no result after ${secs(Math.max(inflight, HANG_MS))}s` : `process exited with code ${r.code}${r.signal ? ` (${r.signal})` : ''}` })
      start = open.idx + 1
    }
    if (start >= (total ?? 0) || ++respawns > 12 || Date.now() - started > FILE_MS) break
  }
  return { ran: total ?? 0, counts, issues, elapsed: Date.now() - started }
}

async function crashFuzz(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    const { targets, skipped } = collectFuzzTargets(p.copy.dir)
    console.log(`crash-fuzz: seed ${b.seed}, at most ${b.fuzzCases} case(s) (budgets robustness.seed, robustness.fuzzCases); ${p.copy.copied} tracked file(s) copied`)
    const byFile = new Map()
    for (const s of skipped) byFile.set(`${s.file}|${s.why}`, [...(byFile.get(`${s.file}|${s.why}`) ?? []), s.name])
    let shown = 0
    for (const [k, names] of byFile) {
      if (shown++ >= 15) break
      const [file, why] = k.split('|')
      console.log(`  not called: ${names.slice(0, 6).map(safe).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''} in ${safe(file)}: ${safe(why).slice(0, 110)}`)
    }
    if (byFile.size > 15) console.log(`  ... and ${byFile.size - 15} more file(s) with functions that were not called`)
    if (!targets.length) {
      sub('NA', 'targets', 'no exported plain function with 1 to 3 parameters in a module that is safe to load')
      return notRun('no exported function that is safe to call was found (looked at .js/.mjs/.cjs, .ts on Node 22.18+, and .py)')
    }
    await provideDeps(p, b).catch(() => 'dependencies not available; modules that need them are skipped')
    const plan = planFuzz(targets, b)
    const dropped = targets.length - plan.length
    if (dropped > 0) console.log(`  ${dropped} function(s) did not fit in ${b.fuzzCases} case(s) and were left out (raise robustness.fuzzCases, or change robustness.seed to pick others)`)
    const jsPath = join(p.home, 'mk-fuzz-harness.mjs')
    const pyPath = join(p.home, 'mk-fuzz-harness.py')
    writeFileSync(jsPath, JS_HARNESS)
    writeFileSync(pyPath, PY_HARNESS)
    const env = p.env()
    let flags = permissionFlags()
    let count = 0
    let called = 0
    const grouped = new Map()
    const deadline = Date.now() + b.totalSeconds * 1000
    for (const t of plan) {
      if (Date.now() > deadline) {
        sub('NA', subId('fuzz', t.file, t.name), 'skipped: robustness.totalSeconds used up')
        continue
      }
      let res = await fuzzOne(p, t, b, t.lang === 'python' ? pyPath : jsPath, env, flags)
      if (res.loadError && flags.length && /ERR_ACCESS_DENIED|permission/i.test(res.loadError)) {
        flags = []
        res = await fuzzOne(p, t, b, jsPath, env, flags)
      }
      const id = subId('fuzz', t.file, t.name)
      if (res.loadError) {
        sub('NA', id, `could not load ${t.file}: ${res.loadError}`)
        console.log(`  ${safe(t.name)} in ${safe(t.file)}: not called, the module could not be loaded (${safe(res.loadError)})`)
        continue
      }
      called++
      const c = res.counts
      const line = `${c.ok} ok, ${c.threw} threw an error as it should, ${c.hang} hang, ${c.crash} crash, ${c['stack-overflow']} stack overflow, ${c.corruption} corruption`
      console.log(`  ${safe(t.name)}(${t.arity} arg${t.arity > 1 ? 's' : ''}) in ${safe(t.file)}:${t.line}: ${res.ran} case(s): ${line}`)
      if (!res.issues.length) {
        sub('PASS', id, `${res.ran} case(s): ${line}`)
        continue
      }
      sub('FAIL', id, `${res.issues.length} bad case(s): ${line}`)
      for (const iss of res.issues) {
        const key = `${t.file}|${t.name}|${iss.rule}`
        const g = grouped.get(key) ?? { t, iss, inputs: [] }
        g.inputs.push(iss.input)
        grouped.set(key, g)
      }
    }
    for (const g of grouped.values()) {
      count++
      const { t, iss, inputs } = g
      const shown = inputs.slice(0, 3).map(safe).join(', ')
      console.log(`  ${iss.severity.toUpperCase()} ${safe(t.name)} in ${safe(t.file)}:${t.line}: ${iss.cls} on ${inputs.length} input(s), for example ${shown} (${safe(iss.detail)})`)
      console.log(`    plain words: ${PLAIN[iss.cls]}`)
      finding(iss.severity, iss.rule, t.file, t.line, `${t.name}() ${iss.cls} on ${shown}${inputs.length > 3 ? ` and ${inputs.length - 3} more` : ''}; seed ${b.seed}`)
    }
    if (!called) return notRun('none of the candidate modules could be loaded here (dependencies missing?)')
    console.log(`  checked ${called} function(s); this run is reproducible with seed ${b.seed}`)
    return conclude('crash-fuzz', count, `${called} function(s) survived the nasty inputs`)
  } finally {
    p.done()
  }
}

// ---------------------------------------------------------------- 6. idempotent-cli
export function binFiles(pkg) {
  const out = []
  const bin = pkg?.bin
  const add = (name, file) => {
    if (typeof file !== 'string') return
    const f = file.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!f || f.startsWith('/') || /^[a-zA-Z]:/.test(f) || f.split('/').includes('..')) return
    if (!/\.(c|m)?js$|^[^.]*$|\/[^./]+$/i.test(f)) return
    out.push({ name: String(name).replace(/^@[^/]+\//, ''), file: f })
  }
  if (typeof bin === 'string') add(pkg.name ?? 'cli', bin)
  else if (bin && typeof bin === 'object') for (const [k, v] of Object.entries(bin).slice(0, 8)) add(k, v)
  return out
}
const STACK = /^\s+at\s+.+:\d+:\d+\)?\s*$|^\s+at\s+\S+\s+\(.+\)\s*$|node:internal\/|Traceback \(most recent call last\)/m
const normOut = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n').trim()
const CLOSED_PIPE_WRAPPER = `const { spawn } = require('node:child_process')
const [file, ...args] = process.argv.slice(2)
const c = spawn(process.execPath, [file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
c.stdout.destroy()
let err = ''
c.stderr.on('data', (d) => { err += d })
const t = setTimeout(() => { c.kill(); console.log(JSON.stringify({ timeout: true, err: err.slice(-2000) })); process.exit(0) }, 3000)
c.on('close', (code) => { clearTimeout(t); console.log(JSON.stringify({ code, err: err.slice(-2000) })); process.exit(0) })
`
async function idempotentCli(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    const bins = binFiles(p.pkg).filter((x) => existsSync(join(p.copy.dir, x.file)))
    if (!bins.length) {
      sub('NA', 'bin', 'package.json declares no bin entry that is among the tracked files')
      return notRun('package.json declares no "bin" entry (or the file is not tracked), so there is no command-line tool to check')
    }
    console.log(`idempotent-cli: ${bins.length} declared command(s): ${bins.map((x) => safe(x.name)).join(', ')} (only the project's own bin files are run, in a clean copy)`)
    console.log(`  deps: ${await provideDeps(p, b).catch((e) => e.notRunReason ?? 'not installed')}`)
    const wrapper = join(p.home, 'mk-closed-pipe.cjs')
    writeFileSync(wrapper, CLOSED_PIPE_WRAPPER)
    const run = (file, args, ms = 5000) => runIn(p.copy.dir, 'node', [file, ...args], { timeoutMs: ms, env: p.env(), maxOutputKb: 128 })
    let count = 0
    const fail = (bin, variant, why, plain, sev = 'medium', extra = null) => {
      count++
      sub('FAIL', subId(bin.name, variant), why)
      console.log(`  ${safe(bin.name)} ${variant}: ${why}`)
      console.log(`    plain words: ${plain}`)
      if (extra) printTail(extra, 3, '      ')
      finding(sev, `cli-${variant}`, bin.file, 0, `${bin.name}: ${why}`)
    }
    for (const bin of bins) {
      const text = readFileSync(join(p.copy.dir, bin.file), 'utf8')
      const h1 = await run(bin.file, ['--help'])
      const h2 = await run(bin.file, ['--help'])
      if (h1.timedOut || h2.timedOut) fail(bin, 'help-stable', '--help did not finish in 5s', 'asking a tool for help should answer at once; this one hangs (it may wait for input or start a server).', 'medium', h1.output)
      else if (normOut(h1.output) !== normOut(h2.output) || h1.code !== h2.code) fail(bin, 'help-stable', '--help printed different output the second time', 'the same command gave a different answer twice (a timestamp, a random value or a cached state in the help text), so it cannot be compared or tested.', 'low')
      else sub('PASS', subId(bin.name, 'help-stable'), '--help gives the same output twice')
      const v1 = await run(bin.file, ['--version'])
      const v2 = await run(bin.file, ['--version'])
      if (v1.timedOut || v2.timedOut) fail(bin, 'version-stable', '--version did not finish in 5s', 'printing the version should be instant.', 'low')
      else if (normOut(v1.output) !== normOut(v2.output) || v1.code !== v2.code) fail(bin, 'version-stable', '--version printed different output the second time', 'the version text changes between runs (for example it includes the current time).', 'low')
      else sub('PASS', subId(bin.name, 'version-stable'), '--version gives the same output twice')
      const u = await run(bin.file, ['--meerkat-unknown-flag-zq'])
      if (STACK.test(u.output)) fail(bin, 'unknown-flag', 'an unknown flag prints a stack trace', 'a typo in a flag should give one short line such as "unknown option" and a usage hint, not an internal stack trace.', 'medium', u.output)
      else if (!u.timedOut && u.code === 0) fail(bin, 'unknown-flag', 'an unknown flag exits with code 0 (success)', 'scripts that call this tool cannot tell a mistyped flag from success. Exit non-zero for unknown options.', 'low')
      else if (u.timedOut) sub('NA', subId(bin.name, 'unknown-flag'), 'did not exit in 5s with an unknown flag')
      else sub('PASS', subId(bin.name, 'unknown-flag'), `exits ${u.code} with no stack trace`)
      const server = /\.listen\s*\(|createServer|serve\s*\(/.test(text)
      if (server) sub('NA', subId(bin.name, 'stdin-closed'), 'looks like a server, which is meant to keep running')
      else {
        const s = await run(bin.file, [])
        if (s.timedOut) fail(bin, 'stdin-closed', 'with no arguments and no input it did not exit in 5s', 'a command that waits for typed input forever when stdin is closed hangs scripts and CI jobs. Detect a closed or empty stdin and exit with a message.', 'low', s.output)
        else sub('PASS', subId(bin.name, 'stdin-closed'), `exits (${s.code}) when stdin is closed`)
      }
      const cp = await runIn(p.copy.dir, 'node', [wrapper, bin.file, '--help'], { timeoutMs: 8000, env: p.env(), maxOutputKb: 64 })
      let parsed = null
      try {
        parsed = JSON.parse(lastLines(cp.output, 1)[0] ?? '')
      } catch {
        /* the wrapper printed nothing usable */
      }
      if (!parsed) sub('NA', subId(bin.name, 'closed-pipe'), 'the closed-pipe probe gave no answer')
      else if (parsed.timeout) fail(bin, 'closed-pipe', '--help did not exit when its output pipe was closed', 'like "tool --help | head -1": after the reader goes away the tool should stop quietly, not hang.', 'low')
      else if (/EPIPE|^\s+at .+:\d+:\d+/m.test(parsed.err)) fail(bin, 'closed-pipe', 'writing to a closed pipe prints an EPIPE error or stack trace', 'piping the output into "head" is normal; the tool should stop quietly instead of printing "Error: write EPIPE".', 'low', parsed.err)
      else sub('PASS', subId(bin.name, 'closed-pipe'), 'no error output when the reader closes the pipe')
    }
    return conclude('idempotent-cli', count, `${bins.length} command(s) answer help and version identically, reject bad flags cleanly and do not hang`)
  } finally {
    p.done()
  }
}

// ---------------------------------------------------------------- 7. unused-dependency-proof
export const TOOLING_ALLOW = /^(typescript|tslib|core-js|regenerator-runtime|@types\/.*|eslint.*|@eslint\/.*|prettier.*|vitest|jest.*|@jest\/.*|ts-jest|ts-node|tsx|babel-.*|@babel\/.*|webpack.*|vite|@vitejs\/.*|rollup.*|esbuild|swc.*|@swc\/.*|postcss.*|autoprefixer|tailwindcss.*|sass|less|stylus|nodemon|concurrently|cross-env|dotenv-cli|husky|lint-staged|rimraf|pm2|serverless|wrangler|prisma|react-scripts|next|nuxt|sharp|bufferutil|utf-8-validate|pg-native|fsevents|source-map-support|mocha|chai|sinon|nyc|c8|supertest|playwright.*|@playwright\/.*|cypress|puppeteer.*)$/
export function packageOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || /^[a-zA-Z]:/.test(spec)) return null
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}
const SRC_EXT = /\.(c|m)?[jt]sx?$|\.vue$|\.svelte$|\.astro$|\.mdx?$|\.html?$|\.json$|\.ya?ml$|\.toml$|\.cfg$|\.config\.[a-z]+$/i
const LOCKS = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/
// { imported: Set(package names found in import statements), mentioned: Set(names found as text anywhere else) }. Pure given the files.
export function scanDependencyUse(files, names) {
  const imported = new Set()
  const mentioned = new Set()
  for (const { rel, text } of files) {
    if (LOCKS.test(rel)) continue
    if (/\.(c|m)?[jt]sx?$|\.vue$|\.svelte$|\.astro$/i.test(rel)) for (const s of importSpecifiers(text)) {
      const pk = packageOf(s)
      if (pk) imported.add(pk)
    }
    if (rel === 'package.json') continue
    for (const n of names) {
      if (mentioned.has(n)) continue
      const esc = n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
      if (new RegExp(`(^|[^\\w@/.-])${esc}($|[^\\w-])`).test(text)) mentioned.add(n)
    }
  }
  return { imported, mentioned }
}
async function unusedDependencyProof(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    if (!p.pkg) {
      sub('NA', 'package-json', 'no package.json')
      return notRun('no package.json among the tracked files')
    }
    const prod = Object.keys(p.pkg.dependencies ?? {})
    if (!prod.length) {
      sub('NA', 'dependencies', 'package.json lists no production dependencies')
      return notRun('package.json lists no production dependencies')
    }
    const scriptsText = JSON.stringify(p.pkg.scripts ?? {})
    const files = []
    for (const rel of listFiles(p.copy.dir)) {
      if (!SRC_EXT.test(rel) && !/(^|\/)(Dockerfile|Procfile|Makefile|\.[a-z]+rc)$/i.test(rel)) continue
      try {
        if (statSync(join(p.copy.dir, rel)).size < 1_500_000) files.push({ rel, text: readFileSync(join(p.copy.dir, rel), 'utf8') })
      } catch {
        /* unreadable */
      }
    }
    const { imported, mentioned } = scanDependencyUse(files, prod)
    const skip = (n) => TOOLING_ALLOW.test(n) || new RegExp(`(^|[^\\w@/.-])${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^\\w-])`).test(scriptsText)
    const candidates = prod.filter((n) => !imported.has(n) && !skip(n)).sort()
    const pkgText = readFileSync(join(p.copy.dir, 'package.json'), 'utf8')
    const lineOf = (n) => Math.max(1, pkgText.slice(0, Math.max(0, pkgText.indexOf(`"${n}"`))).split('\n').length)
    console.log(`unused-dependency-proof: ${prod.length} production dependenc${prod.length === 1 ? 'y' : 'ies'}; ${candidates.length} not imported by any source file${prod.length - candidates.length ? ` (${prod.length - candidates.length} imported, named in a script or on the tooling allowlist)` : ''}`)
    if (!candidates.length) {
      sub('PASS', 'static', 'every production dependency is imported or is tooling')
      return conclude('unused-dependency-proof', 0, 'every production dependency is imported somewhere')
    }
    const nm = join(p.root, 'node_modules')
    const dynamic = p.cmds.test && existsSync(nm) && cappedSize(nm, 300 * MB) !== null
    let count = 0
    if (!dynamic) {
      const why = !existsSync(nm) ? 'node_modules is not present' : !p.cmds.test ? 'there is no test command' : 'node_modules is larger than 300 MB, too big to copy safely'
      console.log(`  static check only: ${why}, so dependencies cannot be removed and re-tested. A dependency is reported only if its name appears in no tracked file other than package.json and the lockfile.`)
      for (const n of candidates.slice(0, b.depChecks)) {
        if (mentioned.has(n)) {
          sub('PASS', subId('dep', n), 'not imported, but named in a config or script file, so it may be used indirectly')
          continue
        }
        count++
        sub('FAIL', subId('dep', n), `dependency '${n}' appears unused (static check: its name is in no tracked file)`)
        console.log(`  dependency '${safe(n)}' appears unused (static check only: its name appears in no tracked file)`)
        finding('low', 'unused-dependency', 'package.json', lineOf(n), `dependency '${n}' appears unused (static check only: not found in any tracked file)`)
      }
      if (candidates.length > b.depChecks) console.log(`  ${candidates.length - b.depChecks} more candidate(s) not looked at (cap ${b.depChecks})`)
      console.log('  plain words: an unused dependency makes installs slower, widens the attack surface and gets security warnings for code you never run.')
      return conclude('unused-dependency-proof', count, 'no dependency is provably unused (static check only)')
    }
    cpSync(nm, join(p.copy.dir, 'node_modules'), { recursive: true })
    const base = await step(p, p.cmds.test, b.testSeconds)
    if (base.code !== 0) {
      const why = base.timedOut ? 'the tests did not finish within the budget' : 'the tests fail before anything is removed'
      sub('NA', 'baseline', why)
      printTail(base.output)
      return notRun(why)
    }
    sub('PASS', 'baseline', `${show(p.cmds.test)} passed with all dependencies (${secs(base.ms)}s)`)
    const buildOk = p.cmds.build ? (await step(p, p.cmds.build, b.buildSeconds)).code === 0 : null
    console.log(`  baseline: tests passed${buildOk === null ? ', no build command' : buildOk ? ', build passed' : ', build already fails (ignored)'}`)
    const pkgPath = join(p.copy.dir, 'package.json')
    const deadline = Date.now() + b.totalSeconds * 1000
    for (const n of candidates.slice(0, b.depChecks)) {
      if (Date.now() > deadline) {
        sub('NA', subId('dep', n), 'skipped: robustness.totalSeconds used up')
        continue
      }
      const folder = join(p.copy.dir, 'node_modules', ...n.split('/'))
      if (!existsSync(folder)) {
        sub('NA', subId('dep', n), 'not installed in node_modules')
        continue
      }
      const cfg = JSON.parse(pkgText)
      delete cfg.dependencies[n]
      writeFileSync(pkgPath, `${JSON.stringify(cfg, null, 2)}\n`)
      rmSync(folder, { recursive: true, force: true })
      const t = await step(p, p.cmds.test, b.testSeconds)
      const bd = t.code === 0 && buildOk ? await step(p, p.cmds.build, b.buildSeconds) : null
      writeFileSync(pkgPath, pkgText)
      cpSync(join(nm, ...n.split('/')), folder, { recursive: true })
      if (t.code === 0 && (!bd || bd.code === 0)) {
        count++
        sub('FAIL', subId('dep', n), `dependency '${n}' appears unused (tests${bd ? ' and build' : ''} pass without it)`)
        console.log(`  dependency '${safe(n)}' appears unused (tests${bd ? ' and build' : ''} pass without it)${mentioned.has(n) ? '; its name is mentioned in a config file, check that before removing it' : ''}`)
        finding('low', 'unused-dependency', 'package.json', lineOf(n), `dependency '${n}' appears unused (tests${bd ? ' and build' : ''} pass without it)`)
      } else {
        sub('PASS', subId('dep', n), `removing it breaks the ${t.code !== 0 ? 'tests' : 'build'}, so it is used`)
        console.log(`  ${safe(n)}: removing it breaks the ${t.code !== 0 ? 'tests' : 'build'} (used)`)
      }
    }
    if (candidates.length > b.depChecks) console.log(`  ${candidates.length - b.depChecks} more candidate(s) not tried (cap ${b.depChecks})`)
    if (count) console.log('  plain words: an unused dependency makes installs slower, widens the attack surface and gets security warnings for code you never run. Removal passed only the tests you have: check that the package is not loaded by name at runtime.')
    return conclude('unused-dependency-proof', count, `removing any of ${Math.min(candidates.length, b.depChecks)} candidate(s) breaks the tests or the build`)
  } finally {
    p.done()
  }
}

// ---------------------------------------------------------------- 8. slow-test-regression
export const medianOf = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}
// history: [{ at, tests: { name: ms } }], current: { name: ms }. A test regressed when it is over `minMs` and over `factor` times the median of its
// (up to maxRuns) most recent previous timings. Pure.
export function findRegressions(history, current, { factor = 3, minMs = 500, maxRuns = 5 } = {}) {
  const prev = (history ?? []).slice(-maxRuns)
  const out = []
  for (const [name, ms] of Object.entries(current)) {
    if (!(ms > minMs)) continue
    const med = medianOf(prev.map((r) => r.tests?.[name]).filter((x) => typeof x === 'number'))
    if (med !== null && med > 0 && ms > factor * med) out.push({ name, ms, median: med, ratio: ms / med })
  }
  return out.sort((a, b) => b.ratio - a.ratio)
}
export const topSlowest = (tests, n = 5) => Object.entries(tests).sort((a, b) => b[1] - a[1]).slice(0, n)
export function timesDir(env = process.env, home = homedir()) {
  return env.MEERKAT_LOG_DIR ? join(resolve(env.MEERKAT_LOG_DIR), 'test-times') : join(home, '.meerkat', 'test-times')
}
export const timesSlug = (root) => `${slug(basename(resolve(root))).slice(0, 40) || 'project'}-${createHash('sha1').update(resolve(root).toLowerCase()).digest('hex').slice(0, 8)}`
const MAX_TESTS = 2000
export function appendHistory(history, tests, at = new Date().toISOString(), maxRuns = 5) {
  const kept = Object.fromEntries(Object.entries(tests).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]).slice(0, MAX_TESTS).map(([k, v]) => [String(k).slice(0, 200), Math.round(v * 10) / 10]))
  return { version: 1, runs: [...(history?.runs ?? []), { at, tests: kept }].slice(-maxRuns) }
}
export function loadHistory(file) {
  const j = readJson(file)
  return j && j.version === 1 && Array.isArray(j.runs) ? j : { version: 1, runs: [] }
}
export function saveHistory(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, file)
}
// ---- duration parsers (pure): each returns { name: ms }
export function parseJestLikeJson(text) {
  const j = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })()
  const out = {}
  for (const f of j?.testResults ?? []) {
    const file = String(f.name ?? f.testFilePath ?? '').replace(/\\/g, '/').split('/').slice(-2).join('/')
    for (const t of f.assertionResults ?? f.testResults ?? []) if (typeof t.duration === 'number') out[`${file}::${t.fullName ?? t.title}`] = t.duration
  }
  return out
}
export function parsePytestDurations(text) {
  const out = {}
  for (const m of String(text).matchAll(/^\s*(\d+(?:\.\d+)?)s\s+(call|setup|teardown)\s+(\S+)/gm)) out[m[3]] = (out[m[3]] ?? 0) + Number(m[1]) * 1000
  return out
}
export function parseGoJson(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    try {
      const e = JSON.parse(line)
      if (e.Test && /^(pass|fail)$/.test(e.Action) && typeof e.Elapsed === 'number') out[`${e.Package ?? ''}.${e.Test}`] = e.Elapsed * 1000
    } catch {
      /* not an event */
    }
  }
  return out
}
// A line "MEERKAT-TEST-TIME <ms> <name>" printed by any runner, for runners Meerkat has no reporter for.
export function parseGenericTimes(text) {
  const out = {}
  for (const m of String(text).matchAll(/^MEERKAT-TEST-TIME\s+(\d+(?:\.\d+)?)\s+(.+)$/gm)) out[m[2].trim().slice(0, 200)] = Number(m[1])
  return out
}
export function timingPlan(runner, testCmd, outFile) {
  if (runner === 'vitest') return { argv: withArgs(testCmd, ['--reporter=json', `--outputFile=${outFile}`], runner), parse: 'file-json', label: 'vitest --reporter=json' }
  if (runner === 'jest') return { argv: withArgs(testCmd, ['--json', `--outputFile=${outFile}`], runner), parse: 'file-json', label: 'jest --json' }
  if (runner === 'pytest') return { argv: [...testCmd, '--durations=0'], parse: 'pytest', label: 'pytest --durations=0' }
  if (runner === 'go') return { argv: ['go', 'test', '-json', './...'], parse: 'go', label: 'go test -json' }
  return { argv: testCmd, parse: 'generic', label: 'lines of the form MEERKAT-TEST-TIME <ms> <name>' }
}
async function slowTestRegression(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    if (!p.cmds.test) {
      sub('NA', 'timing', 'no test command detected')
      return notRun('no test command could be detected')
    }
    const runner = detectRunner(p.pkg, p.cmds.ecosystems, p.cmds.test)
    const outFile = '.meerkat-test-times.json'
    const plan = timingPlan(runner, p.cmds.test, outFile)
    console.log(`slow-test-regression: ${safe(show(plan.argv))}`)
    console.log(`  deps: ${await provideDeps(p, b)}`)
    const r = await step(p, plan.argv, b.testSeconds)
    if (r.code !== 0 && UNSUPPORTED.test(r.output)) {
      sub('NA', 'timing', `the installed runner does not accept ${plan.label}`)
      return notRun(`the installed runner does not accept ${plan.label}`)
    }
    if (r.code !== 0) {
      const why = r.timedOut ? `the tests did not finish within ${b.testSeconds}s` : 'the tests fail, so timings of a failing run are not recorded'
      sub('NA', 'timing', why)
      printTail(r.output)
      return notRun(why)
    }
    const fileText = plan.parse === 'file-json' && existsSync(join(p.copy.dir, outFile)) ? readFileSync(join(p.copy.dir, outFile), 'utf8') : ''
    const tests = plan.parse === 'file-json' ? parseJestLikeJson(fileText) : plan.parse === 'pytest' ? parsePytestDurations(r.output) : plan.parse === 'go' ? parseGoJson(r.output) : parseGenericTimes(r.output)
    if (!Object.keys(tests).length) {
      const why = runner === 'custom' || !runner ? 'this runner has no duration reporter Meerkat knows (print lines "MEERKAT-TEST-TIME <ms> <name>" to supply timings)' : `${plan.label} gave no per-test durations`
      sub('NA', 'timing', why)
      return notRun(why)
    }
    const file = join(timesDir(), `${timesSlug(root)}.json`)
    const history = loadHistory(file)
    const regress = findRegressions(history.runs, tests, { factor: b.regressionFactor, minMs: b.regressionMs })
    console.log(`  ${Object.keys(tests).length} test(s) timed; slowest 5:`)
    for (const [name, ms] of topSlowest(tests)) console.log(`    ${Math.round(ms)} ms  ${safe(name).slice(0, 120)}`)
    try {
      saveHistory(file, appendHistory(history, tests))
    } catch (e) {
      console.log(`  could not save the timings (${safe(e.message)}); regression detection needs them`)
    }
    if (!history.runs.length) {
      sub('NA', 'regression', 'first run: timings saved, nothing to compare with yet')
      console.log(`  first run: timings saved to ${safe(file)}; the next run compares against them`)
      return 0
    }
    if (!regress.length) {
      sub('PASS', 'regression', `no test is over ${b.regressionFactor}x slower than its median of ${Math.min(history.runs.length, 5)} earlier run(s)`)
      return conclude('slow-test-regression', 0, `no test got more than ${b.regressionFactor}x slower (compared with ${Math.min(history.runs.length, 5)} earlier run(s))`)
    }
    sub('FAIL', 'regression', `${regress.length} test(s) got more than ${b.regressionFactor}x slower than their median`)
    for (const x of regress.slice(0, 15)) {
      console.log(`  ${safe(x.name).slice(0, 120)}: ${Math.round(x.ms)} ms now, median ${Math.round(x.median)} ms before (${x.ratio.toFixed(1)}x slower)`)
      finding('low', 'slow-test-regression', '.', 0, `test '${x.name.slice(0, 120)}' is ${x.ratio.toFixed(1)}x slower (${Math.round(x.ms)} ms, was ${Math.round(x.median)} ms)`)
    }
    console.log('  plain words: a test that suddenly takes several times longer usually means the code under it got slower (a new query, a loop, a missing cache). This is informational (low).')
    return conclude('slow-test-regression', regress.length, '')
  } finally {
    p.done()
  }
}

// ---------------------------------------------------------------- fixtures: each builds a tiny dependency-free project whose check must exit 1
const git = (dir, ...a) => execFileSync('git', ['-c', 'user.name=meerkat', '-c', 'user.email=meerkat@example.invalid', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { stdio: 'ignore' })
export function commitAll(dir) {
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'fixture')
}
const pkgJson = (scripts, extra = {}) => `${JSON.stringify({ name: 'fixture', version: '1.0.0', scripts, ...extra }, null, 2)}\n`
const budgetFile = (robustness) => `${JSON.stringify({ robustness })}\n`
const fx = (tree, fn) => ({
  fixture: () =>
    withFixture(tree, async (dir) => {
      commitAll(dir)
      return fn(dir)
    }),
})
export const FIXTURES = {
  tz: {
    'package.json': pkgJson({ test: 'node test.js' }),
    'test.js': "const d = new Date(2020, 0, 1, 23, 30)\nprocess.exit(d.getUTCDate() === 1 ? 0 : 1)\n",
    '.meerkat-budgets.json': budgetFile({ tzCases: 3, localeCases: 1 }),
  },
  order: {
    'package.json': pkgJson({ test: 'node runner.js' }),
    'runner.js': `const fs = require('fs'); const cp = require('child_process')
let files = fs.readdirSync('tests').filter((f) => f.endsWith('.test.js')).sort()
const a = process.argv.slice(2)
if (a.includes('--reverse')) files.reverse()
const sh = a.find((x) => x.startsWith('--shuffle=')); if (sh) { let s = Number(sh.slice(10)) || 1; files.sort(() => ((s = (s * 16807) % 2147483647) % 3) - 1) }
try { fs.unlinkSync('.state') } catch {}
let bad = 0
for (const f of files) { const r = cp.spawnSync(process.execPath, ['tests/' + f], { stdio: 'inherit' }); if (r.status) { bad++; console.log('FAIL ' + f) } }
try { fs.unlinkSync('.state') } catch {}
process.exit(bad ? 1 : 0)
`,
    'tests/a.test.js': "require('fs').writeFileSync('.state', 'ready')\n",
    'tests/b.test.js': "if (!require('fs').existsSync('.state')) { console.error('b needs a to run first'); process.exit(1) }\n",
    '.meerkat-budgets.json': budgetFile({ orderArgs: ['--reverse', '--shuffle=<seed>'], orderRuns: 2 }),
  },
  parallel: {
    'package.json': pkgJson({ test: 'node run.js' }),
    'run.js': `const fs = require('fs'); const cp = require('child_process')
const files = fs.readdirSync('tests').filter((f) => f.endsWith('.test.js')).sort()
const par = process.argv.includes('--parallel')
const one = (f) => new Promise((res) => cp.spawn(process.execPath, ['tests/' + f], { stdio: 'inherit' }).on('close', res))
const go = async () => { if (par) return Promise.all(files.map(one)); const out = []; for (const f of files) out.push(await one(f)); return out }
go().then((codes) => process.exit(codes.some(Boolean) ? 1 : 0))
`,
    'tests/t1.test.js': "const fs = require('fs'); fs.writeFileSync('.shared', 't1'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); if (fs.readFileSync('.shared', 'utf8') !== 't1') { console.error('t1 saw another test write the shared file'); process.exit(1) }\n",
    'tests/t2.test.js': "const fs = require('fs'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); fs.writeFileSync('.shared', 't2'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); if (fs.readFileSync('.shared', 'utf8') !== 't2') { console.error('t2 saw another test write the shared file'); process.exit(1) }\n",
    '.meerkat-budgets.json': budgetFile({ serialArgs: ['--serial'], parallelArgs: ['--parallel'], parallelRuns: 1 }),
  },
  repro: {
    'package.json': pkgJson({ build: 'node build.js' }),
    'build.js': "const fs = require('fs'); fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/main.js', `// built ${Date.now()}\\nconsole.log('hi')\\n`)\n",
  },
  fuzz: {
    'package.json': pkgJson({}, { type: 'module' }),
    'src/scan.js': "export function countPairs(s) {\n  let c = 0\n  if (typeof s === 'string') for (let i = 0; i < s.length; i++) for (let j = 0; j < s.length; j++) c++\n  return c\n}\n",
    'src/walk.js': "export function depth(o) {\n  if (o && typeof o === 'object') { const k = Object.values(o); return k.length ? 1 + Math.max(...k.map(depth)) : 1 }\n  return 0\n}\n",
    'src/merge.js': "export function merge(target, src) {\n  for (const k in src) {\n    if (src[k] && typeof src[k] === 'object') merge((target[k] ??= {}), src[k])\n    else target[k] = src[k]\n  }\n  return target\n}\n",
    'src/danger.js': 'export function deleteAll(x) {\n  while (true) {}\n}\nexport function add(a, b) {\n  return a + b\n}\n',
    '.meerkat-budgets.json': budgetFile({ fuzzCases: 400 }),
  },
  cli: {
    'package.json': pkgJson({}, { bin: { fixcli: 'bin/cli.js' } }),
    'bin/cli.js': "#!/usr/bin/env node\nconst a = process.argv[2]\nif (a === '--help') console.log('usage: fixcli [--help] [--version]')\nelse if (a === '--version') console.log('1.0.0')\nelse if (a) throw new Error('Unknown flag: ' + a)\nelse console.log('ok')\n",
  },
  dep: {
    'package.json': pkgJson({}, { dependencies: { 'left-padz': '1.0.0', 'used-lib': '1.0.0' } }),
    'src/index.js': "const used = require('used-lib')\nmodule.exports = used\n",
  },
  slow: {
    'package.json': pkgJson({ test: 'node test.js' }),
    'test.js': "console.log('MEERKAT-TEST-TIME 900 checkout flow')\nconsole.log('MEERKAT-TEST-TIME 12 parses a date')\n",
  },
}
const entry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (entry) {
  main({
    'tz-locale-matrix': { run: guard(tzLocaleMatrix), ...fx(FIXTURES.tz, guard(tzLocaleMatrix)) },
    'test-order-independence': { run: guard(testOrderIndependence), ...fx(FIXTURES.order, guard(testOrderIndependence)) },
    'parallel-safety': { run: guard(parallelSafety), ...fx(FIXTURES.parallel, guard(parallelSafety)) },
    'reproducible-build': { run: guard(reproducibleBuild), ...fx(FIXTURES.repro, guard(reproducibleBuild)) },
    'crash-fuzz': { run: guard(crashFuzz), ...fx(FIXTURES.fuzz, guard(crashFuzz)) },
    'idempotent-cli': { run: guard(idempotentCli), ...fx(FIXTURES.cli, guard(idempotentCli)) },
    'unused-dependency-proof': { run: guard(unusedDependencyProof), ...fx(FIXTURES.dep, guard(unusedDependencyProof)) },
    'slow-test-regression': {
      run: guard(slowTestRegression),
      fixture: () =>
        withFixture(FIXTURES.slow, async (dir) => {
          commitAll(dir)
          const logs = makeTemp('meerkat-times-')
          const prev = process.env.MEERKAT_LOG_DIR
          process.env.MEERKAT_LOG_DIR = logs
          try {
            const name = `${timesSlug(dir)}.json`
            saveHistory(join(logs, 'test-times', name), { version: 1, runs: [{ at: 'earlier', tests: { 'checkout flow': 100, 'parses a date': 11 } }, { at: 'earlier', tests: { 'checkout flow': 110, 'parses a date': 12 } }] })
            return await guard(slowTestRegression)(dir)
          } finally {
            if (prev === undefined) delete process.env.MEERKAT_LOG_DIR
            else process.env.MEERKAT_LOG_DIR = prev
            cleanup(logs)
          }
        }),
    },
  })
}

export { NOT_RUN, tmpdir }
