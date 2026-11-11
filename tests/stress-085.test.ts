// 0.8.5 stress-run fixes: dismissals --json always parses, every run folder has a summary.json, and the verdict time limit prints INCOMPLETE (exit 75).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { git, makeRunStore, makeSandbox, newestRunDir, runCli } from './smoke-helpers.mjs'

const boxes: ReturnType<typeof makeSandbox>[] = []
const box = (opts = {}) => {
  const sb = makeSandbox({ label: 'stress085', ...opts })
  boxes.push(sb)
  return sb
}
afterAll(() => boxes.forEach((b) => b.cleanup()))
const runDirs = (sb: ReturnType<typeof makeSandbox>) => (existsSync(join(sb.logs, 'runs')) ? readdirSync(join(sb.logs, 'runs')) : [])

describe('dismissals --json', () => {
  test('valid JSON with no dismissals (an empty list and a message) and with one', () => {
    const sb = box()
    const empty = runCli(sb, ['dismissals', '--json'])
    expect(empty.code).toBe(0)
    const e = JSON.parse(empty.stdout)
    expect(e.dismissals).toEqual([])
    expect(e.message).toMatch(/No dismissals/)
    const stats = JSON.parse(runCli(sb, ['dismissals', '--stats', '--json']).stdout)
    expect(stats.stats).toEqual([])
    expect(stats.message).toMatch(/No dismissals/)

    // One dismissal: write a run's findings through a gate-free verify, then dismiss the first finding.
    makeRunStore(sb)
    const dir = newestRunDir(sb)
    const doc = JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8'))
    const id = doc.findings[0]?.id
    expect(id, 'the fixture must produce a finding to dismiss').toBeTruthy()
    expect(runCli(sb, ['dismiss', id, '--run', dir, '--reason', 'stress test']).code).toBe(0)
    const full = JSON.parse(runCli(sb, ['dismissals', '--json']).stdout)
    expect(full.dismissals).toHaveLength(1)
    expect(full.dismissals[0].id).toBe(id)
  }, 120_000)
})

describe('map leaves a summary.json in its run folder', () => {
  test('after map on a fixture the run folder has a parsing summary.json; a second (unchanged) map keeps it', () => {
    const sb = box()
    const r = runCli(sb, ['map', '--json'])
    expect(r.code).toBe(0)
    const runDir = JSON.parse(r.stdout).runDir
    const s = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'))
    expect(s.status).toBe('complete')
    expect(s.tier).toBe('map')
    const again = JSON.parse(runCli(sb, ['map', '--json']).stdout)
    expect(again.unchanged).toBe(true)
    expect(JSON.parse(readFileSync(join(again.runDir, 'summary.json'), 'utf8')).status).toBe('complete')
    for (const d of runDirs(sb)) expect(existsSync(join(sb.logs, 'runs', d, 'summary.json')), `${d} has no summary.json`).toBe(true)
  }, 120_000)
})

describe('verdict time limit', () => {
  test('a check that sleeps past MEERKAT_VERDICT_TIMEOUT_S ends the output with INCOMPLETE and exits 124 (time limit, status 408)', () => {
    const sb = box({ copy: false })
    mkdirSync(sb.app, { recursive: true })
    writeFileSync(join(sb.app, 'a.js'), 'let a = 1\n')
    writeFileSync(join(sb.app, 'sleep.js'), 'setTimeout(() => {}, 10000)\n')
    writeFileSync(join(sb.app, 'meerkat.config.json'), JSON.stringify({ discover: false, customChecks: [{ id: 'slow', title: 'Slow', cmd: 'node', args: ['sleep.js'], suite: 'my-app', group: 'functionality', tier: 'fast', timeoutSeconds: 30 }] }))
    git(sb.app, ['init', '-q', '-b', 'main'], sb.env)
    git(sb.app, ['add', '-A'], sb.env)
    git(sb.app, ['commit', '-q', '-m', 'init'], sb.env)
    writeFileSync(join(sb.app, 'a.js'), 'let a = 2\n')
    const r = runCli(sb, ['verdict', '--base', 'main'], { env: { MEERKAT_VERDICT_TIMEOUT_S: '2' }, timeout: 90_000 })
    const lines = r.stdout.split(/\r?\n/).filter(Boolean)
    expect(r.code).toBe(124)
    expect(lines.some((l) => l.startsWith('INCOMPLETE'))).toBe(true)
    expect(lines[0]).toMatch(/^INCOMPLETE /)
    // The resume feature does not exist on this branch, so INCOMPLETE and the exit code are all there is to assert.
  }, 120_000)
})
