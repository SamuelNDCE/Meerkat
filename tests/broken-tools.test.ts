// Broken tools: two BROKEN strikes for one tool in a run skip that tool, the mark persists and is retried, a pass clears it,
// and a timeout or a missing tool is NOT RUN (never a strike).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { createControl, runAll } from '../lib/runner.mjs'
// @ts-expect-error plain JS module
import { loadBroken, stateFile, toolOf } from '../lib/broken-tools.mjs'

const made: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-broken-'))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

const ctxFor = (home: string, extraEnv: Record<string, string> = {}) => ({ timeoutScale: 1, repoRoot: home, appDir: home, tier: 'fast', env: { ...process.env, ...extraEnv, MEERKAT_HOME: home, MEERKAT_LOG_DIR: join(home, 'logs') }, platform: process.platform, exists: existsSync, changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null, control: createControl() })
const fn = (id: string, tool: string, run: (ctx: any) => any, extra: Record<string, unknown> = {}) => ({ id, title: id, group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1, timeoutSeconds: 2, tool, run, ...extra })
const boom = () => {
  throw new Error('parser blew up')
}
const okFn = () => ({ ok: true, detail: 'ok' })
const run = (checks: any[], home: string, extraEnv = {}) => runAll(checks, ctxFor(home, extraEnv), { log: () => {}, keepGoing: true, parallel: 1 })
const by = (results: any[]) => Object.fromEntries(results.map((r) => [r.id, r]))

describe('two strikes skip the tool, the run continues', () => {
  test('planted: the third check of a broken tool is SKIPPED: broken, and other tools still run', async () => {
    const home = tmp()
    const results = by(await run([fn('a1', 'linty', boom), fn('a2', 'linty', boom), fn('a3', 'linty', okFn), fn('b1', 'other', okFn)], home))
    expect(results.a1.detail).toContain('BROKEN (strike 1 of 2)')
    expect(results.a2.detail).toContain('BROKEN (strike 2 of 2)')
    expect(results.a3.status).toBe('NOT RUN')
    expect(results.a3.detail).toMatch(/^SKIPPED: broken/)
    expect(results.a3.detail).toContain('parser blew up')
    expect(results.a3.detail).toContain('2 times')
    expect(results.b1.status).toBe('PASS')
    expect(loadBroken({ MEERKAT_HOME: home }).linty.strikes).toBe(2)
  })
  test('normal run: nothing is skipped and no state file is written', async () => {
    const home = tmp()
    const results = await run([fn('a1', 'linty', okFn), fn('a2', 'linty', okFn), fn('a3', 'linty', okFn)], home)
    expect(results.map((r: any) => r.status)).toEqual(['PASS', 'PASS', 'PASS'])
    expect(existsSync(stateFile({ MEERKAT_HOME: home }))).toBe(false)
  })
  test('a plain failure (a finding in the project) is never a strike', async () => {
    const home = tmp()
    const bad = () => ({ ok: false, detail: 'bad code' })
    const results = by(await run([fn('a1', 'linty', bad), fn('a2', 'linty', bad), fn('a3', 'linty', okFn)], home))
    expect(results.a2.status).toBe('FAIL')
    expect(results.a2.detail).not.toContain('BROKEN')
    expect(results.a3.status).toBe('PASS')
  })
})

describe('one strike does not skip', () => {
  test('one broken check, then the same tool runs again', async () => {
    const home = tmp()
    const results = by(await run([fn('a1', 'linty', boom), fn('a2', 'linty', okFn)], home))
    expect(results.a1.detail).toContain('BROKEN (strike 1 of 2)')
    expect(results.a2.status).toBe('PASS')
    expect(loadBroken({ MEERKAT_HOME: home }).linty).toBeUndefined()
  })
  test('an unreadable result and unreadable command output each count as a strike', async () => {
    const home = tmp()
    const unreadable = () => {
      throw new Error('not JSON')
    }
    const cmd = { id: 'c1', title: 'c1', group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1, timeoutSeconds: 10, tool: 'cmdtool', run: { cmd: process.execPath, args: ['-e', 'console.log(1)'] }, parseOutput: unreadable }
    const results = by(await run([fn('r1', 'badret', () => undefined), fn('r2', 'badret', () => undefined), fn('r3', 'badret', okFn), cmd], home))
    expect(results.r2.detail).toContain('strike 2 of 2')
    expect(results.r3.detail).toMatch(/^SKIPPED: broken/)
    expect(results.c1.detail).toContain('unreadable output: not JSON')
    expect(results.c1.detail).toContain('strike 1 of 2')
  }, 20_000)
})

describe('the broken mark persists, is retried, and a pass clears it', () => {
  test('next run tries the tool again; a pass removes the mark', async () => {
    const home = tmp()
    await run([fn('a1', 'linty', boom), fn('a2', 'linty', boom)], home)
    expect(Object.keys(loadBroken({ MEERKAT_HOME: home }))).toEqual(['linty'])
    expect(JSON.parse(readFileSync(stateFile({ MEERKAT_HOME: home }), 'utf8')).linty.error).toContain('parser blew up')
    // next run: retried (not skipped up front); still broken keeps the mark
    const again = by(await run([fn('a1', 'linty', boom)], home))
    expect(again.a1.detail).toContain('BROKEN (strike 1 of 2)')
    expect(loadBroken({ MEERKAT_HOME: home }).linty).toBeDefined()
    // next run: it passes, the mark is cleared
    const ok = by(await run([fn('a1', 'linty', okFn)], home))
    expect(ok.a1.status).toBe('PASS')
    expect(loadBroken({ MEERKAT_HOME: home }).linty).toBeUndefined()
  })
  test('the state lives under MEERKAT_HOME, never in the scanned project', () => {
    const home = tmp()
    expect(stateFile({ MEERKAT_HOME: home }).replace(/\\/g, '/')).toBe(`${home.replace(/\\/g, '/')}/broken-tools.json`)
    expect(toolOf({ id: 'x', needs: ['shellcheck'] })).toBe('shellcheck')
    expect(toolOf({ id: 'x', tool: 'eslint', needs: ['node'] })).toBe('eslint')
  })
})

describe('NOT RUN reasons never count as strikes', () => {
  test('timeouts are NOT RUN "timed out", not FAIL and not BROKEN, even three times', async () => {
    const home = tmp()
    const hang = (id: string) => fn(id, 'slowtool', () => new Promise(() => {}), { timeoutSeconds: 0.2 })
    const results = await run([hang('t1'), hang('t2'), hang('t3')], home)
    for (const r of results) {
      expect(r.status).toBe('NOT RUN')
      expect(r.detail).toContain('timed out')
      expect(r.detail).not.toMatch(/BROKEN|SKIPPED/)
    }
    expect(existsSync(stateFile({ MEERKAT_HOME: home }))).toBe(false)
  })
  test('a command that times out is NOT RUN too', async () => {
    const home = tmp()
    const c = { id: 'slowcmd', title: 's', group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1, timeoutSeconds: 1, run: { cmd: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] } }
    const [r] = await run([c], home)
    expect(r.status).toBe('NOT RUN')
    expect(r.detail).toContain('timed out')
  }, 20_000)
  test('a missing tool is NOT RUN with the install hint and no strike; an unreadable target shows its reason', async () => {
    const home = tmp()
    const empty = tmp()
    const missing = (id: string) => fn(id, 'ghost', okFn, { needs: ['meerkat-no-such-tool'], install: 'pip install meerkat-no-such-tool' })
    const results = await run([missing('m1'), missing('m2'), missing('m3'), fn('u1', 'reader', () => ({ ok: false, notRun: 'target is unreadable: permission denied' }))], home, { PATH: empty, Path: empty })
    for (const r of results.slice(0, 3)) {
      expect(r.status).toBe('NOT RUN')
      expect(r.detail).toContain('pip install meerkat-no-such-tool')
      expect(r.detail).not.toMatch(/SKIPPED|BROKEN/)
    }
    expect(results[3]).toMatchObject({ status: 'NOT RUN', detail: 'target is unreadable: permission denied' })
    expect(existsSync(stateFile({ MEERKAT_HOME: home }))).toBe(false)
  })
})
