import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { updateNotice, writeUpdateCache, clearUpdateCache } from './update.mjs'

const home = mkdtempSync(join(tmpdir(), 'meerkat-upd-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))
const env = { MEERKAT_USER_CONFIG: join(home, 'cfg.json') }

// Every kind of update shows the yellow line: a new minor, a fix number, and a fix published without a new version number.
describe('the update notice', () => {
  const show = (latest: string, current: string, behind = 0) => {
    writeUpdateCache(latest, Date.now(), env, home, behind)
    return updateNotice({ current, env, home })
  }
  test('a new feature version shows', () => {
    expect(show('0.4.0', '0.3.0')?.latest).toBe('0.4.0')
  })
  test('a new fix number shows', () => {
    expect(show('0.3.1', '0.3.0')?.latest).toBe('0.3.1')
  })
  test('a fix with the same version number but new commits shows, with the number of changes', () => {
    expect(show('0.3.0', '0.3.0', 3)?.latest).toBe('0.3.0+3')
  })
  test('nothing new shows nothing', () => {
    expect(show('0.3.0', '0.3.0', 0)).toBeNull()
  })
  test('an older remote version never shows, even with commits ahead', () => {
    expect(show('0.2.0', '0.3.0', 4)).toBeNull()
  })
  test('clearing the cache removes the line', () => {
    writeUpdateCache('0.9.0', Date.now(), env, home, 5)
    clearUpdateCache(env, home)
    expect(updateNotice({ current: '0.3.0', env, home })).toBeNull()
  })
})
