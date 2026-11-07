// Adversarial round (2026-11): awkward inputs, broken run stores, concurrent and killed runs, and hostile MCP traffic.
// Every case runs the real CLI (node bin/meerkat.mjs ...) in a folder this test creates, with a timeout, and asserts: no stack trace or
// uncaught exception in stderr, an exit code from the documented list (docs/commands.md "Exit codes"), the command finishes in time, and
// where it matters the answer is right. Cases that cannot run on this machine say why and return early (reported in the case name).
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin', 'meerkat.mjs')
// docs/commands.md "Exit codes": 0 passed, 1 failed, 2 usage/config, 3 nothing to run, 75 could not start, 130 interrupted.
const DOCUMENTED = [0, 1, 2, 3, 75, 130]
const WIN = process.platform === 'win32'

const made: string[] = []
afterAll(() => {
  for (const d of made) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      /* best effort */
    }
  }
})
const base = mkdtempSync(join(tmpdir(), 'mk-adv-'))
made.push(base)
let seq = 0
function sandbox(name = 'p'): { dir: string; logs: string; home: string } {
  const root = join(base, `${name}-${++seq}`)
  mkdirSync(root, { recursive: true })
  const logs = join(root, 'logs')
  const home = join(root, 'home')
  mkdirSync(logs)
  mkdirSync(home)
  return { dir: root, logs, home }
}
const PKG = JSON.stringify({ name: 'adv', version: '1.0.0', license: 'MIT', description: 'x', scripts: { test: 'node -e 0' } })
function write(dir: string, files: Record<string, string | Buffer>) {
  for (const [k, v] of Object.entries(files)) {
    const p = join(dir, k)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, v)
  }
}
const envFor = (s: { logs: string; home: string }, extra: Record<string, string> = {}) => ({
  ...process.env,
  MEERKAT_LOG_DIR: s.logs,
  MEERKAT_HOME: s.home,
  HOME: s.home,
  USERPROFILE: s.home,
  MEERKAT_NO_TIP: '1',
  MEERKAT_PLAIN: '1',
  NO_COLOR: '1',
  ...extra,
})

type R = { code: number | null; stdout: string; stderr: string; timedOut: boolean; ms: number }
function killTree(child: ChildProcess) {
  try {
    if (WIN && child.pid) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}
function cli(args: string[], o: { cwd?: string; env: Record<string, string | undefined>; timeout?: number; input?: string }): Promise<R> {
  return new Promise((done) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [BIN, ...args], { cwd: o.cwd ?? ROOT, env: o.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.stdin.on('error', () => {})
    child.stdin.end(o.input ?? '')
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, o.timeout ?? 150000)
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr, timedOut, ms: Date.now() - t0 })
    })
  })
}
const STACK = /^\s+at .+[:(]\d+:\d+\)?\s*$/m
const CRASH = /Uncaught|UnhandledPromiseRejection|node:internal|\[ERR_[A-Z_]+\]|Error: (EPERM|EACCES|EBUSY|ENOENT|EMFILE|ENAMETOOLONG|EISDIR|ENOTDIR|ELOOP)|maximum call stack|heap out of memory/i
function sane(r: R, label = '') {
  expect(r.timedOut, `${label} timed out`).toBe(false)
  expect(r.stderr, `${label} stack trace in stderr`).not.toMatch(STACK)
  expect(r.stderr + r.stdout, `${label} crash text`).not.toMatch(CRASH)
  expect(DOCUMENTED, `${label} exit code ${r.code}`).toContain(r.code)
}
// A scan of a project through the quick preset, as JSON.
async function verify(s: { dir: string; logs: string; home: string }, target: string, extraArgs: string[] = [], extraEnv: Record<string, string> = {}) {
  const r = await cli(['verify', target, '--no-input', '--json', ...extraArgs], { env: envFor(s, extraEnv), timeout: 170000 })
  let json: any = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    /* not JSON */
  }
  return { r, json }
}
function allText(dir: string): string {
  let out = ''
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/findings\.json$|summary\.json$/.test(e.name)) out += readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return out
}

const T = 180000

describe('awkward inputs', () => {
  test('1 folder name with spaces, apostrophe, dollar, ampersand and unicode', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, "my app's & café $HOME")
    mkdirSync(proj)
    write(proj, { 'package.json': PKG, 'index.js': 'console.log("hi")\n', 'README.md': '# adv\n' })
    const { r, json } = await verify(s, proj)
    sane(r, 'case1')
    expect(json, r.stderr).not.toBeNull()
    expect(json.runDir).toBeTruthy()
    expect(existsSync(json.runDir)).toBe(true)
    expect(String(json.project?.path ?? json.runDir)).toMatch(/caf|my app/)
  })

  test('2 file name with a leading dash (and a newline where the OS allows it)', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    mkdirSync(proj)
    write(proj, { 'package.json': PKG, '-rf.js': 'console.log(1)\n', '--help.md': '# x\n', '-n': 'x\n' })
    let nl = false
    try {
      writeFileSync(join(proj, 'a\nb.js'), 'console.log(2)\n')
      nl = true
    } catch {
      /* Windows cannot create a file name with a newline: leading-dash half only */
    }
    execFileSync('git', ['init', '-q'], { cwd: proj })
    execFileSync('git', ['add', '-A'], { cwd: proj })
    const { r, json } = await verify(s, proj)
    sane(r, `case2 newline=${nl}`)
    expect(json).not.toBeNull()
  })

  test('3 path longer than 240 characters', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    let deep = proj
    while (deep.length < 260) deep = join(deep, 'segment-of-a-long-directory-name')
    try {
      mkdirSync(deep, { recursive: true })
      writeFileSync(join(deep, 'deep.js'), 'console.log(1)\n')
    } catch {
      { console.log("ADV-SKIP case3: the OS refused to create it: nothing to scan"); return }
    }
    write(proj, { 'package.json': PKG })
    const { r, json } = await verify(s, proj)
    sane(r, 'case3')
    expect(json).not.toBeNull()
  })

  test('4 binary file named .js and 5 MB of minified one-line javascript', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    const bin = Buffer.alloc(200000)
    for (let i = 0; i < bin.length; i++) bin[i] = (i * 31 + 7) & 0xff
    const chunk = 'function f(a,b){return a+b}var x=f(1,2);if(x==3){console.log("x")}'
    const big = chunk.repeat(Math.ceil((5 * 1024 * 1024) / chunk.length))
    write(proj, { 'package.json': PKG, 'blob.js': bin, 'dist/app.min.js': big, 'src/index.js': 'export const a = 1\n' })
    const { r, json } = await verify(s, proj)
    sane(r, 'case4')
    expect(json).not.toBeNull()
    expect(r.ms).toBeLessThan(160000)
  })

  test('5 CRLF file with a BOM, and a file with mixed line endings', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, {
      'package.json': PKG,
      'bom.js': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('const a = 1\r\nconst b = 2\r\nconsole.log(a + b)\r\n')]),
      'mixed.js': 'const a = 1\r\nconst b = 2\nconst c = 3\rconsole.log(a)\r\n\n',
      'bom.json': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}\r\n')]),
      'README.md': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# adv\r\n\r\n## Install\r\n')]),
    })
    const { r, json } = await verify(s, proj)
    sane(r, 'case5')
    expect(json).not.toBeNull()
    // A BOM-prefixed JSON file is valid JSON for every parser that matters here: json-valid must not report it as broken.
    const text = allText(json.runDir)
    expect(text).not.toMatch(/bom\.json[^\n]{0,200}(invalid|unexpected token)/i)
  })

  test('6 symlink or junction pointing outside the project is not followed', { timeout: T }, async () => {
    const s = sandbox()
    const outside = join(s.dir, 'outside-secret-zone')
    mkdirSync(outside)
    const leak = '// nothing\nconst awsKey = "AKIAIOSFODNN7EXAMPLE"\nconst token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"\n'
    writeFileSync(join(outside, 'leakyfile.js'), leak)
    const proj = join(s.dir, 'p')
    write(proj, { 'package.json': PKG, 'index.js': 'console.log(1)\n', 'own.js': leak })
    try {
      symlinkSync(outside, join(proj, 'escape'), WIN ? 'junction' : 'dir')
      symlinkSync(join(outside, 'leakyfile.js'), join(proj, 'direct-link.js'), 'file')
    } catch (e: any) {
      if (!existsSync(join(proj, 'escape'))) { console.log("ADV-SKIP case6: symlink creation not allowed here (Windows without developer mode/admin)"); return }
    }
    const { r, json } = await verify(s, proj)
    sane(r, 'case6')
    expect(json).not.toBeNull()
    const text = allText(json.runDir) + r.stdout + r.stderr
    expect(text, 'control: the same content inside the project is found').toMatch(/own\.js/)
    expect(text.match(/.{0,100}leakyfile.{0,100}/)?.[0] ?? null).toBeNull()
  })

  test('7 empty folder, README-only folder, git repo with zero commits', { timeout: T }, async () => {
    const s = sandbox()
    const empty = join(s.dir, 'empty')
    const readme = join(s.dir, 'readme-only')
    const zero = join(s.dir, 'zero-commits')
    for (const d of [empty, readme, zero]) mkdirSync(d)
    write(readme, { 'README.md': '# only\n' })
    execFileSync('git', ['init', '-q'], { cwd: zero })
    for (const d of [empty, readme]) {
      const { r } = await verify(s, d)
      sane(r, `case7 ${d}`)
      expect([2, 3, 75, 1, 0]).toContain(r.code)
      expect(r.stderr + r.stdout).not.toBe('')
    }
    const { r, json } = await verify(s, zero)
    sane(r, 'case7 zero commits')
    expect(json !== null || r.code === 2 || r.code === 3).toBe(true)
  })

  test('8 no package.json, no git, no config (with --force)', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, { 'a.js': 'console.log(1)\n', 'b.py': 'print(1)\n', 'c.go': 'package main\n', 'notes.txt': 'hello\n' })
    const { r, json } = await verify(s, proj, ['--force'])
    sane(r, 'case8')
    expect(json).not.toBeNull()
  })

  test('9 package.json invalid JSON, and a script that is not a string', { timeout: T }, async () => {
    const s = sandbox()
    const bad = join(s.dir, 'bad')
    const odd = join(s.dir, 'odd')
    write(bad, { 'package.json': '{ "name": "x", "version": ', 'index.js': 'console.log(1)\n' })
    write(odd, {
      'package.json': JSON.stringify({ name: 'odd', version: '1.0.0', scripts: { test: 42, build: ['a', 'b'], lint: null, start: { x: 1 }, dev: true }, dependencies: { a: 5, b: null, c: ['x'] }, bin: 7, main: { x: 1 }, files: 'nope', engines: 3 }),
      'index.js': 'console.log(1)\n',
    })
    for (const d of [bad, odd]) {
      const { r, json } = await verify(s, d, ['--force'])
      sane(r, `case9 ${d}`)
      expect(json, r.stderr).not.toBeNull()
    }
  })

  test('10 huge node_modules excluded by .gitignore is not walked', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, { 'package.json': PKG, '.gitignore': 'node_modules/\n', 'index.js': 'console.log(1)\n' })
    for (let i = 0; i < 2000; i++) {
      const d = join(proj, 'node_modules', `pkg${i % 50}`)
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, `f${i}.js`), `// vendored\nconst key = "AKIAIOSFODNN7EXAMPLE"\nvar x${i} = 1\n`)
    }
    execFileSync('git', ['init', '-q'], { cwd: proj })
    const { r, json } = await verify(s, proj)
    sane(r, 'case10')
    expect(json).not.toBeNull()
    const text = allText(json.runDir)
    expect(text.match(/.{0,100}(node_modules[\/]|pkg\d+|f\d+\.js).{0,100}/)?.[0] ?? null).toBeNull()
  })
})

describe('runtime states', () => {
  test('11 corrupt run store: last and findings explain it and do not crash', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, { 'package.json': PKG, 'index.js': 'console.log(1)\n' })
    const { r, json } = await verify(s, proj)
    sane(r, 'case11 setup')
    const runDir: string = json.runDir
    const garbage = '\u0000\u0001{{{ not json [[[ �'
    for (const f of ['findings.json', 'summary.json', 'report.md']) writeFileSync(join(runDir, f), garbage)
    for (const args of [['last'], ['findings'], ['run', 'show'], ['run', 'list'], ['why', 'secret-scan'], ['trend'], ['suggest'], ['pr-comment'], ['prompt']]) {
      const o = await cli(args, { cwd: proj, env: envFor(s), timeout: 60000 })
      sane(o, `case11 ${args.join(' ')}`)
    }
    // pointer garbage as well
    writeFileSync(join(s.logs, 'latest.json'), garbage)
    for (const args of [['last'], ['findings'], ['run', 'list']]) {
      const o = await cli(args, { cwd: proj, env: envFor(s), timeout: 60000 })
      sane(o, `case11 pointer ${args.join(' ')}`)
    }
    const o = await cli(['findings'], { cwd: proj, env: envFor(s), timeout: 60000 })
    expect((o.stdout + o.stderr).length).toBeGreaterThan(0)
  })

  test('12 two runs at once in the same folder both finish and the pointer is valid', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, { 'package.json': PKG, 'index.js': 'console.log(1)\n' })
    const [a, b] = await Promise.all([verify(s, proj), verify(s, proj)])
    sane(a.r, 'case12 a')
    sane(b.r, 'case12 b')
    expect(a.json, a.r.stderr).not.toBeNull()
    expect(b.json, b.r.stderr).not.toBeNull()
    expect(a.json.runDir, 'both runs wrote into the same run folder').not.toBe(b.json.runDir)
    for (const j of [a.json, b.json]) {
      expect(() => JSON.parse(readFileSync(join(j.runDir, 'summary.json'), 'utf8'))).not.toThrow()
      expect(() => JSON.parse(readFileSync(join(j.runDir, 'findings.json'), 'utf8'))).not.toThrow()
    }
    const ptr = JSON.parse(readFileSync(join(s.logs, 'latest.json'), 'utf8'))
    expect(existsSync(ptr.dir)).toBe(true)
    const last = await cli(['last'], { cwd: proj, env: envFor(s), timeout: 60000 })
    sane(last, 'case12 last')
  })

  test('13 a run killed midway: the next run works and the log does not claim it passed', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, { 'package.json': PKG, 'index.js': 'console.log(1)\n' })
    const child = spawn(process.execPath, [BIN, 'verify', proj, '--no-input'], { env: envFor(s) as NodeJS.ProcessEnv, stdio: 'ignore' })
    // wait for the run to start writing (its folder exists), then let it work for 2 seconds before killing it
    for (let i = 0; i < 100 && !(existsSync(join(s.logs, 'runs')) && readdirSync(join(s.logs, 'runs')).length > 0); i++) await new Promise((r) => setTimeout(r, 200))
    await new Promise((r) => setTimeout(r, 2000))
    killTree(child)
    await new Promise((r) => child.on('close', r))
    await new Promise((r) => setTimeout(r, 500))
    const runsDir = join(s.logs, 'runs')
    const killedRuns = existsSync(runsDir) ? readdirSync(runsDir) : []
    const list1 = await cli(['run', 'list'], { cwd: proj, env: envFor(s), timeout: 60000 })
    sane(list1, 'case13 list after kill')
    const last1 = await cli(['last'], { cwd: proj, env: envFor(s), timeout: 60000 })
    sane(last1, 'case13 last after kill')
    expect(killedRuns.length, 'the killed run left no folder at all').toBeGreaterThan(0)
    {
      const shown = (last1.stdout + list1.stdout).toLowerCase()
      expect(shown, 'the killed run must not be reported as passed').not.toMatch(/\bpassed\b.*\(exit code 0\)|result: \*\*all passed|result: all passed/)
      expect(shown).toMatch(/did not finish/)
    }
    const { r, json } = await verify(s, proj)
    sane(r, 'case13 next run')
    expect(json).not.toBeNull()
  })

  test('14 read-only project folder: the scan works, a write failure is a message', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, { 'package.json': PKG, 'index.js': 'console.log(1)\n' })
    let restore = () => {}
    try {
      if (WIN) {
        const who = execFileSync('whoami', { encoding: 'utf8' }).trim()
        execFileSync('icacls', [proj, '/deny', `${who}:(OI)(CI)(WD,AD)`], { stdio: 'ignore' })
        restore = () => execFileSync('icacls', [proj, '/remove:d', who], { stdio: 'ignore' })
        try {
          writeFileSync(join(proj, 'probe.txt'), 'x')
          restore()
          { console.log("ADV-SKIP case14: the deny did not take effect (elevated user): cannot make the folder read-only here"); return }
        } catch {
          /* denied as intended */
        }
      } else {
        chmodSync(proj, 0o555)
        restore = () => chmodSync(proj, 0o755)
        if (process.getuid?.() === 0) { console.log("ADV-SKIP case14: root"); return }
      }
      const { r, json } = await verify(s, proj)
      sane(r, 'case14')
      expect(json, r.stderr).not.toBeNull()
      // nothing may have been written into the project
      expect(readdirSync(proj).sort()).toEqual(['index.js', 'package.json'])
    } finally {
      restore()
    }
  })

  test('15 no network: update check and a run finish and say the lookup was not done', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, { 'package.json': PKG, 'index.js': 'console.log(1)\n' })
    // The only network use is one `git fetch origin` (lib/update.mjs). No Meerkat variable moves it, so git is told that origin lives at a dead local port.
    const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const dead = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'url.http://127.0.0.1:9/dead.insteadOf', GIT_CONFIG_VALUE_0: origin }
    const up = await cli(['update', 'check'], { cwd: ROOT, env: envFor(s, dead), timeout: 60000 })
    sane(up, 'case15 update check')
    expect(up.stdout + up.stderr, 'an offline lookup must say it could not check, never claim up to date').toMatch(/could not check|cannot update|offline/i)
    expect(up.stdout + up.stderr).not.toMatch(/is up to date/i)
    const { r, json } = await verify(s, proj, [], dead)
    sane(r, 'case15 run')
    expect(json, r.stderr).not.toBeNull()
  })

  test('16 a check that prints 10000 lines: console output is capped, the log has all of it', { timeout: T }, async () => {
    const s = sandbox()
    const proj = join(s.dir, 'p')
    write(proj, {
      'package.json': PKG,
      'index.js': 'console.log(1)\n',
      'meerkat.config.json': JSON.stringify({ extraChecks: ['mychecks'] }),
      'mychecks/noisy.mjs': `export default [{ id: 'noisy-output', group: 'functionality', tier: 'fast', lane: 'free', weight: 'light', title: 'prints a lot', estSeconds: 1, run: { cmd: process.execPath, args: ['-e', 'for(let i=0;i<10000;i++)console.log("noisy line "+i)'], cwd: 'app' } }]\n`,
    })
    const o = await cli(['check', 'noisy-output', proj, '--no-input'], { env: envFor(s), timeout: 120000 })
    sane(o, 'case16')
    const lines = (o.stdout + o.stderr).split('\n').length
    expect(lines, 'console output should be capped').toBeLessThan(2000)
    const runs = join(s.logs, 'runs')
    const dirs = existsSync(runs) ? readdirSync(runs) : []
    expect(dirs.length).toBeGreaterThan(0)
    const logFile = dirs.map((d) => join(runs, d, 'noisy-output.log')).find((f) => existsSync(f))
    expect(logFile, `no noisy-output.log in ${dirs.join(',')}\n${o.stdout}${o.stderr}`).toBeTruthy()
    const log = readFileSync(logFile!, 'utf8')
    expect(log).toContain('noisy line 9999')
    expect(log).toContain('noisy line 0')
  })
})

// ---- MCP ----
function mcpSession(cwd: string, env: Record<string, string | undefined>, lines: string[], waitMs: number, tail = true): Promise<{ replies: any[]; raw: string; stderr: string; code: number | null }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, 'mcp', 'serve'], { cwd, env: env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] })
    let raw = ''
    let stderr = ''
    child.stdout.on('data', (d) => (raw += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.stdin.on('error', () => {})
    for (const l of lines) child.stdin.write(`${l}\n`)
    const finish = () => {
      if (tail) child.stdin.end()
      setTimeout(() => killTree(child), 15000)
    }
    setTimeout(finish, waitMs)
    child.on('close', (code) => {
      const replies = raw
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l)
          } catch {
            return { __unparsable: l.slice(0, 200) }
          }
        })
      done({ replies, raw, stderr, code })
    })
  })
}
const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
const call = (id: number, name: string, args: any) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })

describe('mcp', () => {
  test('17 bad folder arguments return structured errors, nothing is written outside the project', { timeout: T }, async () => {
    const s = sandbox()
    const start = join(s.dir, 'start')
    const outside = join(s.dir, 'outside')
    const meta = join(start, 'a&b;$(touch pwned) `x` %PATH%')
    mkdirSync(outside)
    write(start, { 'package.json': PKG, 'file.txt': 'x', 'index.js': 'console.log(1)\n' })
    write(meta, { 'package.json': PKG, 'index.js': 'console.log(1)\n' })
    write(outside, { 'package.json': PKG })
    const before = JSON.stringify([readdirSync(s.dir).sort(), readdirSync(outside).sort()])
    const folders: Record<string, any> = {
      file: join(start, 'file.txt'),
      missing: join(start, 'does-not-exist'),
      outside,
      dotdot: '..',
      unc: '\\\\evil-host\\share\\x',
      nul: 'a\u0000b',
      number: 7,
      meta,
      metaMissing: 'x" && echo pwned > pwned.txt && "',
    }
    const lines = [INIT]
    const names = Object.keys(folders)
    let id = 10
    for (const n of names) {
      lines.push(call(id++, 'meerkat_list', { folder: folders[n] }))
      lines.push(call(id++, 'meerkat_findings', { folder: folders[n] }))
    }
    lines.push(call(id++, 'meerkat_run', { preset: 'quick', folder: folders.outside }))
    lines.push(call(id++, 'meerkat_run', { preset: 'quick', folder: folders.file }))
    lines.push(call(id++, 'meerkat_run', { preset: 'quick', folder: folders.metaMissing }))
    const m = await mcpSession(start, envFor(s), lines, 25000)
    expect(m.stderr).not.toMatch(STACK)
    expect(m.stderr + m.raw).not.toMatch(CRASH)
    expect(m.replies.some((x) => x.__unparsable)).toBe(false)
    const byId = new Map(m.replies.map((x) => [x.id, x]))
    for (let i = 10; i < id; i++) {
      const rep = byId.get(i)
      expect(rep, `no reply for request ${i}\n${m.raw.slice(0, 400)}\n${m.stderr}`).toBeTruthy()
      const bad = i < 10 + names.length * 2 ? names[Math.floor((i - 10) / 2)] : 'run'
      if (['outside', 'file', 'missing', 'dotdot', 'unc', 'nul', 'number', 'metaMissing'].includes(bad) || bad === 'run') {
        const isErr = rep.error || rep.result?.isError
        expect(isErr, `request ${i} (${bad}) should be a structured error: ${JSON.stringify(rep).slice(0, 300)}`).toBeTruthy()
      }
    }
    const after = JSON.stringify([readdirSync(s.dir).sort(), readdirSync(outside).sort()])
    expect(after).toBe(before)
    for (const p of [join(start, 'pwned'), join(start, 'pwned.txt'), join(s.dir, 'pwned'), join(s.dir, 'pwned.txt'), join(outside, 'pwned.txt')]) expect(existsSync(p), p).toBe(false)
    expect(readdirSync(outside).sort()).toEqual(['package.json'])
  })

  test('18 malformed line, 1 MB line and a request with no id: the server keeps running', { timeout: T }, async () => {
    const s = sandbox()
    const start = join(s.dir, 'start')
    write(start, { 'package.json': PKG, 'index.js': 'console.log(1)\n' })
    const huge = JSON.stringify({ jsonrpc: '2.0', id: 77, method: 'tools/call', params: { name: 'meerkat_list', arguments: { folder: 'x'.repeat(1024 * 1024) } } })
    const lines = [
      INIT,
      '{this is not json',
      '[]',
      'null',
      '"just a string"',
      '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"meerkat_list","arguments":{}}}',
      '{"jsonrpc":"2.0","method":"tools/call"}',
      '{"jsonrpc":"2.0","id":null,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":5,"method":"no/such/method"}',
      '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"nope","arguments":null}}',
      '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":"x"}',
      huge,
      JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }),
    ]
    const m = await mcpSession(start, envFor(s), lines, 8000)
    expect(m.stderr).not.toMatch(STACK)
    expect(m.replies.some((x) => x.__unparsable)).toBe(false)
    const last = m.replies.find((x) => x.id === 99)
    expect(last, `the server stopped answering after the hostile lines\n${m.raw.slice(0, 600)}\n${m.stderr.slice(0, 600)}`).toBeTruthy()
    expect(Array.isArray(last.result?.tools)).toBe(true)
    const big = m.replies.find((x) => x.id === 77)
    expect(big, 'the 1 MB request got no reply').toBeTruthy()
    expect(big.error || big.result?.isError).toBeTruthy()
    expect(m.raw.length, 'a reply echoed the 1 MB argument back').toBeLessThan(900000)
  })
})

describe('exit codes', () => {
  test('docs list the exit codes used above', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'commands.md'), 'utf8')
    const section = doc.slice(doc.indexOf('## Exit codes'), doc.indexOf('## Output and machine use'))
    const codes = [...section.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]))
    expect(codes.sort((a, b) => a - b)).toEqual(DOCUMENTED)
    expect(statSync(BIN).isFile()).toBe(true)
    expect(resolve(BIN)).toContain('meerkat')
  })
})
