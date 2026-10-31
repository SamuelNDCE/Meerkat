// Shared sandbox helper for the checks that RUN a project (functionality-run, runtime smoke). Zero dependencies.
//   makeCleanCopy(root, opts)   a temp copy of the git-tracked files only
//   scrubbedEnv(extra, opts)    a minimal environment: no tokens, keys or cloud credentials ever pass through
//   runIn(dir, cmd, args, opts) spawn WITHOUT a shell, capped output, hard timeout that kills the whole process tree
//   detectCommands(dir)         the install, build, test, start and dev commands a project declares
//   cleanup(dir)                remove a temp directory (refuses anything outside the OS temp folder)
// Every path that is printed should go through safe(), which removes control characters.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const MB = 1024 * 1024
const BIG_FILE = 2 * MB
const WALK_SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'venv', '.venv'])
const WIN = process.platform === 'win32'

// Control characters removed (a file name can carry an escape sequence that rewrites a terminal).
export const safe = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?')

// ---- cleanup (registered once for exit and for Ctrl+C)
const live = new Set()
let hooked = false
const norm = (p) => (WIN ? p.toLowerCase() : p)
const real = (p) => {
  try {
    return realpathSync.native(p)
  } catch {
    return resolve(p)
  }
}
const insideTmp = (dir) => {
  const root = norm(real(tmpdir()))
  const target = norm(real(dir))
  return target !== root && target.startsWith(root.endsWith(sep) ? root : root + sep)
}
// Removes `dir` only when it lies inside the OS temp folder (and is not that folder). Returns true when it was removed or already gone.
export function cleanup(dir) {
  if (typeof dir !== 'string' || !dir) return false
  const abs = resolve(dir)
  if (!existsSync(abs)) {
    live.delete(abs)
    return true
  }
  if (!insideTmp(abs)) return false
  try {
    rmSync(abs, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {
    return false
  }
  live.delete(abs)
  return !existsSync(abs)
}
function register(dir) {
  live.add(resolve(dir))
  if (hooked) return
  hooked = true
  const all = () => {
    for (const d of [...live]) cleanup(d)
  }
  process.on('exit', all)
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      all()
      process.exit(sig === 'SIGINT' ? 130 : 143)
    })
  }
}
export function makeTemp(prefix = 'meerkat-run-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  register(dir)
  return dir
}

// ---- makeCleanCopy
function gitTracked(root) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * MB })
    return out.split('\0').filter(Boolean)
  } catch {
    return null
  }
}
function walk(root) {
  const files = []
  const go = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (WALK_SKIP.has(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) go(p)
      else if (e.isFile()) files.push(relative(root, p).split(sep).join('/'))
    }
  }
  go(root)
  return files
}
// Returns { ok: true, dir, mode: 'git'|'walk', copied, skipped: [paths], note } or { ok: false, reason } (a NOT RUN reason).
export function makeCleanCopy(root, { trackedOnly = true, maxMb = 200 } = {}) {
  const src = resolve(root)
  if (!existsSync(src) || !statSync(src).isDirectory()) return { ok: false, reason: `${safe(src)} is not a folder` }
  let mode = 'git'
  let note = 'copied the files git tracks'
  let list = trackedOnly ? gitTracked(src) : null
  if (!list) {
    mode = 'walk'
    note = trackedOnly ? 'not a git repository: copied by walking the folder, skipping node_modules, .git, target, dist, build, venv and .venv' : 'copied by walking the folder, skipping node_modules, .git, target, dist, build, venv and .venv'
    list = walk(src)
  }
  const sized = []
  for (const f of list) {
    try {
      const st = statSync(join(src, f))
      if (st.isFile()) sized.push({ f, size: st.size, mode: st.mode })
    } catch {
      /* tracked but deleted from the working tree: not part of what runs */
    }
  }
  const cap = maxMb * MB
  let total = sized.reduce((n, x) => n + x.size, 0)
  let keep = sized
  const skipped = []
  if (total > cap) {
    keep = sized.filter((x) => (x.size > BIG_FILE ? (skipped.push(x.f), false) : true))
    total = keep.reduce((n, x) => n + x.size, 0)
    if (total > cap) return { ok: false, reason: `the files add up to ${Math.round(total / MB)} MB even without files over 2 MB, more than the ${maxMb} MB limit for a copy` }
    note += `; skipped ${skipped.length} file(s) over 2 MB because the folder is over ${maxMb} MB`
  }
  const dir = makeTemp('meerkat-copy-')
  try {
    for (const x of keep) {
      const to = join(dir, x.f)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(join(src, x.f), to)
      try {
        chmodSync(to, x.mode & 0o777)
      } catch {
        /* modes are best effort (Windows) */
      }
    }
  } catch (e) {
    cleanup(dir)
    return { ok: false, reason: `could not copy: ${safe(e.message)}` }
  }
  return { ok: true, dir, mode, copied: keep.length, skipped, note }
}

// ---- scrubbedEnv
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
// A minimal environment. Only the variables below are taken from this process; everything else (tokens, keys, cloud credentials, proxy
// settings, npm auth) is left out. HOME and the temp folders point at a throwaway home so nothing reads the real user config.
export function scrubbedEnv(extra = {}, { home } = {}) {
  const h = home ?? makeTemp('meerkat-home-')
  const tmp = join(h, 'tmp')
  mkdirSync(tmp, { recursive: true })
  const env = { PATH: process.env.PATH ?? process.env.Path ?? '', HOME: h, USERPROFILE: h, TMP: tmp, TEMP: tmp, TMPDIR: tmp, LANG: 'C.UTF-8', CI: '1', NO_COLOR: '1', npm_config_update_notifier: 'false', DO_NOT_TRACK: '1' }
  if (WIN) {
    for (const k of ['SystemRoot', 'ComSpec', 'PATHEXT', 'WINDIR']) if (process.env[k]) env[k] = process.env[k]
    env.APPDATA = join(h, 'AppData', 'Roaming')
    env.LOCALAPPDATA = join(h, 'AppData', 'Local')
    mkdirSync(env.APPDATA, { recursive: true })
    mkdirSync(env.LOCALAPPDATA, { recursive: true })
  }
  for (const [k, v] of Object.entries(extra ?? {})) if (SAFE_KEY.test(k) && typeof v === 'string') env[k] = v
  return env
}

// ---- runIn
const META = /[&|<>^"%!()`;\r\n\0]/
function resolveOnPath(cmd, env) {
  const dirs = String(env.PATH ?? '').split(delimiter).filter(Boolean)
  const exts = WIN ? String(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : ['']
  if (isAbsolute(cmd) || /[\\/]/.test(cmd)) return existsSync(cmd) ? cmd : null
  for (const d of dirs) {
    for (const e of WIN ? [...exts, ''] : exts) {
      const p = join(d, cmd + e)
      try {
        if (statSync(p).isFile()) return p
      } catch {
        /* next */
      }
    }
  }
  return null
}
function killTree(child) {
  try {
    if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}
// Runs one program with no shell. Resolves { code, signal, timedOut, output, ms }; never throws.
export function runIn(dir, cmd, args = [], { timeoutMs = 600_000, env, maxOutputKb = 256 } = {}) {
  return new Promise((resolveRun) => {
    const started = Date.now()
    const e = env ?? scrubbedEnv()
    // A throwaway home made for this one run is removed when it ends; a caller-supplied environment is the caller's to clean up.
    const done = env ? resolveRun : (r) => (cleanup(e.HOME), resolveRun(r))
    const fail = (msg) => done({ code: 127, signal: null, timedOut: false, output: msg, ms: Date.now() - started })
    let file = cmd === 'node' ? process.execPath : cmd
    let argv = args.map(String)
    let opts = { cwd: dir, env: e, windowsHide: true, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] }
    if (WIN && file !== process.execPath) {
      const found = resolveOnPath(file, e)
      if (!found) return fail(`${safe(cmd)}: command not found`)
      file = found
      if (/\.(cmd|bat)$/i.test(found)) {
        // Node refuses to spawn a .cmd shim directly; cmd.exe runs it, but only once nothing in the line can mean something to cmd.exe.
        if (argv.some((a) => META.test(a)) || /["%\r\n]/.test(found)) return fail(`refused: an argument contains a shell metacharacter (${safe([cmd, ...argv].join(' '))})`)
        const q = (a) => (/[\s]/.test(a) || a === '' ? `"${a}"` : a)
        argv = ['/d', '/s', '/c', `"${[found, ...argv].map(q).join(' ')}"`]
        file = e.ComSpec || 'cmd.exe'
        opts = { ...opts, windowsVerbatimArguments: true }
      }
    }
    let out = ''
    const cap = maxOutputKb * 1024
    const add = (b) => {
      out += b.toString()
      if (out.length > cap * 2) out = out.slice(-cap)
    }
    let child
    try {
      child = spawn(file, argv, opts)
    } catch (err) {
      return fail(safe(err.message))
    }
    let settled = false
    let timedOut = false
    let timer
    const finish = (code, signal, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (out.length > cap) out = `...[output cut]\n${out.slice(-cap)}`
      done({ code, signal: signal ?? null, timedOut, output: out + extra, ms: Date.now() - started })
    }
    child.stdout?.on('data', add)
    child.stderr?.on('data', add)
    timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      // A wedged child may never close its pipes: do not wait for 'close'.
      setTimeout(() => finish(124, null, `\ntimed out after ${Math.round(timeoutMs / 1000)}s`), 500)
    }, timeoutMs)
    child.on('error', (err) => finish(127, null, `\n${safe(err.message)}`))
    child.on('close', (code, signal) => finish(code ?? 1, signal))
  })
}

// ---- detectCommands
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const NO_TEST = /no test specified/i
// { install, build, test, start, dev, ecosystems } where each command is [program, ...args] or null.
export function detectCommands(dir) {
  const has = (f) => existsSync(join(dir, f))
  const r = { install: null, build: null, test: null, start: null, dev: null, ecosystems: [] }
  const pkg = has('package.json') ? readJson(join(dir, 'package.json')) : null
  if (pkg) {
    r.ecosystems.push('node')
    const s = pkg.scripts ?? {}
    const deps = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length + Object.keys(pkg.optionalDependencies ?? {}).length
    if (has('package-lock.json')) r.install = ['npm', 'ci']
    else if (has('pnpm-lock.yaml')) r.install = ['pnpm', 'install', '--frozen-lockfile']
    else if (has('yarn.lock')) r.install = ['yarn', 'install', '--frozen-lockfile']
    else if (deps) r.install = ['npm', 'install']
    if (typeof s.build === 'string') r.build = ['npm', 'run', 'build']
    if (typeof s.test === 'string' && !NO_TEST.test(s.test)) r.test = ['npm', 'test']
    if (typeof s.start === 'string') r.start = ['npm', 'start']
    if (typeof s.dev === 'string') r.dev = ['npm', 'run', 'dev']
  }
  const set = (k, v) => {
    if (!r[k]) r[k] = v
  }
  if (has('pytest.ini') || has('tox.ini') || has('pyproject.toml') || has('setup.cfg')) {
    const hay = ['pyproject.toml', 'setup.cfg', 'tox.ini'].filter(has).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    if (has('pytest.ini') || /pytest/i.test(hay)) {
      r.ecosystems.push('python')
      set('test', ['python', '-m', 'pytest', '-q'])
    }
  }
  if (has('go.mod')) {
    r.ecosystems.push('go')
    set('build', ['go', 'build', './...'])
    set('test', ['go', 'test', './...'])
  }
  if (has('Cargo.toml')) {
    r.ecosystems.push('rust')
    set('build', ['cargo', 'build'])
    set('test', ['cargo', 'test'])
  }
  if (has('pom.xml')) {
    r.ecosystems.push('java')
    set('build', ['mvn', '-q', '-DskipTests', 'package'])
  }
  let csproj = false
  try {
    csproj = readdirSync(dir).some((f) => /\.(cs|fs|vb)proj$|\.sln$/i.test(f))
  } catch {
    /* unreadable */
  }
  if (csproj) {
    r.ecosystems.push('dotnet')
    set('build', ['dotnet', 'build'])
    set('test', ['dotnet', 'test'])
  }
  return r
}
