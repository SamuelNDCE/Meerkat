// `meerkat test-run <name-or-file> [--timeout 300] [--folder <path>]`: run ONE test file or test name with a time limit, through the repo's own
// runner (commands.test in meerkat.config.json). The file or name is appended only for a runner that takes one: vitest, jest, cargo test, pytest.
// Any other runner is refused with a message, never guessed at. A cargo runner takes the machine-wide cargo lock (lib/lanes.mjs wrapForLane,
// which is lib/cargo-lock-run.mjs unless a machine script is configured). On the time limit the whole process tree is killed and the run is
// reported as a timeout. Output: one summary line, and on a failure the failing test names and the path of the full log.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { splitCommand } from './customchecks.mjs'
import { killTreeOf } from './exec.mjs'
import { wrapForLane } from './lanes.mjs'
import { appDirOf } from './paths.mjs'
import { readCommands } from './repocommands.mjs'
import { saveFailureLog } from './runner.mjs'

export const DEFAULT_TIMEOUT_SECONDS = 300
const SAFE_TARGET = /^[\w .:/\\@#()+=,-]+$/
const MAX_OUTPUT = 5_000_000

export function parseTestRunArgs(argv) {
  const o = { target: null, timeout: DEFAULT_TIMEOUT_SECONDS, folder: null, errors: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--timeout' || a === '--folder') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) o.errors.push(`${a} needs a value`)
      else if (a === '--folder') o.folder = v
      else if (Number.isFinite(Number(v)) && Number(v) >= 1) o.timeout = Number(v)
      else o.errors.push('--timeout needs a number of seconds, 1 or more')
    } else if (a.startsWith('--')) o.errors.push(`unknown option ${a}`)
    else if (o.target === null) o.target = a
    else o.errors.push(`only one test file or name can be given (got ${o.target} and ${a})`)
  }
  if (o.target === null && !o.errors.length) o.errors.push('give a test file or a test name')
  return o
}

// Which runner a command line is. null means one that cannot take a single file or name.
export function runnerOf(command) {
  if (/\bvitest\b/.test(command)) return 'vitest'
  if (/\bjest\b/.test(command)) return 'jest'
  if (/\bcargo\s+(?:\+\S+\s+)?(?:test|nextest)\b/.test(command)) return 'cargo'
  if (/\bpytest\b|\bpy\.test\b|python\d?(?:\.\d+)?\s+-m\s+pytest\b/.test(command)) return 'pytest'
  return null
}

const quote = (s) => (/^[\w./\\:@#=,+-]+$/.test(s) ? s : `"${s}"`)

const readPackageJson = (d) => {
  try {
    return JSON.parse(readFileSync(resolve(d, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

// The command to run for `target`, or { refusal }. `isFile` says whether the target is a file in the folder.
export function buildTestCommand(command, target, { isFile, dir = '.', readPackage = readPackageJson } = {}) {
  if (!SAFE_TARGET.test(target)) return { refusal: `"${target}" has characters that are not allowed in a test name or file (letters, digits, space and . : / \\ @ # ( ) + = , - are)` }
  let runner = runnerOf(command)
  let wrapper = null
  const pm = command.trim().match(/^(npm|pnpm|yarn)\s+(?:run\s+)?(?:test|t)\s*$/)
  if (!runner && pm) {
    const script = readPackage(dir)?.scripts?.test
    runner = typeof script === 'string' ? runnerOf(script) : null
    wrapper = pm[1]
  }
  if (!runner) return { refusal: `the test command is "${command}", which is not vitest, jest, cargo test or pytest, so one file or name cannot be passed to it. Run that test by hand, or point commands.test at one of those runners` }
  let extra
  if (runner === 'vitest' || runner === 'jest') extra = isFile ? quote(target) : `-t ${quote(target)}`
  else if (runner === 'pytest') extra = isFile ? quote(target) : `-k ${quote(target)}`
  else {
    const stem = target.replace(/\\/g, '/').split('/').pop().replace(/\.rs$/, '')
    extra = isFile && /(^|[\\/])tests[\\/]/.test(target) ? `--test ${quote(stem)}` : quote(isFile ? stem : target)
  }
  const joiner = wrapper === 'npm' ? ' -- ' : ' '
  return { runner, command: `${command}${joiner}${extra}` }
}

// "Tests  1 failed | 2 passed | 1 skipped (4)", "test result: FAILED. 1 passed; 1 failed; 0 ignored", "=== 1 failed, 2 passed in 0.1s ===" -> counts and failing names.
export function parseResults(runner, text) {
  const t = String(text).replace(/\x1b\[[0-9;]*m/g, '')
  const count = (re) => {
    let n = 0
    let seen = false
    for (const m of t.matchAll(re)) {
      n += Number(m[1])
      seen = true
    }
    return seen ? n : null
  }
  const names = new Set()
  let c
  if (runner === 'cargo') {
    c = { pass: count(/(\d+) passed;/g), fail: count(/(\d+) failed;/g), skipped: count(/(\d+) ignored/g) }
    for (const m of t.matchAll(/^test (\S+) \.\.\. FAILED$/gm)) names.add(m[1])
  } else if (runner === 'pytest') {
    c = { pass: count(/(\d+) passed/g), fail: count(/(\d+) failed/g), skipped: count(/(\d+) skipped/g) }
    for (const m of t.matchAll(/^FAILED (\S+)/gm)) names.add(m[1])
  } else if (runner === 'jest') {
    const line = t.match(/^Tests:\s+(.+)$/m)?.[1] ?? ''
    const pick = (w) => Number(line.match(new RegExp(`(\\d+) ${w}`))?.[1] ?? 0)
    c = line ? { pass: pick('passed'), fail: pick('failed'), skipped: pick('skipped') } : { pass: null, fail: null, skipped: null }
    for (const m of t.matchAll(/^\s*● (.+)$/gm)) names.add(m[1].trim())
  } else {
    const line = t.match(/^\s*Tests\s+(.+)$/m)?.[1] ?? ''
    const pick = (w) => (line ? Number(line.match(new RegExp(`(\\d+) ${w}`))?.[1] ?? 0) : null)
    c = { pass: pick('passed'), fail: pick('failed'), skipped: pick('skipped') }
    for (const m of t.matchAll(/^\s*(?:FAIL|×)\s+(.+)$/gm)) names.add(m[1].trim())
  }
  return { pass: c.pass, fail: c.fail, skipped: c.skipped, names: [...names] }
}

function runWithTimeout(spec, { cwd, env, timeoutMs }) {
  return new Promise((resolveRun) => {
    const started = Date.now()
    let out = ''
    let timedOut = false
    let done = false
    let timer = null
    const finish = (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveRun({ code, out, timedOut, ms: Date.now() - started })
    }
    const child = spawn(spec.cmd, spec.args, { cwd, env, shell: spec.shell, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }) // meerkat-ignore js-spawn-shell the command is the person's own string from their config, run as written on purpose
    const take = (b) => {
      if (out.length < MAX_OUTPUT) out += b.toString('utf8')
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    timer = setTimeout(() => {
      timedOut = true
      killTreeOf(child.pid, true)
      setTimeout(() => finish(null), 3000).unref?.() // a grandchild may still hold the pipes; the tree is already killed
    }, timeoutMs)
    child.on('error', (e) => {
      out += `could not start: ${e.message}\n`
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

export async function runTestRun(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const o = parseTestRunArgs(argv)
  if (o.errors.length) {
    err(`meerkat test-run: ${o.errors.join('; ')}\nusage: meerkat test-run <name-or-file> [--timeout <seconds>] [--folder <path>]`)
    return 2
  }
  const folder = resolve(cwd, o.folder ?? appDirOf(env, cwd))
  const r = readCommands(folder)
  for (const n of r.notes) err(`meerkat test-run: ${n}`)
  const command = r.commands.test
  if (!command) {
    err(`meerkat test-run: ${r.file ? `${r.file} defines no commands.test` : 'there is no meerkat.config.json here'}. Add { "commands": { "test": "npx vitest run" } } (vitest, jest, cargo test or pytest).`)
    return 2
  }
  const isFile = (() => {
    try {
      return statSync(resolve(r.dir, o.target)).isFile()
    } catch {
      return false
    }
  })()
  const built = buildTestCommand(command, o.target, { isFile, dir: r.dir })
  if (built.refusal) {
    err(`meerkat test-run: ${built.refusal}`)
    return 2
  }
  out(`$ ${built.command}   (in ${r.dir.replace(/\\/g, '/')}, limit ${o.timeout}s)`)
  let spec = { cmd: built.command, args: [], shell: true }
  let runEnv = env
  if (built.runner === 'cargo') {
    const sp = splitCommand(built.command)
    if (!sp.ok) {
      err(`meerkat test-run: ${sp.error}`)
      return 2
    }
    const w = wrapForLane('cargo', sp.cmd, sp.args, env, existsSync)
    if (w.missing) {
      err(`meerkat test-run: ${w.missing}`)
      return 1
    }
    spec = { cmd: w.cmd, args: w.args, shell: false }
    runEnv = { ...env, ...(w.env ?? {}) }
  }
  const res = await runWithTimeout(spec, { cwd: r.dir, env: runEnv, timeoutMs: o.timeout * 1000 })
  const secs = `${(res.ms / 1000).toFixed(1)}s`
  if (res.timedOut) {
    const log = saveFailureLog('test-run', res.out, env)
    out(`TIMEOUT: ${o.target} did not finish in ${o.timeout}s, the test process and everything it started were killed (${built.runner}, ${secs})`)
    if (log) out(`log: ${log}`)
    return 124
  }
  const p = parseResults(built.runner, res.out)
  const ok = res.code === 0
  const num = (n) => (n === null ? 0 : n)
  const counts = p.pass === null && p.fail === null ? (ok ? 'passed (the runner printed no counts)' : `failed with exit code ${res.code ?? 'none'}`) : `${num(p.pass)} passed, ${num(p.fail)} failed, ${num(p.skipped)} skipped`
  out(`${ok ? 'PASS' : 'FAIL'}: ${counts} in ${secs} (${built.runner}: ${o.target})`)
  if (!ok) {
    const log = saveFailureLog('test-run', res.out, env)
    if (p.names.length) out(`failing tests:\n${p.names.slice(0, 20).map((n) => `  ${n}`).join('\n')}${p.names.length > 20 ? `\n  ... and ${p.names.length - 20} more` : ''}`)
    if (log) out(`log: ${log}`)
  }
  return ok ? 0 : 1
}
