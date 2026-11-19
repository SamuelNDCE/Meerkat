// docs/issues.md sections 18 and 19: a status on every done line, one set of counts from the same rows, one blocking-so-far count,
// base-only / branch-only / both on every failing check, and no FAIL text in the progress stream before the answer.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runBatch, sideOf } from '../lib/batch.mjs'
import { countsLine, gateCounts, gateProgress, withBlocking } from '../lib/gate.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-r1819-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home'), MEERKAT_PLAIN: '1', MEERKAT_GATE_HEARTBEAT_MS: '300' } as NodeJS.ProcessEnv

// 18c
describe('18c: every done line carries a status', () => {
  test('a check that returns no status prints NOT RUN with a reason on its done line', () => {
    const lines: string[] = []
    const p = gateProgress(1, (l: string) => lines.push(l), 0)
    p.hooks.start({ id: 'cyclomatic' })
    p.hooks.settle({ id: 'cyclomatic' }, {}, 13400)
    p.stop()
    const done = lines.find((l) => l.startsWith('[done'))!
    expect(done).toMatch(/^\[done 1\/1\] cyclomatic \.\.\. 13\.4s NOT RUN \(.+\)$/)
  })
  test('a PASS done line says PASS', () => {
    const lines: string[] = []
    const p = gateProgress(1, (l: string) => lines.push(l), 0)
    p.hooks.start({ id: 'ok' })
    p.hooks.settle({ id: 'ok' }, { status: 'PASS' }, 1000)
    p.stop()
    expect(lines.find((l) => l.startsWith('[done'))).toMatch(/ok \.\.\. 1\.0s PASS$/)
  })
  test('a NOT RUN result keeps its own reason', () => {
    const lines: string[] = []
    const p = gateProgress(1, (l: string) => lines.push(l), 0)
    p.hooks.start({ id: 'x' })
    p.hooks.settle({ id: 'x' }, { status: 'NOT RUN', detail: 'tool missing' }, 100)
    p.stop()
    expect(lines.find((l) => l.startsWith('[done'))).toMatch(/NOT RUN \(tool missing\)$/)
  })
})

// 19d / 19e
describe('19d and 19e: one count, from the same rows as the list, and a blocking flag on each row', () => {
  const rows = [
    { id: 'a', kind: 'fail', places: [{ file: 'x.js', line: 1 }] },
    { id: 'b', kind: 'wide' },
    { id: 'c', kind: 'wide' },
    { id: 'd', kind: 'pass' },
    { id: 'e', kind: 'notrun' },
    { id: 'f', kind: 'skipped' },
  ]
  test('3 fail rows of which 1 is blocking print "3 failed, 1 blocking"', () => {
    expect(gateCounts(rows)).toMatchObject({ failed: 3, blocking: 1, notRun: 1, notConfigured: 1 })
    expect(countsLine(rows)).toBe('gate: 6 check(s), 3 failed, 1 blocking, 1 not run, 1 not configured')
  })
  test('each row carries a blocking boolean, true only for a fail that is not pre-existing', () => {
    const marked = withBlocking(rows)
    expect(marked.map((r: any) => [r.id, r.blocking])).toEqual([['a', true], ['b', false], ['c', false], ['d', false], ['e', false], ['f', false]])
    expect(marked.filter((r: any) => r.blocking).length).toBe(gateCounts(rows).blocking)
  })
  test('a fail whose base comparison did not finish is not blocking, the same rule the verdict uses', () => {
    expect(withBlocking(rows, 'unfinished').filter((r: any) => r.blocking).length).toBe(0)
  })
  test('a real gate: summary.json rows have blocking, and its summary line agrees with them', () => {
    const d = join(root, 'cnt')
    mkdirSync(d, { recursive: true })
    git(d, 'init', '-q', '-b', 'main')
    put(d, 'package.json', '{"name":"fx","version":"1.0.0","private":true}')
    put(d, 'a.js', 'export const a = 1\n')
    put(d, 'bad.js', "console.log('a.js:1: problem')\nprocess.exit(1)\n")
    put(d, 'meerkat.config.json', JSON.stringify({ packs: [], discover: false, customChecks: [{ id: 'bad', title: 'Bad', cmd: 'node', args: ['bad.js'], tier: 'fast' }, { id: 'good', title: 'Good', cmd: 'node', args: ['-e', '0'], tier: 'fast' }] }))
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'base')
    git(d, 'checkout', '-q', '-b', 'feat')
    put(d, 'a.js', 'export const a = 2\n')
    const logs = join(root, 'cnt-logs')
    const r = spawnSync(process.execPath, [bin, 'gate', '--no-cache', '--no-input'], { cwd: d, env: { ...env, MEERKAT_LOG_DIR: logs }, encoding: 'utf8', timeout: 120_000 })
    const found: string[] = []
    const walk = (p: string) => {
      for (const n of readdirSync(p)) {
        const f = join(p, n)
        if (statSync(f).isDirectory()) walk(f)
        else if (n === 'summary.json') found.push(f)
      }
    }
    walk(logs)
    expect(found.length, String(r.stderr)).toBe(1)
    const doc = JSON.parse(readFileSync(found[0], 'utf8'))
    for (const row of doc.results) expect(typeof row.blocking, JSON.stringify(row)).toBe('boolean')
    const failed = doc.results.filter((x: any) => x.status === 'FAIL').length
    const blocking = doc.results.filter((x: any) => x.blocking).length
    expect(failed).toBeGreaterThan(0)
    expect(doc.summary).toContain(`${failed} failed, ${blocking} blocking`)
    expect(doc.counts.fail).toBe(failed)
  }, 150_000)
})

// 19a
describe('19a: a run stopped early states one blocking count on every line', () => {
  test('the stderr "stopped early" line and the verdict line say the same number', () => {
    const d = join(root, 'stop')
    mkdirSync(d, { recursive: true })
    git(d, 'init', '-q', '-b', 'main')
    put(d, 'package.json', '{"name":"fx","version":"1.0.0","private":true}')
    put(d, 'a.js', 'export const a = 1\n')
    put(d, 'bad.js', "console.log('a.js:1: problem')\nprocess.exit(1)\n")
    put(d, 'nap.js', 'setTimeout(() => {}, 120000)\n')
    put(d, 'meerkat.config.json', JSON.stringify({ packs: [], discover: false, customChecks: [{ id: 'bad', title: 'Bad', cmd: 'node', args: ['bad.js'], tier: 'fast' }, { id: 'nap', title: 'Nap', cmd: 'node', args: ['nap.js'], tier: 'fast', timeoutSeconds: 120 }] }))
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'base')
    git(d, 'checkout', '-q', '-b', 'feat')
    put(d, 'a.js', 'export const a = 2\n')
    git(d, 'add', '-A')
    git(d, 'commit', '-q', '-m', 'change')
    const r = spawnSync(process.execPath, [bin, 'verdict', '--base', 'main', '--no-input', '--max-seconds', '4'], { cwd: d, env: { ...env, MEERKAT_LOG_DIR: join(root, 'stop-logs'), MEERKAT_VERDICT_TIMEOUT_S: '60' }, encoding: 'utf8', timeout: 150_000 })
    const all = `${r.stderr}\n${r.stdout}`
    const nums = [...all.matchAll(/(\d+) blocking so far/g)].map((m) => Number(m[1]))
    expect(nums.length, all).toBeGreaterThanOrEqual(2)
    expect(new Set(nums).size, all).toBe(1)
  }, 180_000)
})

// 18a / 19b / 18b
describe('18a and 19b: base-only, branch-only or both on every failing check', () => {
  test('sideOf names all three', () => {
    expect(sideOf(true, true)).toBe('both')
    expect(sideOf(true, false)).toBe('branch-only')
    expect(sideOf(false, true)).toBe('base-only')
    expect(sideOf(true, null)).toBe(null)
  })
})

describe('batch result and output', () => {
  const names = ['b01', 'b02']
  let dir = ''
  beforeAll(() => {
    dir = join(root, 'brepo')
    mkdirSync(dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    put(dir, 'src/base.js', 'export const base = 1\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'base')
    for (const n of names) {
      git(dir, 'checkout', '-q', '-b', n, 'main')
      put(dir, `src/${n}.js`, `export const ${n} = 1\n`)
      git(dir, 'add', '-A')
      git(dir, 'commit', '-q', '-m', n)
      git(dir, 'checkout', '-q', 'main')
    }
  })
  // both-check fails whenever a branch is present (and on the base); branch-check fails only when b01 is present (not on the base).
  const gate = async (checkout: string) => {
    const b01 = existsSync(join(checkout, 'src', 'b01.js'))
    const checks = [{ check: 'both-check', status: 'fail', places: [], detail: 'old problem' }, ...(b01 ? [{ check: 'branch-check', status: 'fail', places: [], detail: 'new problem' }] : [])]
    return { code: 1, verdict: 'FAIL', reason: 'FAIL', checks }
  }
  const devBaseline = async (_r: string, _b: string, id: string) => id === 'both-check'
  const run = async () => {
    const stream: string[] = []
    const outLines: string[] = []
    const code = await runBatch(['--base', 'main', '--app', dir, ...names], { env: { ...env, MEERKAT_LOG_DIR: join(root, 'blogs') }, cwd: dir, out: (t: string) => (outLines.push(t), stream.push(t)), err: (t: string) => stream.push(t), gate, devBaseline })
    return { code, stream, outLines }
  }
  test('the result file records id, reason and side for each failing check', async () => {
    const r = await run()
    const doc = JSON.parse(readFileSync(/result (.+)$/.exec(r.outLines[r.outLines.length - 1])![1], 'utf8'))
    const byId = Object.fromEntries(doc.failingChecks.map((f: any) => [f.id, f]))
    expect(byId['both-check']).toMatchObject({ id: 'both-check', side: 'both' })
    expect(byId['both-check'].reason).toContain('old problem')
    expect(byId['branch-check']).toMatchObject({ id: 'branch-check', side: 'branch-only' })
    const b01 = doc.prs.find((p: any) => p.branch === 'b01')
    expect(b01.failingChecks.map((f: any) => [f.id, f.side]).sort()).toEqual([['both-check', 'both'], ['branch-check', 'branch-only']])
    // 18f: the first line still names the failing check
    expect(r.outLines[0]).toContain('branch-check')
  }, 120_000)
  test('18b: FAIL lines are printed once, after the answer line, never in the stream before it', async () => {
    const r = await run()
    const firstAnswer = r.stream.indexOf(r.outLines[0])
    const failIdx = r.stream.map((l, i) => (/\bFAIL\b/.test(l) ? i : -1)).filter((i) => i >= 0)
    expect(failIdx.length).toBeGreaterThan(0)
    expect(Math.min(...failIdx)).toBeGreaterThan(firstAnswer)
    expect(r.outLines.filter((l) => /^FAIL both-check \[both\]/.test(l)).length).toBe(1)
    expect(r.outLines.filter((l) => /^FAIL branch-check \[branch-only\]/.test(l)).length).toBe(1)
  }, 120_000)
  test('18b: a failing check done line in the progress stream has no FAIL text', () => {
    const lines: string[] = []
    const p = gateProgress(1, (l: string) => lines.push(l), 0)
    p.hooks.start({ id: 'risky-code' })
    p.hooks.settle({ id: 'risky-code' }, { status: 'FAIL', detail: 'x' }, 2000)
    p.stop()
    expect(lines.join('\n')).not.toMatch(/FAIL/)
    expect(lines.find((l) => l.startsWith('[done'))).toMatch(/risky-code \.\.\. 2\.0s \S+/)
  })
})
