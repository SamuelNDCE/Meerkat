// meerkat runs prune: retention for the per-user run store. Every test uses a temp store, never the real one.
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { pruneRuns, pruneText } from '../lib/runsprune.mjs'

let root: string
let env: Record<string, string>
const DAY = 24 * 3600 * 1000
const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime()

const pad = (n: number) => String(n).padStart(2, '0')
const stampOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` }

// A finished run folder `daysOld` days old for project `proj`.
function mkRun(daysOld: number, proj = 'demo-abc123', files: Record<string, string> = { 'summary.json': '{"schema":1}', 'x.log': 'hello' }) {
  const name = `${stampOf(NOW - daysOld * DAY)}-${proj}--fast`
  const dir = join(root, 'runs', name)
  mkdirSync(dir, { recursive: true })
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t)
  return { name, dir }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mk-prune-'))
  mkdirSync(join(root, 'runs'), { recursive: true })
  env = { MEERKAT_LOG_DIR: root }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('runs prune', () => {
  test('old folders are listed and a dry run deletes nothing', () => {
    const a = mkRun(40)
    const b = mkRun(30)
    const r = pruneRuns(env, { keep: 0, olderThanDays: 14, yes: false, now: NOW })
    expect(r.dryRun).toBe(true)
    expect(r.candidates.map((c: any) => c.name).sort()).toEqual([a.name, b.name].sort())
    expect(r.bytes).toBeGreaterThan(0)
    expect(existsSync(a.dir)).toBe(true)
    expect(pruneText(r).split('\n')[0]).toMatch(/^runs prune: 2 run folder\(s\) would go, 0 kept, .* MB, dry run \(add --yes to delete\)$/)
  })

  test('--yes deletes the listed folders', () => {
    const a = mkRun(40)
    const fresh = mkRun(1)
    const r = pruneRuns(env, { keep: 0, olderThanDays: 14, yes: true, now: NOW })
    expect(r.dryRun).toBe(false)
    expect(existsSync(a.dir)).toBe(false)
    expect(existsSync(fresh.dir)).toBe(true)
  })

  test('a run whose run.json pid is alive is kept', () => {
    const live = mkRun(60, 'demo-abc123', { 'run.json': JSON.stringify({ pid: process.pid }) })
    const dead = mkRun(61, 'demo-abc123', { 'run.json': JSON.stringify({ pid: 2147483000 }), 'summary.json': '{}' })
    const r = pruneRuns(env, { keep: 0, olderThanDays: 14, yes: true, now: NOW })
    expect(existsSync(live.dir)).toBe(true)
    expect(existsSync(dead.dir)).toBe(false)
    expect(r.candidates.map((c: any) => c.name)).not.toContain(live.name)
  })

  test('a folder with no summary.json and no run.json is not a run and is kept', () => {
    const odd = mkRun(90, 'demo-abc123', { 'notes.txt': 'mine' })
    pruneRuns(env, { keep: 0, olderThanDays: 14, yes: true, now: NOW })
    expect(existsSync(odd.dir)).toBe(true)
  })

  test('--keep keeps the newest n per project, even when they are old', () => {
    const a = [mkRun(20), mkRun(30), mkRun(40)]
    const other = mkRun(50, 'other-def456')
    pruneRuns(env, { keep: 2, olderThanDays: 14, yes: true, now: NOW })
    expect(existsSync(a[0].dir)).toBe(true)
    expect(existsSync(a[1].dir)).toBe(true)
    expect(existsSync(a[2].dir)).toBe(false)
    expect(existsSync(other.dir)).toBe(true) // the newest (only) run of its project
  })

  test('anything newer than --older-than days is kept even past --keep', () => {
    const a = [mkRun(1), mkRun(2), mkRun(3), mkRun(60)]
    pruneRuns(env, { keep: 1, olderThanDays: 14, yes: true, now: NOW })
    expect(existsSync(a[1].dir)).toBe(true)
    expect(existsSync(a[2].dir)).toBe(true)
    expect(existsSync(a[3].dir)).toBe(false)
  })

  test('a resumable run and the run latest.json names are kept', () => {
    const res = mkRun(60, 'demo-abc123', { 'summary.json': '{}', 'resume.json': '{}' })
    const ptr = mkRun(61)
    const gone = mkRun(62)
    writeFileSync(join(root, 'latest.json'), JSON.stringify({ dir: ptr.dir.replaceAll(String.fromCharCode(92), '/') }))
    pruneRuns(env, { keep: 0, olderThanDays: 14, yes: true, now: NOW })
    expect(existsSync(res.dir)).toBe(true)
    expect(existsSync(ptr.dir)).toBe(true)
    expect(existsSync(gone.dir)).toBe(false)
  })

  test('a run whose progress.json says running a moment ago is kept', () => {
    const run = mkRun(60, 'demo-abc123', { 'summary.json': '{}', 'progress.json': '{"state":"running"}' })
    pruneRuns(env, { keep: 0, olderThanDays: 14, yes: true, now: Date.now() + 0 })
    expect(existsSync(run.dir)).toBe(true)
  })
})
