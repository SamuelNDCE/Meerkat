// The bad-and-good catalog (catalog/): every entry's good version passes the existing check and its bad version fails it.
// Each entry is run through the same script the pack runs, on a throwaway copy of just that one version (see catalog/README.md).
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { CHECK_TABLES } from '../thorough/rules-code-patterns.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CATALOG = join(ROOT, 'catalog')
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

type Entry = { language: string; slug: string; dir: string; meta: { rule: string; runner: string; check: string; why: string; bad: string; good: string } }

const entries: Entry[] = []
for (const language of readdirSync(CATALOG).filter((n) => statSync(join(CATALOG, n)).isDirectory())) {
  for (const slug of readdirSync(join(CATALOG, language))) {
    const dir = join(CATALOG, language, slug)
    if (existsSync(join(dir, 'entry.json'))) entries.push({ language, slug, dir, meta: JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')) })
  }
}

// Copies one version (bad or good) into a fresh folder and runs the entry's check on it.
function run(e: Entry, which: 'bad' | 'good'): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-catalog-'))
  made.push(dir)
  cpSync(join(e.dir, which), dir, { recursive: true })
  try {
    const out = execFileSync(process.execPath, [e.meta.runner, e.meta.check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (err: any) {
    return { code: err.status ?? -1, out: String(err.stdout ?? '') + String(err.stderr ?? '') }
  }
}

describe('catalog shape', () => {
  test('JavaScript and TypeScript, Python and Rust each have at least three entries', () => {
    for (const language of ['javascript-typescript', 'python', 'rust']) {
      expect(entries.filter((e) => e.language === language).length).toBeGreaterThanOrEqual(3)
    }
  })
  test('the catalog documents its schema', () => {
    expect(existsSync(join(CATALOG, 'README.md'))).toBe(true)
  })
})

describe.each(entries.map((e) => [`${e.language}/${e.slug}`, e] as const))('%s', (_name, e) => {
  test('the entry is complete and names a real rule', () => {
    expect(e.meta.why.length).toBeGreaterThan(20)
    expect(e.meta.why.endsWith('.')).toBe(true)
    expect(e.meta.why).not.toMatch(/—/)
    expect(existsSync(join(e.dir, e.meta.bad))).toBe(true)
    expect(existsSync(join(e.dir, e.meta.good))).toBe(true)
    if (e.meta.runner === 'thorough/code-patterns.mjs') {
      const ids = (CHECK_TABLES[e.meta.check] ?? []).map((r: any) => r.id)
      expect(ids).toContain(e.meta.rule)
    } else {
      expect(e.meta.rule).toBe(e.meta.check)
    }
  })
  test('the bad version fails the check', () => {
    const r = run(e, 'bad')
    expect(r.code).toBe(1)
    if (e.meta.runner === 'thorough/code-patterns.mjs') expect(r.out).toContain(`MEERKAT-SUB FAIL ${e.meta.rule} `)
  })
  test('the good version passes the check', () => {
    const r = run(e, 'good')
    expect(r.code).toBe(0)
    if (e.meta.runner === 'thorough/code-patterns.mjs') expect(r.out).toContain(`MEERKAT-SUB PASS ${e.meta.rule} `)
  })
})
