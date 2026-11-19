// meerkat map --budget <tokens> [--for <file>] (lib/ctxmap.mjs): ranked symbols fitted to a token budget (tokens = characters / 4).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-ctxmap-'))); tmps.push(d); return d }
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

function mk(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 120000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
function put(dir: string, rel: string, text: string) {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
}
function tree(dir: string, rel = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${e}` : e
    out.push(r)
    if (statSync(join(dir, r)).isDirectory()) out.push(...tree(dir, r))
  }
  return out
}
// Symbol names in the order the output lists them (symbol lines start with two spaces).
const order = (out: string) => out.split('\n').filter((l) => l.startsWith('  ')).map((l) => l.trim().split(/\s+/)[0]!)

function fixture() {
  const d = tmp()
  put(d, 'src/core.js', 'export function heavyUsed() { return 1 }\nexport function oneRef() { return 2 }\nexport function zeroB() { return 3 }\nexport function zeroA() { return 4 }\n')
  put(d, 'src/a.js', "import { heavyUsed, oneRef } from './core.js'\nexport function runA() { return heavyUsed() + oneRef() }\n")
  put(d, 'src/b.js', "import { heavyUsed } from './core.js'\nexport function runB() { return heavyUsed() }\n")
  put(d, 'src/c.js', "import { heavyUsed } from './core.js'\nexport function runC() { return heavyUsed() }\n")
  put(d, 'other/e.js', 'export function zzLocal() { return 5 }\n')
  return d
}

describe('meerkat map --budget', () => {
  test('a symbol referenced by many files ranks above one referenced by none; ties go by name', () => {
    const d = fixture()
    const r = mk(d, 'map', '--budget', '4000')
    expect(r.code).toBe(0)
    const o = order(r.out)
    expect(o.indexOf('heavyUsed')).toBe(0)
    expect(o.indexOf('heavyUsed')).toBeLessThan(o.indexOf('oneRef'))
    expect(o.indexOf('oneRef')).toBeLessThan(o.indexOf('zeroA'))
    expect(o.indexOf('zeroA')).toBeLessThan(o.indexOf('zeroB')) // equal score: name order
    expect(r.out).toMatch(/name-based/i)
  })

  test('output stays under the budget, at every size', () => {
    const d = fixture()
    for (const b of [50, 100, 200, 400]) {
      const r = mk(d, 'map', '--budget', String(b))
      expect(r.code).toBe(0)
      expect(r.out.length, `budget ${b}`).toBeLessThanOrEqual(b * 4)
    }
    expect(mk(d, 'map', '--budget', '50').out.length).toBeLessThan(mk(d, 'map', '--budget', '4000').out.length)
  })

  test('the same input gives the same output', () => {
    const d = fixture()
    const a = mk(d, 'map', '--budget', '300').out
    writeFileSync(join(d, 'src/b.js'), "import { heavyUsed } from './core.js'\nexport function runB() { return heavyUsed() }\n") // same content, new mtime
    const b = mk(d, 'map', '--budget', '300').out
    expect(b).toBe(a)
    expect(a.length).toBeGreaterThan(0)
  })

  test('--for <file> boosts the symbols near that file', () => {
    const d = fixture()
    const plain = order(mk(d, 'map', '--budget', '4000').out)
    const boosted = order(mk(d, 'map', '--budget', '4000', '--for', 'other/e.js').out)
    expect(plain.indexOf('zzLocal')).toBeGreaterThan(plain.indexOf('oneRef'))
    expect(boosted.indexOf('zzLocal')).toBeLessThan(boosted.indexOf('oneRef'))
    expect(boosted.indexOf('zzLocal')).toBeLessThan(boosted.indexOf('heavyUsed'))
    expect(mk(d, 'map', '--for', 'nope/missing.js').code).toBe(2)
  })

  test('stdout only: nothing is written into the project; bad budget is a usage error', () => {
    const d = fixture()
    const before = tree(d)
    expect(mk(d, 'map', '--budget', '300').code).toBe(0)
    expect(tree(d)).toEqual(before)
    expect(mk(d, 'map', '--budget', 'abc').code).toBe(2)
    expect(mk(d, 'map', '--budget', '0').code).toBe(2)
  })

  test('--for alone uses the default budget of 4000 tokens', () => {
    const d = fixture()
    const r = mk(d, 'map', '--for', 'src/core.js')
    expect(r.code).toBe(0)
    expect(r.out).toContain('4000 tokens')
  })
})
