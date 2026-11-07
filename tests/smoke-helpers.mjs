// Shared by tests/smoke-*.test.ts and tests/red-failures.test.ts (not a test itself).
// Every test works on a COPY of tests/fixtures/smoke-app in a temp folder, with every place Meerkat writes (run logs, dismissals, baselines, the user config, the
// home folder) pointed into that same temp folder, so the repo and the real home are never written to.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CLI = join(ROOT, 'bin', 'meerkat.mjs')
export const MCP = join(ROOT, 'bin', 'meerkat-mcp.mjs')
export const FIXTURE = join(ROOT, 'tests', 'fixtures', 'smoke-app')

// A stack trace is "at <function> (<file path>:<line>:<col>)" or a raw JavaScript error name that escaped. Messages that quote a user's file are fine.
export const STACK = /\n\s+at\s+(?:[^\n]*[\\/][^\n]*:\d+:\d+|[^\n]*\(node:)|\bTypeError\b|\bReferenceError\b|\bRangeError\b|UnhandledPromiseRejection|node:internal/
export const hasStack = (text) => STACK.test(String(text))

const sh = (cmd, args, cwd, env) => spawnSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export function git(cwd, args, env = process.env) {
  const r = sh('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], cwd, env)
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

// A sandbox: <root>/app (copy of the fixture, a git repo with one commit), <root>/home, <root>/logs, <root>/outside (a sentinel folder next to the app).
export function makeSandbox({ copy = true, commit = true, label = 'smoke' } = {}) {
  const base = mkdtempSync(join(tmpdir(), `mk-${label}-`))
  const root = join(base, 'box')
  const app = join(root, 'app')
  const home = join(root, 'home')
  const logs = join(root, 'logs')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(root, 'outside'), { recursive: true })
  writeFileSync(join(root, 'outside', 'sentinel.txt'), 'untouched\n')
  if (copy) cpSync(FIXTURE, app, { recursive: true })
  else mkdirSync(app, { recursive: true })
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    MEERKAT_LOG_DIR: logs,
    MEERKAT_USER_CONFIG: join(home, '.meerkat.json'),
    NO_COLOR: '1',
    CI: '1',
    MEERKAT_PRIORITY: 'normal',
  }
  delete env.MEERKAT_APP_DIR
  delete env.NV_APP_DIR
  if (copy && commit) {
    git(app, ['init', '-q', '-b', 'main'], env)
    git(app, ['add', '-A'], env)
    git(app, ['commit', '-q', '-m', 'init'], env)
  }
  return { base, root, app, home, logs, env, outside: join(root, 'outside'), cleanup: () => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}

const result = (r, ms) => ({ code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', all: `${r.stdout ?? ''}\n${r.stderr ?? ''}`, timedOut: r.error?.code === 'ETIMEDOUT', error: r.error ?? null, ms })

// Runs the CLI to the end (or the timeout). Never a shell: an argument list.
export function runCli(sb, args, { cwd = sb.app, timeout = 90000, env = {}, input } = {}) {
  const t = Date.now()
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...sb.env, ...env }, encoding: 'utf8', timeout, killSignal: 'SIGKILL', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  return result(r, Date.now() - t)
}

export function spawnCli(sb, args, { cwd = sb.app, env = {} } = {}) {
  const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...sb.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stderr += d))
  const done = new Promise((res) => child.on('close', (code, signal) => res({ code, signal, stdout, stderr, all: `${stdout}\n${stderr}` })))
  return { child, done }
}

// Ends a process and everything it started (the CLI starts run.mjs and more).
export function killTree(child) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

// A cheap run that leaves a real run store (summary.json, findings.json, latest.json) behind.
export function makeRunStore(sb) {
  const r = runCli(sb, ['verify', '--only', 'license,node-engines', '--plain'], { timeout: 120000 })
  if (r.timedOut) throw new Error('could not make a run store: verify timed out')
  return r
}

export function newestRunDir(sb) {
  const runs = join(sb.logs, 'runs')
  if (!existsSync(runs)) return null
  const names = readdirSync(runs).filter((n) => statSync(join(runs, n)).isDirectory()).sort()
  return names.length ? join(runs, names[names.length - 1]) : null
}

// A fingerprint of a folder tree: relative path, size and content hash of every file. Used to prove nothing was written there.
export function fingerprint(dir, skip = new Set(['.git', 'node_modules'])) {
  const out = []
  const walk = (d, rel) => {
    let names = []
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const n of names.sort()) {
      if (skip.has(n)) continue
      const p = join(d, n)
      let st
      try {
        st = statSync(p)
      } catch {
        out.push(`${rel}${n}:unreadable`)
        continue
      }
      if (st.isDirectory()) walk(p, `${rel}${n}/`)
      else out.push(`${rel}${n}:${st.size}:${createHash('sha1').update(readFileSync(p)).digest('hex')}`)
    }
  }
  walk(dir, '')
  return out.join('\n')
}

// ---- MCP over stdio -------------------------------------------------------------------------------------------------------------------

export function startMcp(sb, { cwd = sb.app } = {}) {
  const child = spawn(process.execPath, [MCP], { cwd, env: sb.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let buf = ''
  let stderr = ''
  const lines = []
  const waiters = []
  child.stdout.setEncoding('utf8')
  child.stderr.on('data', (d) => (stderr += d))
  child.stdout.on('data', (d) => {
    buf += d
    for (;;) {
      const i = buf.indexOf('\n')
      if (i < 0) break
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      lines.push(line)
      while (waiters.length) waiters.shift()()
    }
  })
  const exited = new Promise((res) => child.on('close', (code) => res(code)))
  let nextId = 1
  const readReply = async (timeoutMs) => {
    const end = Date.now() + timeoutMs
    while (!lines.length) {
      if (Date.now() > end) return null
      await new Promise((res) => {
        waiters.push(res)
        setTimeout(res, 100)
      })
    }
    return lines.shift()
  }
  return {
    child,
    exited,
    stderr: () => stderr,
    writeRaw: (text) => child.stdin.write(text),
    readReply,
    // Sends a request and returns the parsed reply with the same id.
    async call(method, params, { timeoutMs = 120000, id = nextId++ } = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      const end = Date.now() + timeoutMs
      for (;;) {
        const line = await readReply(Math.max(100, end - Date.now()))
        if (line === null) throw new Error(`no reply to ${method} within ${timeoutMs} ms (stderr: ${stderr.slice(-300)})`)
        const msg = JSON.parse(line)
        if (msg.id === id) return msg
      }
    },
    notify: (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`),
    async close() {
      try {
        child.stdin.end()
      } catch {
        /* closed */
      }
      const t = setTimeout(() => killTree(child), 5000)
      const code = await exited
      clearTimeout(t)
      return code
    },
  }
}
