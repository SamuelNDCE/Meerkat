// `meerkat frontend [--app <folder>] [--files <list>] [--run <run folder>]`: runs the front-end commands of the repo's commands block
// (typecheck, test, build; lib/repocommands.mjs) in that order and writes frontend.json in a run folder, which the gate then reads.
// Nothing here is silent: every step prints a start line and a result line, a missing key says it is skipped, and a config that is not trusted
// says so for each step. frontend.json is written even when a step fails or times out.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { writeFileAtomic } from './lockfile.mjs'
import { killTree } from './childreg.mjs'
import { appDirOf, repoRootOf } from './paths.mjs'
import { commandsTrusted, notTrustedLine, readCommands } from './repocommands.mjs'
import { latestRunDirForFolder, makeRunDir, sealRunDir } from './runlog.mjs'
import { stripControl } from './tui/safe.mjs'

export const FRONTEND_KEYS = ['typecheck', 'test', 'build']
export const DEFAULT_TIMEOUT_S = 600
export const TAIL_LINES = 20
const MAX_CAPTURE = 200_000
const SAFE_FILE = /^[\w@%+=:,./\\ -]+$/
const show = (t) => stripControl(String(t)).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')

export function timeoutSeconds(env = process.env) {
  const n = Number(env.MEERKAT_FRONTEND_TIMEOUT_S)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_S
}

const headOf = (repoRoot) => {
  const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() || null : null
}

// `--files a,b c` or `--files a --files b`: split on commas and spaces within one value.
export function parseFrontendArgs(argv) {
  const o = { app: null, files: [], run: null, errors: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--app' || a === '--files' || a === '--run') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) {
        o.errors.push(`${a} needs a value`)
        i--
        continue
      }
      if (a === '--app') o.app = v
      else if (a === '--run') o.run = v
      else o.files.push(...v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))
    } else if (!a.startsWith('-') && !o.app) o.app = a
    else o.errors.push(`unknown option ${a}`)
  }
  return o
}

// Runs one shell command with a timeout; a stop kills the whole process tree. Resolves { exitCode, timedOut, output, error }.
function runStep(cmd, cwd, env, timeoutS) {
  return new Promise((done) => {
    let buf = ''
    let timedOut = false
    let settled = false
    const finish = (r) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done({ output: buf, ...r })
    }
    const take = (d) => {
      buf += d.toString()
      if (buf.length > MAX_CAPTURE) buf = buf.slice(-MAX_CAPTURE)
    }
    // The command is run only after commandsTrusted() and exactly as written in the trusted config.
    const child = spawn(cmd, { cwd, shell: true, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }) // meerkat-ignore js-spawn-shell guarded: run only after commandsTrusted()
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
      // A killed tree closes the pipes; if something holds them open, do not wait for them.
      setTimeout(() => finish({ exitCode: null, timedOut: true }), 1500).unref?.()
    }, timeoutS * 1000)
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', (e) => finish({ exitCode: null, timedOut: false, error: e.message }))
    child.on('close', (code) => finish({ exitCode: timedOut ? null : code, timedOut }))
  })
}

const tailOf = (text) => stripControl(String(text)).replace(/\r/g, '').trimEnd().split('\n').slice(-TAIL_LINES).join('\n')
const secs = (ms) => Math.round(ms) / 1000

// The test command takes file arguments when it holds {files}. Returns { cmd, note } or { skip }.
// A source file is mapped to its sibling test file (Foo.tsx -> Foo.test.tsx or Foo.test.ts) when that exists in appDir; a test file is passed as is.
// Source files with no test file are left out and named, so the step never runs a file vitest cannot test.
export function testCommandFor(cmd, files, appDir = null) {
  if (!cmd.includes('{files}')) return { cmd, note: files.length ? 'the test command takes no {files} placeholder, so the full test command runs' : '' }
  if (!files.length) return { cmd: cmd.split('{files}').join('').trim(), note: 'no --files given, so the full test command runs' }
  const safe = files.filter((f) => SAFE_FILE.test(f) && !/^-/.test(f))
  const dropped = files.length - safe.length
  const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/
  const picked = []
  const unmatched = []
  for (const f of safe) {
    if (TEST.test(f)) { picked.push(f); continue }
    const base = f.replace(/\.[cm]?[jt]sx?$/, '')
    const sib = ['.test.tsx', '.test.ts', '.test.jsx', '.test.js', '.spec.tsx', '.spec.ts'].map((e) => base + e).find((t) => appDir && existsSync(join(appDir, t)))
    if (sib) picked.push(sib)
    else unmatched.push(f)
  }
  const uniq = [...new Set(picked)]
  const list = uniq.map((f) => `"${f}"`).join(' ')
  if (!uniq.length) return { skip: `no test file for ${unmatched.length ? unmatched.join(', ') : 'the changed files'}; the test step is NOT run, so it is not a pass` }
  const why = [`${uniq.length} test file(s)`, dropped ? `${dropped} with an unsafe name left out` : '', unmatched.length ? `${unmatched.length} source file(s) with no test file left out (${unmatched.join(', ')})` : ''].filter(Boolean).join(', ')
  return { cmd: cmd.split('{files}').join(list).trim(), note: `for ${why}` }
}

export async function runFrontend(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const o = parseFrontendArgs(argv)
  if (o.errors.length) {
    err(`meerkat frontend: ${o.errors.join('; ')}. usage: meerkat frontend [--app <folder>] [--files <list>] [--run <run folder>]`)
    return 2
  }
  const appDir = o.app ? resolve(cwd, o.app) : resolve(appDirOf(env, cwd))
  if (!existsSync(appDir)) {
    err(`meerkat frontend: ${show(appDir)} does not exist`)
    return 2
  }
  const repoRoot = repoRootOf(appDir)
  const r = readCommands(appDir)
  for (const n of r.notes) err(`meerkat frontend: ${show(n)}`)
  if (r.unreadable) return 2
  const trusted = r.file ? commandsTrusted(r, env) : false
  const timeoutS = timeoutSeconds(env)
  const t0 = Date.now()
  const steps = []
  let worst = 0
  let saidUntrusted = false
  for (const key of FRONTEND_KEYS) {
    let cmd = r.commands[key]
    if (!cmd) {
      out(`frontend ${key}: skipped, the config defines no commands.${key}`)
      steps.push({ key, command: null, status: 'skipped', exitCode: null, durationSeconds: 0, reason: `no commands.${key} in the config` })
      continue
    }
    if (!trusted) {
      if (!saidUntrusted) err(notTrustedLine(r))
      saidUntrusted = true
      out(`frontend ${key}: untrusted, not run`)
      steps.push({ key, command: cmd, status: 'untrusted', exitCode: null, durationSeconds: 0, reason: 'the commands block is not trusted (meerkat trust)' })
      worst = 1
      continue
    }
    let note = ''
    if (key === 'test') {
      const t = testCommandFor(cmd, o.files, r.dir)
      if (t.skip) {
        // Nothing to test is not a pass: the step is NOT run and says why.
        out(`frontend ${key}: NOT run, ${t.skip}`)
        steps.push({ key, command: cmd, status: 'skipped', exitCode: null, durationSeconds: 0, reason: t.skip })
        continue
      }
      cmd = t.cmd
      note = t.note
    }
    out(`frontend ${key}: start, ${show(cmd)}${note ? ` (${note})` : ''} (timeout ${timeoutS} s)`)
    const s0 = Date.now()
    const res = await runStep(cmd, r.dir, env, timeoutS)
    const dur = secs(Date.now() - s0)
    const status = res.timedOut ? 'timeout' : res.error || res.exitCode !== 0 ? 'fail' : 'pass'
    const step = { key, command: cmd, status, exitCode: res.exitCode, durationSeconds: dur }
    if (status !== 'pass') {
      step.tail = tailOf(res.error ? `${res.error}\n${res.output}` : res.output)
      worst = 1
    }
    steps.push(step)
    out(`frontend ${key}: ${status}${status === 'fail' || status === 'pass' ? `, exit ${res.exitCode ?? 'none'}` : `, killed after ${timeoutS} s`}, ${dur} s`)
  }
  // A run where every step was skipped checked nothing: it is NOT a pass. Exit 75 (INCOMPLETE), so a queue cannot read it as success.
  const allSkipped = steps.length > 0 && steps.every((s) => s.status === 'skipped')
  if (allSkipped) worst = 75
  const doc = { schema: 1, kind: 'frontend', commit: headOf(repoRoot), app: appDir.replace(/\\/g, '/'), files: o.files, configDir: r.dir, startedAt: new Date(t0).toISOString(), endedAt: new Date().toISOString(), ok: worst === 0, steps }
  const dir = o.run ? resolve(cwd, o.run) : makeRunDir(env, 'run', new Date(), homedir(), appDir, 'frontend')
  if (!dir || !existsSync(dir)) {
    err(`meerkat frontend: the results could not be saved (no run folder; ${show(env.MEERKAT_LOG_DIR || 'the default log folder')} is not writable)`)
    return 1
  }
  try {
    writeFileAtomic(join(dir, 'frontend.json'), JSON.stringify(doc, null, 2))
  } catch (e) {
    err(`meerkat frontend: could not write ${show(join(dir, 'frontend.json'))}: ${show(e?.message ?? e)}`)
    return 1
  }
  if (!o.run) sealRunDir(dir, { tier: 'frontend', preset: 'frontend', summary: `front-end checks: ${steps.map((s) => `${s.key} ${s.status}`).join(', ')}`, exitCode: worst, appDir, argv, startedAtMs: t0 })
  if (allSkipped) err(`frontend: NOT a pass: every step was skipped, so nothing was checked. Define commands.typecheck, commands.test and commands.build in meerkat.config.json`)
  out(`frontend: ${steps.map((s) => `${s.key} ${s.status}`).join(', ')}; results: ${join(dir, 'frontend.json').replace(/\\/g, '/')}`)
  return worst
}

// The gate's one line. { line } when a frontend.json exists for this folder, null when none was ever written. A file for another commit is
// refused with the reason, never read.
export function frontendGateLine(env, appDir, repoRoot) {
  let dir = null
  try {
    dir = latestRunDirForFolder(env, appDir, { preset: 'frontend' })
  } catch {
    dir = null
  }
  if (!dir) return null
  const file = join(dir, 'frontend.json')
  if (!existsSync(file)) return null
  let doc
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return `front-end: results not used, ${show(file)} could not be read (${show(String(e?.message ?? e).split('\n')[0])}); run meerkat frontend again`
  }
  const head = headOf(repoRoot)
  if (!doc?.commit || !head || doc.commit !== head) {
    return `front-end: results refused, frontend.json is from commit ${doc?.commit ? String(doc.commit).slice(0, 12) : '(unknown)'} but HEAD is ${head ? head.slice(0, 12) : '(unknown)'}; run meerkat frontend again`
  }
  const steps = Array.isArray(doc.steps) ? doc.steps : []
  const bad = steps.filter((s) => s.status !== 'pass' && s.status !== 'skipped')
  const list = steps.map((s) => `${show(s.key)} ${show(s.status)}`).join(', ')
  if (steps.some((s) => s.status === 'untrusted')) return notTrustedLine({ dir: doc.configDir ?? appDir })
  const nothing = steps.length > 0 && steps.every((s) => s.status === 'skipped')
  return `front-end: ${bad.length ? 'FAIL' : nothing ? 'NOT RUN (every step skipped)' : 'PASS'} (${list}) from ${show(file.replace(/\\/g, '/'))}`
}
