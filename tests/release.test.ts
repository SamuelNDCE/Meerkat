import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { changelogEntry, nextVersion } from '../tools/release.mjs'

describe('release tool', () => {
  test('bumps patch, minor and major', () => {
    expect(nextVersion('0.2.9', 'patch')).toBe('0.2.10')
    expect(nextVersion('0.2.9', 'minor')).toBe('0.3.0')
    expect(nextVersion('0.2.9', 'major')).toBe('1.0.0')
  })
  test('takes an exact version and refuses nonsense', () => {
    expect(nextVersion('0.2.0', '1.4.0')).toBe('1.4.0')
    expect(nextVersion('0.2.0', 'huge')).toBeNull()
  })
  test('the changelog entry is one bullet per note', () => {
    expect(changelogEntry('0.3.0', 'Added a; Fixed b', '2026-11-01')).toBe('## 0.3.0 (2026-11-01)\n\n- Added a\n- Fixed b\n')
  })
})
