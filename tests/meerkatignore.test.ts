// .meerkatignore (thorough/kit.mjs): pattern matching, negation, comments, CRLF, spaces in paths, the safety list, and no file = no change.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module without type declarations
import { applyMeerkatIgnore, isMeerkatIgnored, parseMeerkatIgnore, trackedFiles } from '../thorough/kit.mjs'

const ignored = (patterns: string, file: string): boolean => isMeerkatIgnored(parseMeerkatIgnore(patterns), file)

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-ignore-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

describe('.meerkatignore patterns', () => {
  test('a folder pattern ignores everything under it', () => {
    expect(ignored('examples/', 'examples/a/b.md')).toBe(true)
    expect(ignored('examples/', 'src/examples/a.md')).toBe(true)
    expect(ignored('examples/', 'examples.md')).toBe(false)
  })
  test('a pattern with a slash is anchored to the root', () => {
    expect(ignored('docs/images/', 'docs/images/a.gif')).toBe(true)
    expect(ignored('docs/images/', 'x/docs/images/a.gif')).toBe(false)
  })
  test('a star stays inside one path part, a double star crosses parts', () => {
    expect(ignored('thorough/rules-*.mjs', 'thorough/rules-a.mjs')).toBe(true)
    expect(ignored('thorough/rules-*.mjs', 'thorough/sub/rules-a.mjs')).toBe(false)
    expect(ignored('thorough/**/x.mjs', 'thorough/a/b/x.mjs')).toBe(true)
    expect(ignored('**/gen/**', 'a/b/gen/c/d.js')).toBe(true)
    expect(ignored('*.min.js', 'a/b/app.min.js')).toBe(true)
  })
  test('a bang line re-includes, and the last matching line wins', () => {
    expect(ignored('*.min.js\n!keep.min.js', 'keep.min.js')).toBe(false)
    expect(ignored('*.min.js\n!keep.min.js', 'other.min.js')).toBe(true)
    expect(ignored('!keep.min.js\n*.min.js', 'keep.min.js')).toBe(true)
  })
  test('comments, blank lines and CRLF line endings are handled', () => {
    const text = '# generated code\r\n\r\ngen/\r\n   \r\n# end\r\n'
    expect(ignored(text, 'gen/a.js')).toBe(true)
    expect(ignored(text, 'src/a.js')).toBe(false)
    expect(parseMeerkatIgnore(text)).toHaveLength(1)
  })
  test('a path with spaces and regex characters is matched literally', () => {
    expect(ignored('my dir/', 'my dir/file.txt')).toBe(true)
    expect(ignored('a+b (1)/', 'a+b (1)/f.txt')).toBe(true)
    expect(ignored('a+b (1)/', 'aab (1)/f.txt')).toBe(false)
  })
  test('Windows separators are normalised', () => {
    expect(ignored('docs/', 'docs\\a.md')).toBe(true)
  })
})

describe('the safety list', () => {
  test('manifests, lockfiles, licences and .meerkatignore are never ignored', () => {
    const all = '*\n**\n'
    for (const f of ['package.json', 'sub/package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'LICENSE', 'LICENSE.md', '.meerkatignore']) {
      expect(ignored(all, f), f).toBe(false)
    }
    expect(ignored(all, 'src/app.js')).toBe(true)
  })
})

describe('trackedFiles with .meerkatignore', () => {
  const files = { 'a.js': '1', 'gen/b.js': '2', 'package.json': '{}', 'my dir/c.js': '3' }
  const quiet = () => {
    const orig = process.stderr.write.bind(process.stderr)
    const lines: string[] = []
    process.stderr.write = ((s: string) => (lines.push(String(s)), true)) as typeof process.stderr.write
    return { lines, restore: () => (process.stderr.write = orig) }
  }

  test('no file means no change and no note', () => {
    const dir = project(files)
    const cap = quiet()
    const list = trackedFiles(dir).sort()
    cap.restore()
    expect(list).toEqual(['a.js', 'gen/b.js', 'my dir/c.js', 'package.json'])
    expect(cap.lines.join('')).not.toContain('ignored')
  })
  test('ignored files are dropped and one note goes to stderr', () => {
    const dir = project({ ...files, '.meerkatignore': '# generated\r\ngen/\r\nmy dir/\r\npackage.json\r\n' })
    const cap = quiet()
    const list = trackedFiles(dir).sort()
    cap.restore()
    expect(list).toEqual(['.meerkatignore', 'a.js', 'package.json'])
    expect(cap.lines.join('')).toContain('ignored 2 files by .meerkatignore')
  })
  test('an empty or comment-only file changes nothing', () => {
    const dir = project({ ...files, '.meerkatignore': '# nothing yet\n' })
    expect(applyMeerkatIgnore(dir, ['a.js', 'gen/b.js'])).toEqual(['a.js', 'gen/b.js'])
  })
})
