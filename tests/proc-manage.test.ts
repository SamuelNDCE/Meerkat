// meerkat ps (live runs) and meerkat stop <run id>. Fake run folders in a temp log folder, and spawned temp sleepers; no real run is ever touched.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { listLiveRuns, psRuns, stopRun } from '../lib/procmanage.mjs'

const ROOT = join(__dirname, '..')
const BIN = join(ROOT, 'bin', 'meerkat.mjs')
const root = mkdtempSync(join(tmpdir(), 'meerkat-procmanage-'))
const logs = join(root, 'logs')
const env = { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_HOME: join(root, 'mhome'), CI: '1', NO_COLOR: '1' }
const runsDir = join(logs, 'runs')

let n = 0
function fakeRun(pid: number, { summary = false, kind = 'gate', progress = null as null | object, runId = '' } = {}) {
  const id = runId || `20261118-10000${n++}-demo-aaaaaa-fast--${kind}`
  const dir = join(runsDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId: id, kind, pid, startedAt: new Date(Date.now() - 65000).toISOString() }))
  if (summary) writeFileSync(join(dir, 'summary.json'), JSON.stringify({ schema: 1, status: 'complete' }))
  if (progress) writeFileSync(join(dir, 'progress.json'), JSON.stringify(progress))
  return id
}

const sleepers: ReturnType<typeof spawn>[] = []
const sleeper = (cmd = process.execPath, args = ['-e', 'setInterval(()=>{},1000)']) => {
  const c = spawn(cmd, args, { stdio: 'ignore', windowsHide: true })
  sleepers.push(c)
  return c
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e?.code === 'EPERM'
  }
}
const waitDead = async (pid: number, ms = 8000) => {
  const end = Date.now() + ms
  while (alive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
  return !alive(pid)
}

afterEach(() => rmSync(runsDir, { recursive: true, force: true }))
afterAll(() => {
  for (const c of sleepers) try { c.kill() } catch { /* gone */ }
  rmSync(root, { recursive: true, force: true })
})

describe('meerkat ps: live runs', () => {
  test('(a) a run folder with a live pid and no summary.json is listed', () => {
    const id = fakeRun(process.pid, { progress: { state: 'running', running: [{ id: 'eslint', sinceSeconds: 12 }] } })
    const r = listLiveRuns({ env })
    expect(r.live.map((x: any) => x.runId)).toEqual([id])
    expect(r.live[0]).toMatchObject({ pid: process.pid, kind: 'gate', currentCheck: 'eslint' })
    const text = psRuns([], { env }).text
    expect(text).toContain(id)
    expect(text).toContain('eslint')
    const json = JSON.parse(psRuns(['--json'], { env }).text)
    expect(json.runs[0]).toMatchObject({ runId: id, pid: process.pid, kind: 'gate', currentCheck: 'eslint' })
  })
  test('(b) a finished run, or one whose pid is dead, is not listed and is counted as skipped', () => {
    fakeRun(process.pid, { summary: true })
    fakeRun(99999999)
    const r = listLiveRuns({ env })
    expect(r.live).toEqual([])
    expect(r.skipped).toBe(2)
    expect(psRuns([], { env }).text).toMatch(/2 finished runs skipped/)
  })
  test('an incomplete summary with a live pid is still live', () => {
    const id = fakeRun(process.pid)
    writeFileSync(join(runsDir, id, 'summary.json'), JSON.stringify({ schema: 1, status: 'incomplete' }))
    expect(listLiveRuns({ env }).live.map((x: any) => x.runId)).toEqual([id])
  })
})

describe('meerkat stop', () => {
  test('(c) without --yes nothing is stopped', () => {
    const s = sleeper()
    const id = fakeRun(s.pid as number)
    const r = stopRun(id, { env })
    expect(r.code).toBe(0)
    expect(r.text).toMatch(/would stop/i)
    expect(alive(s.pid as number)).toBe(true)
  })
  test('(d) with --yes the run and its child tree end, and the test runner is left alone', async () => {
    const s = sleeper()
    const id = fakeRun(s.pid as number)
    const r = stopRun(id, { env, yes: true })
    expect(r.code).toBe(0)
    expect(await waitDead(s.pid as number)).toBe(true)
    expect(alive(process.pid)).toBe(true)
  }, 20000)
  test('stop leaves a second run alone when only the first id is given', async () => {
    const a = sleeper()
    const b = sleeper()
    const ida = fakeRun(a.pid as number)
    fakeRun(b.pid as number)
    stopRun(ida, { env, yes: true })
    expect(await waitDead(a.pid as number)).toBe(true)
    expect(alive(b.pid as number)).toBe(true)
  }, 20000)
  test('(e) refuses an id with no run.json, a dead pid, the current process, and a pid that is not a node process', () => {
    expect(stopRun('no-such-run', { env, yes: true }).code).toBe(2)
    expect(stopRun(fakeRun(99999999), { env, yes: true }).code).toBe(2)
    const self = stopRun(fakeRun(process.pid), { env, yes: true })
    expect(self.code).toBe(2)
    expect(self.text).toMatch(/current process/i)
    expect(alive(process.pid)).toBe(true)
    const other = process.platform === 'win32' ? sleeper('ping', ['-n', '60', '127.0.0.1']) : sleeper('sleep', ['60'])
    const r = stopRun(fakeRun(other.pid as number), { env, yes: true })
    expect(r.code).toBe(2)
    expect(r.text).toMatch(/not a meerkat/i)
    expect(alive(other.pid as number)).toBe(true)
  }, 30000)
  test('refuses an id that tries to leave the runs folder', () => {
    expect(stopRun('..', { env, yes: true }).code).toBe(2)
    expect(stopRun('../x', { env, yes: true }).code).toBe(2)
  })
})

describe('CLI wiring', () => {
  test('meerkat ps and meerkat stop are commands', () => {
    const run = (a: string[]) => spawnSync(process.execPath, [BIN, ...a], { encoding: 'utf8', env, timeout: 60000 })
    expect(run(['ps']).status).toBe(0)
    expect(run(['stop']).status).toBe(2)
    expect(run(['stop', 'no-such-run']).status).toBe(2)
    expect(run(['stop', '--help']).stdout).toContain('--yes')
  }, 90000)
})
