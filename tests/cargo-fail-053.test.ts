// A cargo test failure is a failing check named by its test, not a crash (the NeuralVault agents-page case).
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { classify } from '../lib/gate.mjs'

describe('cargo test output', () => {
  test('a test that failed is fail, even when it panicked', () => {
    const out = "test a::b ... FAILED\n  thread 'a::b' panicked at src/x.rs:1020:5:\ntest result: FAILED. 3208 passed; 1 failed;"
    expect(classify({ status: 'FAIL', exitCode: 101 }, out)).toBe('fail')
  })
  test('a runner crash with no test summary is still a crash', () => {
    expect(classify({ status: 'FAIL', exitCode: 101 }, "thread 'main' panicked at src/main.rs:3:5")).toBe('crash')
  })
})

describe('a failed test always blocks', () => {
  test('a failing test whose panic points outside the diff is not wide', async () => {
    // @ts-expect-error plain .mjs module
    const { scopeToChanged } = await import('../lib/gate.mjs')
    const rows = [{ id: 'rust-test', kind: 'fail', detail: 'test failed: a::b', files: ['apps/nv-sidecar/src/x.rs'], places: [{ file: 'apps/nv-sidecar/src/x.rs', line: 1 }] }]
    scopeToChanged(rows, new Set(['src/other.js']))
    expect(rows[0].kind).toBe('fail')
  })
})

// End to end: the real verdict on a fixture whose test check prints cargo's failure summary, exits 101, and panics at a file outside the diff.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll } from 'vitest'

const e2eMade: string[] = []
afterAll(() => { for (const d of e2eMade) rmSync(d, { recursive: true, force: true }) })

describe('verdict end to end: a failing cargo-style test blocks', () => {
  test('FAIL, exit 1, the rust-test row is fail with the test name', () => {
    const root = mkdtempSync(join(tmpdir(), 'meerkat-cargo-e2e-')); e2eMade.push(root)
    const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' })
    writeFileSync(join(root, 'package.json'), '{"name":"x","version":"1.0.0","private":true}')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1\n')
    writeFileSync(join(root, 'fake-test.js'),
      "console.log('test tool_loop::smoke ... FAILED')\nconsole.log(\"thread 'tool_loop::smoke' panicked at other/x.rs:1020:5:\")\nconsole.log('test result: FAILED. 3208 passed; 1 failed; 0 ignored')\nprocess.exit(101)\n")
    writeFileSync(join(root, 'meerkat.config.json'), JSON.stringify({ packs: [], discover: false, customChecks: [
      { id: 'fake-rust-test', title: 'Fake rust test', cmd: 'node', args: ['fake-test.js'], tier: 'fast', paths: ['src/**'] },
    ] }))
    git('init', '-q', '-b', 'main')
    git('add', '-A')
    git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'base')
    git('checkout', '-q', '-b', 'feat')
    writeFileSync(join(root, 'src', 'a.js'), 'export const a = 2\n')
    git('add', '-A')
    git('-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'change')
    const cli = resolve(__dirname, '..', 'bin', 'meerkat.mjs')
    const r = spawnSync(process.execPath, [cli, 'verdict', '--base', 'main', '--app', root, '--allow-stale', '--json'], { encoding: 'utf8', env: { ...process.env, MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_CACHE_OFF: '1' } })
    const doc = JSON.parse(r.stdout)
    expect(r.status).toBe(1)
    expect(doc.verdict).toBe('FAIL')
    expect(doc.blocking).toBeGreaterThan(0)
    const row = doc.checks.find((c: { check: string }) => c.check === 'fake-rust-test')
    expect(row.status).toBe('fail')
    expect(row.detail).toMatch(/test failed: tool_loop::smoke/)
  }, 120000)
})
