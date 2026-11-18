import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module
import { logCapBytes, pruneRunsBySize } from './logcap.mjs'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function logs(names: string[], kb: number, withSummary = true) {
  const root = mkdtempSync(join(tmpdir(), 'mk-logcap-'))
  made.push(root)
  for (const n of names) {
    const d = join(root, 'runs', n)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'run.log'), 'x'.repeat(kb * 1024))
    if (withSummary) writeFileSync(join(d, 'summary.json'), '{}')
  }
  return root
}

describe('pruneRunsBySize', () => {
  it('removes the oldest finished runs until the folder fits the cap', () => {
    const root = logs(['20260101-100000-app-fast', '20260102-100000-app-fast', '20260103-100000-app-fast', '20260104-100000-app-fast'], 400)
    const removed = pruneRunsBySize({ MEERKAT_LOG_DIR: root, MEERKAT_LOG_MAX_MB: '1' }, { keep: join(root, 'runs', '20260104-100000-app-fast') })
    expect(removed).toEqual(['20260101-100000-app-fast', '20260102-100000-app-fast'])
    expect(existsSync(join(root, 'runs', '20260103-100000-app-fast'))).toBe(true)
    expect(existsSync(join(root, 'runs', '20260104-100000-app-fast'))).toBe(true)
  })
  it('always keeps the run just written, even when it alone is over the cap', () => {
    const root = logs(['20260101-100000-app-fast', '20260102-100000-app-fast'], 2048)
    const removed = pruneRunsBySize({ MEERKAT_LOG_DIR: root, MEERKAT_LOG_MAX_MB: '1' }, { keep: join(root, 'runs', '20260102-100000-app-fast') })
    expect(removed).toEqual(['20260101-100000-app-fast'])
    expect(existsSync(join(root, 'runs', '20260102-100000-app-fast'))).toBe(true)
  })
  it('never removes a run that is still being written (no summary.json)', () => {
    const root = logs(['20260101-100000-app-fast', '20260102-100000-app-fast'], 800, false)
    expect(pruneRunsBySize({ MEERKAT_LOG_DIR: root, MEERKAT_LOG_MAX_MB: '1' })).toEqual([])
  })
  it('does nothing when under the cap or when the cap is 0', () => {
    const root = logs(['20260101-100000-app-fast', '20260102-100000-app-fast'], 400)
    expect(pruneRunsBySize({ MEERKAT_LOG_DIR: root, MEERKAT_LOG_MAX_MB: '5' })).toEqual([])
    expect(pruneRunsBySize({ MEERKAT_LOG_DIR: root, MEERKAT_LOG_MAX_MB: '0' })).toEqual([])
  })
  it('defaults to 2 GB and ignores a bad value', () => {
    expect(logCapBytes({})).toBe(2048 * 1024 * 1024)
    expect(logCapBytes({ MEERKAT_LOG_MAX_MB: 'abc' })).toBe(2048 * 1024 * 1024)
    expect(logCapBytes({ MEERKAT_LOG_MAX_MB: '0' })).toBe(0)
  })
})
