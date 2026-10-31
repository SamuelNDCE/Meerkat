// The lang checks (thorough/lang.mjs): each check must fail on its own fixture with a "found N" line, pass on one clean folder
// that uses the safe shape of every check, honour the allow-list and budgets, and the lang pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/lang.mjs'
const ALL = ['js-eqeqeq', 'js-var-usage', 'js-await-in-loop', 'js-unhandled-promise', 'js-prototype-pollution', 'ts-any-overuse', 'ts-ignore-comments', 'py-bare-except', 'py-mutable-default', 'py-assert-in-prod', 'go-ignored-errors', 'go-defer-in-loop', 'rust-unwrap-overuse', 'rust-todo-macros']

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 clean, 1 findings, 75 not run) and what it printed.
function runCheck(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

// A small folder holding the given files.
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-lang-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

// One project with the safe shape of every check in it.
const CLEAN: Record<string, string> = {
  'src/shapes.js': [
    'export const same = (a, b) => a === b',
    'export const missing = (x) => x == null',
    '',
    'export function save(p) {',
    '  return p.then((u) => u).catch(() => null)',
    '}',
    '',
    'export function chain(id) {',
    '  fetchUser(id).then((u) => u).catch(() => null)',
    '}',
    '',
    'export async function all(ids) {',
    '  return Promise.all(ids.map((id) => fetchOne(id)))',
    '}',
    '',
    'export function collect(list) {',
    '  const out = []',
    '  for (const item of list) {',
    '    out.push(() => fetchOne(item))',
    '  }',
    '  return out',
    '}',
    '',
    'export function store(name, value) {',
    '  const safe = Object.create(null)',
    '  safe[name] = value',
    '  return safe',
    '}',
    '',
  ].join('\n'),
  'src/types.ts': [
    'export const label = (x: unknown): string => String(x)',
    '// @ts-expect-error: this line is deliberately wrong in the safe shape',
    'export const bad: number = "x"',
    '',
  ].join('\n'),
  'tools/check.py': [
    'def add(item, bucket=None):',
    '    bucket = bucket or []',
    '    bucket.append(item)',
    '    return bucket',
    '',
    '',
    'try:',
    '    run()',
    'except ValueError:',
    '    pass',
    '',
  ].join('\n'),
  'cmd/main.go': [
    'package main',
    '',
    'import (',
    '\t"fmt"',
    '\t"strconv"',
    ')',
    '',
    'func parse(s string) (int, error) {',
    '\treturn strconv.Atoi(s)',
    '}',
    '',
    'func main() {',
    '\tfor i := 0; i < 2; i++ {',
    '\t\tfmt.Println(i)',
    '\t}',
    '}',
    '',
  ].join('\n'),
  'src/lib.rs': [
    'pub fn parse(s: &str) -> Result<u32, std::num::ParseIntError> {',
    '    s.parse::<u32>()',
    '}',
    '',
    '#[cfg(test)]',
    'mod tests {',
    '    #[test]',
    '    fn parses() {',
    '        assert_eq!("1".parse::<u32>().unwrap(), 1);',
    '        todo!();',
    '    }',
    '}',
    '',
  ].join('\n'),
}

describe('lang checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      const r = runCheck([check, '--fixtures'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/found \d+/)
    })
  }
})

describe('lang checks pass on a clean folder', () => {
  const dir = folder(CLEAN)
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(runCheck([check, '--root', dir]).code).toBe(0)
    })
  }
})

describe('the allow-list and the budgets are honoured', () => {
  test('.meerkat-lang-allow silences the named check on the named file', () => {
    const dir = folder({ 'a.js': 'export const same = (a, b) => a == b\n', '.meerkat-lang-allow': '# reviewed by hand\njs-eqeqeq a.js\n' })
    expect(runCheck(['js-eqeqeq', '--root', dir]).code).toBe(0)
  })

  test('ts-any-overuse counts against lang.maxAny', () => {
    const body = Array.from({ length: 26 }, (_, i) => `export const v${i}: any = ${i}\n`).join('')
    expect(runCheck(['ts-any-overuse', '--root', folder({ 'a.ts': body })]).code).toBe(1)
    expect(runCheck(['ts-any-overuse', '--root', folder({ 'a.ts': body, '.meerkat-budgets.json': '{"lang":{"maxAny":30}}\n' })]).code).toBe(0)
  })
})

describe('the lang pack', () => {
  test('loads 14 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'lang'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(14)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
