// Scan speed: the per-run file read cache, the batched git call and the memoised Rust helpers must give exactly the answers the plain versions give.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs without types
import { CHECK_IGNORE_CHUNK_CHARS, ignoredPaths, isIgnored, lineCounter, makeCachedReader, readText, rustBlank, rustInTest, rustTestLines } from '../thorough/kit.mjs'
// @ts-expect-error plain .mjs without types
import { evaluate } from '../thorough/rules.mjs'
// @ts-expect-error plain .mjs without types
import { CHECK_TABLES } from '../thorough/rules-electron-plus.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-scan-speed-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

type Stat = { text: string; mtimeMs: number; size: number }

describe('per-run file read cache', () => {
  test('returns identical content and reads each unchanged file once', () => {
    const files = new Map<string, Stat>([
      ['/a', { text: 'alpha', mtimeMs: 1, size: 5 }],
      ['/b', { text: 'beta!', mtimeMs: 1, size: 5 }],
    ])
    const reads: string[] = []
    const reader = makeCachedReader({
      read: (p: string) => {
        reads.push(p)
        return files.get(p)!.text
      },
      stat: (p: string) => files.get(p),
    })
    for (let i = 0; i < 5; i++) {
      expect(reader('/a')).toBe('alpha')
      expect(reader('/b')).toBe('beta!')
    }
    expect(reads).toEqual(['/a', '/b'])
  })
  test('reads again when the modified time changed, and drops the oldest entry first when full', () => {
    const files = new Map<string, Stat>([
      ['/a', { text: 'aaaa', mtimeMs: 1, size: 4 }],
      ['/b', { text: 'bbbb', mtimeMs: 1, size: 4 }],
      ['/c', { text: 'cccc', mtimeMs: 1, size: 4 }],
    ])
    const reads: string[] = []
    const reader = makeCachedReader({
      read: (p: string) => {
        reads.push(p)
        return files.get(p)!.text
      },
      stat: (p: string) => files.get(p),
      maxBytes: 8,
    })
    reader('/a')
    reader('/b')
    reader('/c') // over 8 bytes: /a, the oldest, goes
    reader('/b')
    reader('/c')
    expect(reads).toEqual(['/a', '/b', '/c'])
    reader('/a')
    expect(reads).toEqual(['/a', '/b', '/c', '/a'])
    files.set('/c', { text: 'CCCC', mtimeMs: 2, size: 4 })
    expect(reader('/c')).toBe('CCCC')
  })
  test('a file larger than the per-file limit is read every time and never kept', () => {
    const reads: string[] = []
    const reader = makeCachedReader({
      read: (p: string) => {
        reads.push(p)
        return 'x'.repeat(10)
      },
      stat: () => ({ mtimeMs: 1, size: 10 }),
      maxFile: 5,
    })
    reader('/big')
    reader('/big')
    expect(reads.length).toBe(2)
  })
})

describe('batched git check-ignore', () => {
  test('gives the same answer per path as one call per path, and splits long lists', () => {
    execFileSync('git', ['init', '-q', root])
    put('.gitignore', 'build/\n*.log\n')
    const names: string[] = []
    for (let i = 0; i < 120; i++) {
      names.push(i % 3 === 0 ? `build/out-${i}-${'x'.repeat(60)}.js` : i % 3 === 1 ? `src/file-${i}.log` : `src/keep-${i}-${'y'.repeat(60)}.js`)
    }
    const calls: string[][] = []
    const spy = (cmd: string, args: string[], opts: object) => {
      calls.push(args)
      return execFileSync(cmd, args, opts as never)
    }
    const batched = ignoredPaths(root, names, { run: spy })
    const single = new Set(names.filter((n) => isIgnored(root, n)))
    expect([...batched].sort()).toEqual([...single].sort())
    expect(single.size).toBe(80)
    expect(calls.length).toBeGreaterThan(1) // the list is over one 6000 character call
    expect(calls.length).toBeLessThan(names.length)
    expect(CHECK_IGNORE_CHUNK_CHARS).toBe(6000)
  })
})

describe('Rust helpers kept per text', () => {
  const rs = ['fn a() {}', '#[cfg(test)]', 'mod tests {', '  #[test]', '  fn t() { let s = "}"; }', '}', '#[test]', 'fn lone() {', '}', 'fn z() {}', ''].join('\n')
  test('lineCounter matches splitting the text up to the index', () => {
    const text = 'a\nbb\n\nccc\n'
    const at = lineCounter(text)
    for (let i = 0; i <= text.length; i++) expect(at(i)).toBe(text.slice(0, i).split('\n').length)
  })
  test('test ranges are the same on every call', () => {
    const lines = rs.split('\n')
    const flags = (): boolean[] => lines.map((_, i) => rustInTest({ file: 'src/x.rs', lines: [...lines], text: rs, index: i }))
    const first = flags()
    expect(first).toEqual([false, true, true, true, true, true, true, true, true, false, false])
    expect(flags()).toEqual(first)
    const mod = rustTestLines('src/x.rs', rs)
    expect([1, 2, 3, 6, 7, 10].map((n) => mod(n))).toEqual([false, true, true, true, false, false])
    expect(rustBlank(rs)).toBe(rustBlank(rs))
    expect(rustBlank(rs).length).toBe(rs.length)
  })
})

describe('findings with the read cache on and off', () => {
  test('a fixture repository gives identical findings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-scan-speed-fx-'))
    try {
      const w = (rel: string, text: string) => {
        mkdirSync(dirname(join(dir, rel)), { recursive: true })
        writeFileSync(join(dir, rel), text)
      }
      w('package.json', '{ "name": "fx", "devDependencies": { "electron": "41.0.0" } }\n')
      w('src-tauri/src/lib.rs', '#[tauri::command]\nfn read_it(path: String) -> String { std::fs::read_to_string(path).unwrap() }\n#[cfg(test)]\nmod tests {\n  #[test]\n  fn t() {}\n}\n')
      w('main.js', 'const w = new BrowserWindow({ webPreferences: { nodeIntegration: true } })\n')
      execFileSync('git', ['-C', dir, 'init', '-q'])
      execFileSync('git', ['-C', dir, 'add', '-A'])
      const table = [...CHECK_TABLES['ep-tauri-cross'], ...CHECK_TABLES['ep-window']]
      const run = () => JSON.stringify(evaluate(dir, table, { skipTests: true }))
      const g = globalThis as { __meerkatReadCache?: boolean }
      const before = g.__meerkatReadCache
      try {
        g.__meerkatReadCache = false
        const off = run()
        g.__meerkatReadCache = true
        const on1 = run()
        const on2 = run() // the second pass is served from the cache
        expect(on1).toBe(off)
        expect(on2).toBe(off)
        expect(readText(dir, 'main.js')).toContain('nodeIntegration')
      } finally {
        g.__meerkatReadCache = before
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
