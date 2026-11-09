// A lock folder whose holder died before it wrote owner.json is cleared, so a later job does not wait out the whole limit (item 18).
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { acquire } from './lock.mjs'

const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })

describe('lock folder with no owner written', () => {
  test('a folder older than noOwnerMs is cleared and the job gets the lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'meerkat-lock-')); made.push(root)
    const dir = join(root, 'cargo.lock')
    mkdirSync(dir)
    const said: string[] = []
    const t0 = Date.now()
    const release = await acquire(dir, { maxWaitMs: 60_000, pollMs: 20, noOwnerMs: 50, say: (l: string) => said.push(l) })
    expect(typeof release).toBe('function')
    expect(Date.now() - t0).toBeLessThan(10_000)
    expect(said.join('\n')).toMatch(/cleared a lock folder with no owner/)
    release()
  })
})
