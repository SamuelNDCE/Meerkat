// --scope: which files a folder scope covers, and which findings it keeps. The verdict rule is in lib/runner.mjs.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { inScopeFile, scopedFiles } from '../lib/changed.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('inScopeFile', () => {
  test('a file inside the folder is in scope, a file that only shares a prefix is not', () => {
    expect(inScopeFile('lib/x.mjs', ['lib'])).toBe(true)
    expect(inScopeFile('libx/y.mjs', ['lib'])).toBe(false)
  })

  test('a finding with no file is not inside any folder', () => {
    expect(inScopeFile(undefined, ['lib'])).toBe(false)
    expect(inScopeFile('', ['lib'])).toBe(false)
  })

  test('the project root, with a leading ./ or a trailing slash, covers everything', () => {
    expect(inScopeFile('a/b.mjs', ['.'])).toBe(true)
    expect(inScopeFile('a/b.mjs', ['./'])).toBe(true)
    expect(inScopeFile('a/b.mjs', ['a/'])).toBe(true)
  })

  test('Windows separators in the file name are read the same way', () => {
    expect(inScopeFile('lib\\x.mjs', ['lib'])).toBe(true)
  })
})

describe('scopedFiles', () => {
  test('lists the tracked files of one folder, and nothing outside it', () => {
    const files = scopedFiles(root, ['lib/changed.mjs'])
    expect(files).toEqual(['lib/changed.mjs'])
  })

  test('a folder that does not exist yields no files', () => {
    expect(scopedFiles(root, ['no-such-folder-here'])).toEqual([])
  })
})
