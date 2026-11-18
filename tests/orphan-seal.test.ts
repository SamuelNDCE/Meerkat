// Sealing run folders whose process ended without writing a summary. Every test uses a temp run store, never the real one.
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { sealOrphans, REASON } from '../lib/orphanseal.mjs'

let root: string
let env: Record<string, string>
const NOW = Date.now()
const MIN = 60 * 1000

function mkRun(name: string, files: Record<string, string>, ageMs = 60 * MIN) {
  const dir = join(root, 'runs', name)
  mkdirSync(dir, { recursive: true })
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t)
  const when = new Date(NOW - ageMs)
  for (const f of Object.keys(files)) utimesSync(join(dir, f), when, when)
  utimesSync(dir, when, when)
  return dir
}
const deadPid = 2 ** 22 + 12345 // far above any real pid on a test machine
const summaryOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mk-orphan-'))
  mkdirSync(join(root, 'runs'), { recursive: true })
  env = { MEERKAT_LOG_DIR: root }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('sealOrphans', () => {
  test('an orphan folder gets an incomplete summary with the reason and the finished check count', () => {
    const dir = mkRun('20261101-100000-demo-abc123--gate', { 'run.json': JSON.stringify({ pid: deadPid }), 'a.log': 'x', 'b.log': 'y', 'changed-files.txt': 'f' })
    const r = sealOrphans(env, { now: NOW })
    expect(r.sealed).toBe(1)
    const s = summaryOf(dir)
    expect(s.status).toBe('incomplete')
    expect(s.exitCode).toBe(143)
    expect(s.reason).toBe('the process ended without sealing its record (killed from outside or crashed; cause unknown)')
    expect(REASON).toBe(s.reason)
    expect(s.checksFinished).toBe(2)
  })
  test('a folder with no run.json and no progress.json but check logs is sealed too', () => {
    const dir = mkRun('20261101-100000-demo-abc123--gate', { 'a.log': 'x' })
    expect(sealOrphans(env, { now: NOW }).sealed).toBe(1)
    expect(summaryOf(dir).checksFinished).toBe(1)
  })
  test('a folder with nothing that looks like a run is left alone', () => {
    const dir = mkRun('notes', { 'readme.txt': 'hi' })
    expect(sealOrphans(env, { now: NOW }).sealed).toBe(0)
    expect(existsSync(join(dir, 'summary.json'))).toBe(false)
  })
  test('a live run (this process) is not touched', () => {
    const dir = mkRun('20261101-100000-demo-abc123--gate', { 'run.json': JSON.stringify({ pid: process.pid }), 'a.log': 'x' })
    expect(sealOrphans(env, { now: NOW }).sealed).toBe(0)
    expect(existsSync(join(dir, 'summary.json'))).toBe(false)
  })
  test('a fresh folder is not touched', () => {
    const dir = mkRun('20261101-100000-demo-abc123--gate', { 'run.json': JSON.stringify({ pid: deadPid }), 'a.log': 'x' }, 2 * MIN)
    expect(sealOrphans(env, { now: NOW }).sealed).toBe(0)
    expect(existsSync(join(dir, 'summary.json'))).toBe(false)
  })
  test('a fresh progress.json protects the folder', () => {
    const dir = mkRun('20261101-100000-demo-abc123--gate', { 'run.json': JSON.stringify({ pid: deadPid }), 'a.log': 'x' })
    writeFileSync(join(dir, 'progress.json'), '{"state":"running"}')
    expect(sealOrphans(env, { now: NOW }).sealed).toBe(0)
  })
  test('a complete folder is not touched', () => {
    const dir = mkRun('20261101-100000-demo-abc123--gate', { 'summary.json': '{"status":"complete"}', 'a.log': 'x' })
    expect(sealOrphans(env, { now: NOW }).sealed).toBe(0)
    expect(readFileSync(join(dir, 'summary.json'), 'utf8')).toBe('{"status":"complete"}')
  })
  test('sealing twice is harmless', () => {
    const dir = mkRun('20261101-100000-demo-abc123--gate', { 'run.json': JSON.stringify({ pid: deadPid }), 'a.log': 'x' })
    expect(sealOrphans(env, { now: NOW }).sealed).toBe(1)
    const first = readFileSync(join(dir, 'summary.json'), 'utf8')
    expect(sealOrphans(env, { now: NOW }).sealed).toBe(0)
    expect(readFileSync(join(dir, 'summary.json'), 'utf8')).toBe(first)
  })
  test('a missing run store is fine', () => {
    expect(sealOrphans({ MEERKAT_LOG_DIR: join(root, 'nope') }, { now: NOW }).sealed).toBe(0)
  })
})
