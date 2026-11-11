// End-to-end tests for `meerkat gate`: a real git repo, real branches, the real CLI as a child process, real exit codes and output.
// Every run uses its own state folder (MEERKAT_LOG_DIR + MEERKAT_HOME) so the result cache and the broken-tool marks never touch ~/.meerkat.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'meerkat.mjs')
const ROOT = mkdtempSync(join(tmpdir(), 'mk-gate-e2e-'))
const timings: { case: string; args: string; exit: number | null; seconds: string }[] = []

type Run = { code: number | null; stdout: string; stderr: string; ms: number }

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}

const envFor = (state: string) => ({ ...process.env, CI: '1', NO_COLOR: '1', MEERKAT_LOG_DIR: join(state, 'logs'), MEERKAT_HOME: join(state, 'home'), MEERKAT_PROGRESS: '0' })

function runGate(cwd: string, state: string, label: string, args: string[] = []): Promise<Run> {
  return new Promise((done) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [BIN, 'gate', '--no-input', ...args], { cwd, env: envFor(state) })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => {
      const ms = Date.now() - t0
      timings.push({ case: label, args: args.join(' ') || '(none)', exit: code, seconds: (ms / 1000).toFixed(2) })
      done({ code, stdout, stderr, ms })
    })
  })
}

// A repo with `main` (index.js importing lib.js and old.js, where old.js already has an eval) and a branch `feat` that changes lib.js.
function makeRepo(name: string, featLib: string) {
  const dir = join(ROOT, name)
  const state = join(ROOT, `${name}-state`)
  mkdirSync(dir, { recursive: true })
  mkdirSync(state, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'config', 'user.name', 'e2e')
  writeFileSync(join(dir, 'index.js'), "import { lib } from './lib.js'\nimport { old } from './old.js'\nconsole.log(lib(), old)\n")
  writeFileSync(join(dir, 'lib.js'), 'export const lib = () => 1\n')
  writeFileSync(join(dir, 'old.js'), "export const old = 1\n")
  git(dir, 'add', 'index.js', 'lib.js', 'old.js')
  git(dir, 'commit', '-q', '-m', 'one')
  git(dir, 'checkout', '-q', '-b', 'feat')
  writeFileSync(join(dir, 'lib.js'), featLib)
  git(dir, 'add', 'lib.js')
  git(dir, 'commit', '-q', '-m', 'two')
  return { dir, state }
}

const CLEAN = 'export const lib = () => 2\n'
const EVIL = "export const lib = (s) => eval(s)\n"
const firstGateLine = (r: Run) => r.stdout.split(/\r?\n/).find((l) => l.startsWith('MEERKAT gate:')) ?? ''
const blockingOf = (line: string) => Number(/gate: (\d+) blocking/.exec(line)?.[1] ?? NaN)
const preOf = (line: string) => Number(/(\d+) pre-existing/.exec(line)?.[1] ?? NaN)
const findingsLines = (r: Run) => r.stdout.split(/\r?\n/).filter((l) => /^(FAIL|WARN)\s/.test(l) || /\.(js|ts):\d+/.test(l)).join('\n')
const noStack = (r: Run) => expect(r.stdout + r.stderr).not.toMatch(/^\s+at .+:\d+:\d+\)?\s*$/m)

let clean: ReturnType<typeof makeRepo>
let evil: ReturnType<typeof makeRepo>
let pre: ReturnType<typeof makeRepo>

beforeAll(() => {
  clean = makeRepo('clean', CLEAN)
  evil = makeRepo('evil', EVIL)
  // Pre-existing: old.js gets its eval on main, so it is already there on the base; the branch only changes lib.js cleanly.
  pre = makeRepo('pre', CLEAN)
  git(pre.dir, 'checkout', '-q', 'main')
  writeFileSync(join(pre.dir, 'old.js'), "export const old = eval('1')\n")
  git(pre.dir, 'add', 'old.js')
  git(pre.dir, 'commit', '-q', '-m', 'old eval')
  git(pre.dir, 'checkout', '-q', 'feat')
  git(pre.dir, 'rebase', '-q', 'main')
}, 60000)

afterAll(() => {
  console.log('\nGATE E2E TIMINGS')
  console.table(timings)
  console.log(`total of measured runs: ${timings.reduce((a, t) => a + Number(t.seconds), 0).toFixed(1)}s`)
  try {
    rmSync(ROOT, { recursive: true, force: true })
  } catch {
    /* a temp folder that cannot be removed is left to the OS */
  }
})

describe('meerkat gate end to end', () => {
  it('1. clean branch: exit 0, 0 blocking', async () => {
    const r = await runGate(clean.dir, clean.state, '1 clean', ['--no-cache'])
    const line = firstGateLine(r)
    expect(r.code, r.stdout).toBe(0)
    expect(line).toMatch(/^MEERKAT gate: 0 blocking/)
    expect(line).toContain('exit 0')
    expect(line).toContain('lib.js')
  })

  it('2. eval() in a changed file: exit 1, blocking >= 1, names the file', async () => {
    const r = await runGate(evil.dir, evil.state, '2 eval', ['--no-cache', '--full'])
    const line = firstGateLine(r)
    expect(r.code, r.stdout).toBe(1)
    expect(line).toMatch(/^MEERKAT gate: \d+ blocking/)
    expect(blockingOf(line)).toBeGreaterThanOrEqual(1)
    expect(r.stdout).toMatch(/lib\.js:\d+/)
    expect(r.stdout).toContain('eval()')
  })

  it('3. finding in an UNCHANGED file: exit 0, pre-existing >= 1', async () => {
    const r = await runGate(pre.dir, pre.state, '3 pre-existing', ['--no-cache'])
    const line = firstGateLine(r)
    expect(r.code, r.stdout).toBe(0)
    expect(blockingOf(line)).toBe(0)
    expect(preOf(line)).toBeGreaterThanOrEqual(1)
  })

  it('4. --base main and no --base give the same result on the same branch', async () => {
    const a = await runGate(evil.dir, evil.state, '4 no --base', ['--no-cache'])
    const b = await runGate(evil.dir, evil.state, '4 --base main', ['--no-cache', '--base', 'main'])
    expect(b.code).toBe(a.code)
    expect(blockingOf(firstGateLine(b))).toBe(blockingOf(firstGateLine(a)))
    expect(preOf(firstGateLine(b))).toBe(preOf(firstGateLine(a)))
    expect(findingsLines(b)).toBe(findingsLines(a))
  })

  it('5a. gate has no --preset flag: rejected with exit 2 and a one-line message (gap vs the brief)', async () => {
    const r = await runGate(clean.dir, clean.state, '5a --preset quick', ['--preset', 'quick'])
    expect(r.code).toBe(2)
    expect(r.stderr.trim().split(/\r?\n/).length).toBe(1)
    noStack(r)
  })

  it('5b. the default (fast) run and --thorough both run; the thorough run reports at least as many checks', async () => {
    const quick = await runGate(clean.dir, clean.state, '5 default(fast)', ['--no-cache', '--json'])
    const full = await runGate(clean.dir, clean.state, '5 --thorough', ['--no-cache', '--json', '--thorough'])
    const q = JSON.parse(quick.stdout.slice(quick.stdout.indexOf('{')))
    const f = JSON.parse(full.stdout.slice(full.stdout.indexOf('{')))
    expect(quick.code).toBe(0)
    expect(full.code).toBe(0)
    expect(q.rows.length).toBeGreaterThan(0)
    expect(f.rows.length).toBeGreaterThanOrEqual(q.rows.length)
  })

  it('6. --no-cache twice: identical findings; then cached run reports the cache count and the same findings', async () => {
    const a = await runGate(evil.dir, evil.state, '6 no-cache #1', ['--no-cache', '--full'])
    const b = await runGate(evil.dir, evil.state, '6 no-cache #2', ['--no-cache', '--full'])
    expect(b.code).toBe(a.code)
    expect(findingsLines(b)).toBe(findingsLines(a))
    expect(a.stdout).not.toMatch(/reused from the cache/)
    expect(b.stdout).not.toMatch(/reused from the cache/)
    // Warm the cache with one normal run, then the next must reuse it.
    await runGate(evil.dir, evil.state, '6 cache warm-up', ['--full'])
    const c = await runGate(evil.dir, evil.state, '6 cached', ['--full'])
    expect(c.code).toBe(a.code)
    expect(firstGateLine(c)).toMatch(/\(\d+ check\(s\) reused from the cache\)/)
    expect(findingsLines(c)).toBe(findingsLines(a))
  })

  it('7. editing the changed file invalidates its cached result', async () => {
    const r = makeRepo('edit', EVIL)
    const first = await runGate(r.dir, r.state, '7 first', ['--full'])
    const warm = await runGate(r.dir, r.state, '7 warm', ['--full'])
    expect(first.code).toBe(1)
    expect(warm.code).toBe(1)
    expect(firstGateLine(warm)).toMatch(/reused from the cache/)
    writeFileSync(join(r.dir, 'lib.js'), CLEAN)
    git(r.dir, 'add', 'lib.js')
    git(r.dir, 'commit', '-q', '-m', 'fix eval')
    const after = await runGate(r.dir, r.state, '7 after edit', ['--full'])
    expect(after.code, after.stdout).toBe(0)
    expect(blockingOf(firstGateLine(after))).toBe(0)
    expect(after.stdout).not.toMatch(/lib\.js:\d+ eval/)
    // And an uncommitted edit that brings the finding back is seen too (not served from the cache).
    writeFileSync(join(r.dir, 'lib.js'), EVIL)
    const again = await runGate(r.dir, r.state, '7 uncommitted edit', ['--full'])
    expect(again.code, again.stdout).toBe(1)
    expect(again.stdout).toMatch(/lib\.js:\d+/)
  })

  it('8. not a git repository: exit 2, one-line message, no stack trace', async () => {
    const dir = join(ROOT, 'nogit')
    mkdirSync(dir)
    writeFileSync(join(dir, 'a.js'), 'export const a = 1\n')
    const r = await runGate(dir, join(ROOT, 'nogit-state'), '8 not a repo')
    expect(r.code).toBe(2)
    const msg = [...new Set((r.stdout + r.stderr).trim().split(/\r?\n/).filter((l) => !l.startsWith('folder:')))] // the same reason is on stdout and stderr
    expect(msg.length).toBe(1)
    expect(msg[0]).toMatch(/not a git repository/)
    noStack(r)
  })

  it('9. unknown --base ref: non-zero, one-line message naming the ref, no stack trace', async () => {
    const r = await runGate(clean.dir, clean.state, '9 bad --base', ['--base', 'no-such-ref'])
    expect(r.code).toBe(3)
    // The same reason is on stdout (first line) and on stderr, so it is one distinct line.
    const msg = [...new Set((r.stdout + r.stderr).trim().split(/\r?\n/).filter((l) => !l.startsWith('folder:')))]
    expect(msg.length).toBe(1)
    expect(msg[0]).toContain('no-such-ref')
    expect(r.stdout.split(/\r?\n/)[0]).toBe(msg[0])
    noStack(r)
  })

  it('10. a check whose program crashes (exit 3) is a tool problem, never a pass', async () => {
    const r = makeRepo('crash', CLEAN)
    git(r.dir, 'checkout', '-q', 'main')
    writeFileSync(join(r.dir, 'crash.mjs'), 'process.exit(3)\n')
    writeFileSync(join(r.dir, 'meerkat.config.json'), JSON.stringify({ packs: ['security'], discover: false, customChecks: [{ id: 'e2e-crasher', title: 'Crashing check', cmd: 'node', args: ['crash.mjs'], suite: 'my-app', group: 'functionality', tier: 'fast' }] }))
    git(r.dir, 'add', 'crash.mjs', 'meerkat.config.json')
    git(r.dir, 'commit', '-q', '-m', 'crasher')
    git(r.dir, 'checkout', '-q', 'feat')
    git(r.dir, 'rebase', '-q', 'main')
    const out = await runGate(r.dir, r.state, '10 crashing check', ['--no-cache', '--full'])
    expect(out.code, out.stdout).not.toBe(0)
    expect(firstGateLine(out)).not.toMatch(/^MEERKAT gate: 0 blocking.*exit 0/)
    expect(out.stdout).toContain('e2e-crasher')
    // The summary calls it a tool failure, not a finding in the project's code.
    expect(out.stdout).toMatch(/[1-9]\d* tool failure\(s\)/)
  })

  it('11. --json parses and its counts match the text summary line', async () => {
    const text = await runGate(evil.dir, evil.state, '11 text', ['--no-cache'])
    const json = await runGate(evil.dir, evil.state, '11 --json', ['--no-cache', '--json'])
    const doc = JSON.parse(json.stdout.slice(json.stdout.indexOf('{')))
    const line = firstGateLine(text)
    expect(json.code).toBe(text.code)
    expect(doc.exitCode).toBe(json.code)
    expect(doc.blocking).toBe(blockingOf(line))
    expect(doc.preExisting).toBe(preOf(line))
    expect(doc.rows.filter((x: { kind: string }) => x.kind === 'pass').length).toBe(Number(/(\d+) passed/.exec(line)?.[1]))
  })

  it('12. two gate runs at once on the same repo both finish with the same findings', async () => {
    const [a, b] = await Promise.all([
      runGate(evil.dir, evil.state, '12 concurrent A', ['--no-cache', '--full']),
      runGate(evil.dir, evil.state, '12 concurrent B', ['--no-cache', '--full']),
    ])
    expect(a.code).not.toBe(null)
    expect(b.code).not.toBe(null)
    expect(a.code).toBe(1)
    expect(b.code).toBe(a.code)
    expect(blockingOf(firstGateLine(b))).toBe(blockingOf(firstGateLine(a)))
    expect(findingsLines(b)).toBe(findingsLines(a))
  })
})
