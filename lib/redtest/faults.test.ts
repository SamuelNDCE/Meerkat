// Kind 2, fault injection: break the environment or a check on purpose. Meerkat must name each break as a tool failure or NOT RUN (never a silent pass,
// never a crash of the whole run) and keep running the other checks.
import { chmodSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { cleanup, makeProject, meerkat, statusOf, tinyNodeFiles } from './harness.mjs'

vi.setConfig({ testTimeout: 180_000 })
afterAll(cleanup)

const CHECKS = `import { readFileSync } from 'node:fs'
export default [
  { id: 'rt-ok', group: 'functionality', tier: 'fast', lane: 'free', title: 'healthy sibling', estSeconds: 1, run: { cmd: 'node', args: ['-e', 'process.exit(0)'], cwd: 'app' } },
  { id: 'rt-throws', group: 'functionality', tier: 'fast', lane: 'free', title: 'a check that throws', estSeconds: 1, run: () => { throw new Error('redtest boom') } },
  { id: 'rt-hangs', group: 'functionality', tier: 'fast', lane: 'free', title: 'a check that never returns', estSeconds: 1, timeoutSeconds: 4, run: { cmd: 'node', args: ['-e', 'setInterval(() => {}, 1000)'], cwd: 'app' } },
  { id: 'rt-missing-bin', group: 'functionality', tier: 'fast', lane: 'free', title: 'needs a program that is not installed', estSeconds: 1, needs: ['redtest-no-such-binary'], install: 'install redtest-no-such-binary', run: { cmd: 'redtest-no-such-binary', args: [], cwd: 'app' } },
  { id: 'rt-bad-cmd', group: 'functionality', tier: 'fast', lane: 'free', title: 'command that does not exist (no needs list)', estSeconds: 1, run: { cmd: 'redtest-no-such-command', args: [], cwd: 'app' } },
  { id: 'rt-deletes', group: 'functionality', tier: 'fast', lane: 'free', title: 'removes a tracked file', estSeconds: 1, run: { cmd: 'node', args: ['-e', "require('fs').unlinkSync('src/index.js')"], cwd: 'app' } },
  { id: 'rt-reads-gone', group: 'functionality', tier: 'fast', lane: 'free', title: 'reads the file the previous check removed', estSeconds: 1, after: ['rt-deletes'], run: (ctx) => { readFileSync(ctx.appDir + '/src/index.js', 'utf8'); return { ok: true, detail: 'read it' } } },
]
`

function faultProject() {
  return makeProject({
    ...tinyNodeFiles(),
    'meerkat.config.json': JSON.stringify({ packs: [], discover: false, extraChecks: ['.redchecks'] }),
    '.redchecks/faults.mjs': CHECKS,
  })
}

describe('fault injection', () => {
  const dir = faultProject()
  const run = meerkat(dir, ['--preset', 'quick', '--only', 'rt-ok,rt-throws,rt-hangs,rt-missing-bin,rt-bad-cmd,rt-deletes,rt-reads-gone', '--all'], { timeoutMs: 150_000 })
  const row = (id: string) => run.results.find((r: any) => r.id === id)

  test('the run finishes, saves its report and exits non-zero (nothing is hidden)', () => {
    expect(run.timedOut).toBe(false)
    expect(run.summary, run.out.slice(-2000)).not.toBeNull()
    expect(run.code).toBe(1)
    expect(run.results.length).toBe(7)
  })

  test('a check that throws is a FAIL that carries the error, and the others still run', () => {
    expect(row('rt-throws')?.status, run.out.slice(-1500)).toBe('FAIL')
    expect(String(row('rt-throws')?.detail)).toMatch(/boom|throw|error/i)
    expect(statusOf(run, 'rt-ok')).toBe('PASS')
  })

  test('a check that never returns is stopped at its limit and reported, not waited for', () => {
    expect(['FAIL', 'NOT RUN']).toContain(row('rt-hangs')?.status)
    expect(String(row('rt-hangs')?.detail)).toMatch(/time|limit|took longer|seconds/i)
    expect(run.ms).toBeLessThan(120_000)
  })

  test('a missing program is NOT RUN and names the program and how to install it', () => {
    expect(row('rt-missing-bin')?.status).toBe('NOT RUN')
    expect(String(row('rt-missing-bin')?.detail)).toContain('redtest-no-such-binary')
  })

  test('a command that cannot start is reported, never a PASS', () => {
    expect(['FAIL', 'NOT RUN']).toContain(row('rt-bad-cmd')?.status)
    expect(String(row('rt-bad-cmd')?.detail).length).toBeGreaterThan(0)
  })

  test('a file that disappears mid-run is a reported failure of the check that needed it', () => {
    expect(row('rt-deletes')?.status).toBe('PASS')
    expect(row('rt-reads-gone')?.status).toBe('FAIL')
    expect(String(row('rt-reads-gone')?.detail)).toMatch(/ENOENT|no such file|not found|cannot/i)
  })
})

describe('fault injection: folder state', () => {
  test('a tracked file deleted from disk before the run: the bundled file readers do not crash the run', () => {
    const dir = makeProject(tinyNodeFiles())
    unlinkSync(join(dir, 'src', 'index.js'))
    const run = meerkat(dir, ['--preset', 'quick', '--only', 'secret-scan,whitespace,json-valid', '--all'], { timeoutMs: 150_000 })
    expect(run.summary, run.out.slice(-1500)).not.toBeNull()
    expect(run.out).not.toMatch(/TypeError|Unhandled|at .*\.mjs:\d+/)
    expect(run.results.length).toBeGreaterThan(0)
  })

  test('a read-only project folder: the run still finishes and writes its logs elsewhere', () => {
    const dir = makeProject(tinyNodeFiles())
    for (const f of ['package.json', 'README.md', 'src/index.js']) chmodSync(join(dir, f), 0o444)
    chmodSync(dir, 0o555)
    // Whether the OS really refuses the write differs (Windows ignores folder modes); the test records it and holds either way.
    let enforced = false
    try {
      writeFileSync(join(dir, 'probe.txt'), 'x')
    } catch {
      enforced = true
    }
    try {
      const run = meerkat(dir, ['--preset', 'quick', '--only', 'secret-scan', '--all'], { timeoutMs: 150_000 })
      expect(run.summary, `write refused: ${enforced}\n${run.out.slice(-1500)}`).not.toBeNull()
      expect(run.out).not.toMatch(/EACCES|EPERM[\s\S]*at /)
      expect([0, 1]).toContain(run.code)
    } finally {
      chmodSync(dir, 0o755)
    }
  })

  test('an unwritable log folder is reported, not a crash', () => {
    const dir = makeProject(tinyNodeFiles())
    // The log root is a FILE, so no run folder can be made under it.
    const blocker = join(dir, '..', 'not-a-folder')
    writeFileSync(blocker, 'x')
    const run = meerkat(dir, ['--preset', 'quick', '--only', 'secret-scan', '--all'], { env: { MEERKAT_LOG_DIR: blocker }, timeoutMs: 150_000 })
    expect(run.out).not.toMatch(/\n\s+at .*\.mjs:\d+/)
    expect(run.code, run.out.slice(-1500)).not.toBeNull()
  })
})
