// "!" in a shell-bound Windows command is safe only while delayed expansion is off (lib/exec.mjs bangRefusal). The registry read is stubbed.
import { describe, expect, test } from 'vitest'
import { REG_KEYS, bangRefusal, quote, readDelayedExpansionValue } from '../lib/exec.mjs'

const off = () => ({ ok: true, value: null })
const on = (v: string) => (key: string) => ({ ok: true, value: key === REG_KEYS[0] ? v : null })

describe('bangRefusal', () => {
  test('passes when neither registry value is set (the normal case)', () => {
    expect(bangRefusal(['npx', '!node_modules/**'], { platform: 'win32', readRegistry: off })).toBeNull()
  })
  test('passes when a value is set to 0', () => {
    expect(bangRefusal(['x!'], { platform: 'win32', readRegistry: () => ({ ok: true, value: '0x0' }) })).toBeNull()
  })
  test('refuses when HKCU DelayedExpansion is 1', () => {
    const msg = bangRefusal(['x!NAME!'], { platform: 'win32', readRegistry: on('0x1') })
    expect(msg).toMatch(/delayed expansion is switched on/)
    expect(msg).toMatch(/HKCU/)
  })
  test('refuses when HKLM DelayedExpansion is 1', () => {
    const msg = bangRefusal(['x!'], { platform: 'win32', readRegistry: (k: string) => ({ ok: true, value: k === REG_KEYS[1] ? '1' : null }) })
    expect(msg).toMatch(/HKLM/)
  })
  test('fails closed when the registry read fails or throws', () => {
    expect(bangRefusal(['x!'], { platform: 'win32', readRegistry: () => ({ ok: false, why: 'reading it timed out after 3 s' }) })).toMatch(/could not confirm.*timed out/)
    expect(bangRefusal(['x!'], { platform: 'win32', readRegistry: () => { throw new Error('boom') } })).toMatch(/could not confirm.*boom/)
  })
  test('does not read the registry when no word has a !, and never on Linux', () => {
    const never = () => { throw new Error('must not be called') }
    expect(bangRefusal(['npm', 'test'], { platform: 'win32', readRegistry: never })).toBeNull()
    expect(bangRefusal(['x!'], { platform: 'linux', readRegistry: never })).toBeNull()
  })
  test('quote still lets ! through', () => {
    expect(quote('!node_modules/**')).toBe('!node_modules/**')
  })
})

describe('readDelayedExpansionValue', () => {
  const run = (r: object) => () => r
  test('parses the value, treats a missing value as not set, and fails closed otherwise', () => {
    expect(readDelayedExpansionValue(REG_KEYS[0], { run: run({ status: 0, stdout: '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Command Processor\r\n    DelayedExpansion    REG_DWORD    0x1\r\n' }) })).toEqual({ ok: true, value: '0x1' })
    expect(readDelayedExpansionValue(REG_KEYS[0], { run: run({ status: 1, stdout: '', stderr: 'ERROR: not found' }) })).toEqual({ ok: true, value: null })
    expect(readDelayedExpansionValue(REG_KEYS[0], { run: run({ status: null, error: Object.assign(new Error('spawnSync reg ETIMEDOUT'), { code: 'ETIMEDOUT' }) }) })).toMatchObject({ ok: false, why: expect.stringMatching(/timed out after 3 s/) })
    expect(readDelayedExpansionValue(REG_KEYS[0], { run: run({ status: null, error: Object.assign(new Error('spawn reg ENOENT'), { code: 'ENOENT' }) }) }).ok).toBe(false)
    expect(readDelayedExpansionValue(REG_KEYS[0], { run: run({ status: 0, stdout: 'garbage' }) }).ok).toBe(false)
    expect(readDelayedExpansionValue(REG_KEYS[0], { run: run({ status: 5, stdout: '' }) }).ok).toBe(false)
  })
  test('on this machine the real read works and the value is not set', () => {
    if (process.platform !== 'win32') return
    expect(readDelayedExpansionValue(REG_KEYS[0]).ok).toBe(true)
    expect(readDelayedExpansionValue(REG_KEYS[1]).ok).toBe(true)
  })
})
