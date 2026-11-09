// 0.7.8: a lock waiter says its queue position, the holder's pid and command, and how long it has waited.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { acquire } from '../lib/lock.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-peer078d-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

describe('lock queue detail', () => {
  test('two waiters report position 1 and 2 of 2, the holder pid and how long they have waited', async () => {
    const dir = join(root, 'cargo.lock')
    const release = (await acquire(dir))!
    const one: string[] = []
    const two: string[] = []
    const w1 = acquire(dir, { maxWaitMs: 1500, pollMs: 10, reportMs: 100, say: (l: string) => one.push(l) })
    await new Promise((r) => setTimeout(r, 120))
    const w2 = acquire(dir, { maxWaitMs: 1200, pollMs: 10, reportMs: 100, say: (l: string) => two.push(l) })
    await new Promise((r) => setTimeout(r, 500))
    release()
    const got = await Promise.all([w1, w2])
    got.forEach((g) => g?.())
    expect(one.some((l) => /^waiting for the lock: position 1 of 2 in the queue, held by process \d+ \(.*\)( for \d+ s)?, you have waited \d+ s$/.test(l))).toBe(true)
    expect(two.some((l) => /^waiting for the lock: position 2 of 2 in the queue, held by process \d+ \(.*\)( for \d+ s)?, you have waited \d+ s$/.test(l))).toBe(true)
    expect(two[0]).toMatch(/^wait started: .*position 2 of 2 in the queue/)
  }, 30_000)
})
