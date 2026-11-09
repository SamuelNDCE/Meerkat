// Runs a thorough/*.mjs check inside a worker thread instead of starting `node thorough/x.mjs <id>` (about 300 ms of process start-up each, which used to
// dominate a scan). The check is the same function with the same arguments, environment, folder and output; the runner reads its result exactly as it
// reads a process's. A worker is reused for the next check, so the modules load once. Anything that is not a plain kit check (a script that reads
// process.cwd() or process.argv, one that is not run through kit.main) stays a process. MEERKAT_NO_INPROC=1 turns this off.
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { trackChild } from './childreg.mjs'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { MEERKAT_DIR } from './paths.mjs'

const WORKER = fileURLToPath(new URL('./inproc-worker.mjs', import.meta.url))
const THOROUGH = `${MEERKAT_DIR}/thorough/`
const norm = (p) => String(p).replace(/\\/g, '/')

// What makes a script unsafe to run in a shared process: it looks at the process's own folder, arguments, stdin or signals, or exits for itself.
const UNSAFE = /process\.(?:cwd|chdir|argv|stdin|on|once|exit)\b/
const imports = (text) => [...text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+\.mjs)['"]/g)].map((m) => m[1])
const verdicts = new Map()
// A script runs in a worker when it, and every Meerkat module it imports, passes the UNSAFE test, and it registers its checks through kit.main.
export function scriptIsInproc(script) {
  if (verdicts.has(script)) return verdicts.get(script)
  let ok = false
  try {
    const seen = new Set()
    const walk = (file) => {
      if (seen.has(file)) return true
      seen.add(file)
      const text = readFileSync(file, 'utf8')
      const own = file.endsWith('/thorough/kit.mjs') // kit.parseArgs reads process.argv/cwd only as defaults, which the worker overrides
      if (!own && UNSAFE.test(text)) return false
      return imports(text).every((rel) => walk(norm(resolve(dirname(file), rel))))
    }
    const own = readFileSync(script, 'utf8')
    ok = /\bmain\s*\(/.test(own) && /import\s*\{[^}]*\bmain\b[^}]*\}\s*from\s*['"]\.\/kit\.mjs['"]/.test(own) && walk(script)
  } catch {
    ok = false
  }
  verdicts.set(script, ok)
  return ok
}

// { script, args, cwd } when this command can run in a worker, else null.
export function inprocPlan(cmd, args, cwd) {
  if (process.env.MEERKAT_NO_INPROC === '1' || cmd !== 'node' || !Array.isArray(args) || args.length < 2) return null
  const script = norm(args[0])
  if (!script.startsWith(THOROUGH) || !script.endsWith('.mjs') || script.slice(THOROUGH.length).includes('/')) return null
  if (!scriptIsInproc(script)) return null
  const where = resolve(cwd ?? process.cwd())
  const rest = args.slice(1).map(String)
  // A process starts in `cwd` and kit.parseArgs defaults its root to that folder; the worker is told the root outright.
  if (!rest.includes('--root')) rest.push('--root', where)
  return { script, args: rest, cwd: where }
}

const MAX_WORKERS = () => Math.max(1, Number(process.env.MEERKAT_INPROC_WORKERS) || cpus().length)
const IDLE_MS = 5000
let pool = [] // { worker, busy, task, timer }
const waiting = []

function newWorker() {
  const w = { busy: false, task: null, timer: null }
  w.worker = new Worker(WORKER, { resourceLimits: { maxOldGenerationSizeMb: 4096 }, stdout: true, stderr: true })
  w.worker.unref()
  w.worker.on('message', (m) => w.task?.onMessage(m))
  w.worker.on('error', (e) => w.task?.onDead(`${e?.stack ?? e}\n`))
  w.worker.on('exit', (code) => {
    pool = pool.filter((x) => x !== w)
    w.task?.onDead('', code)
  })
  // Anything a worker's own stdio gets (a stray native write) is dropped: the scripts' output travels in messages.
  w.worker.stdout?.resume?.()
  w.worker.stderr?.resume?.()
  pool.push(w)
  return w
}

function release(w) {
  w.busy = false
  w.task = null
  const next = waiting.shift()
  if (next) return assign(w, next)
  clearTimeout(w.timer)
  w.timer = setTimeout(() => {
    pool = pool.filter((x) => x !== w)
    w.worker.terminate()
  }, IDLE_MS)
  w.timer.unref?.()
}

function assign(w, t) {
  clearTimeout(w.timer)
  w.busy = true
  w.task = t
  t.worker = w
  w.worker.postMessage({ t: 'run', script: t.plan.script, args: t.plan.args, cwd: t.plan.cwd, env: t.env })
}

// End of a run: no worker survives it, so nothing a check cached (or read) in one run can be seen by the next.
export function closeInprocPool() {
  waiting.length = 0
  for (const w of pool) {
    clearTimeout(w.timer)
    w.task = null
    w.worker.terminate()
  }
  pool = []
}

// A stand-in for a ChildProcess: stdout/stderr emit 'data', then 'close'. `terminate()` stops the check. exec.mjs runCommand uses it unchanged.
export function startInproc(plan, env) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = undefined
  child.inproc = true
  let finished = false
  let fallback = null
  const end = (code) => {
    if (finished) return
    finished = true
    child.emit('exit', code)
    child.emit('close', code)
  }
  const task = {
    plan,
    env,
    worker: null,
    onMessage(m) {
      if (finished) return
      if (m.t === 'out') (m.s === 'stderr' ? child.stderr : child.stdout).emit('data', m.d)
      else if (m.t === 'done') {
        const w = task.worker
        end(m.code)
        release(w)
      } else if (m.t === 'unsupported') {
        // The script registered no checks with kit.main: run it as the process it is.
        release(task.worker)
        fallback = trackChild(spawn('node', [plan.script, ...plan.args], { cwd: plan.cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }), `node ${plan.script}`)
        fallback.stdout.on('data', (b) => child.stdout.emit('data', b.toString()))
        fallback.stderr.on('data', (b) => child.stderr.emit('data', b.toString()))
        fallback.on('close', (c) => end(c ?? 1))
        fallback.on('error', (e) => {
          child.stderr.emit('data', `${e.message}\n`)
          end(127)
        })
      }
    },
    onDead(text, code = 1) {
      if (text) child.stderr.emit('data', text)
      end(code || 1)
    },
  }
  child.terminate = () => {
    if (fallback) {
      try {
        fallback.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    const w = task.worker
    if (w) {
      pool = pool.filter((x) => x !== w)
      w.task = null
      w.worker.terminate()
    }
    const i = waiting.indexOf(task)
    if (i >= 0) waiting.splice(i, 1)
  }
  const idle = pool.find((w) => !w.busy)
  if (idle) assign(idle, task)
  else if (pool.length < MAX_WORKERS()) assign(newWorker(), task)
  else waiting.push(task)
  return child
}
