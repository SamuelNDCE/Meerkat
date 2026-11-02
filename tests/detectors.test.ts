// The detectors pack (thorough/detectors.mjs): each tool's recorded output (tests/fixtures/detectors/) becomes Meerkat findings with the
// tool's own rule ids, clean output passes, and a missing tool is NOT RUN with an install hint. No tool has to be installed.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'
import { parseFindingLine } from '../lib/findings.mjs'
// @ts-expect-error plain JS module
import { parseClippy, parseOsv, parseSemgrep, parseTsc, ruleId } from '../thorough/detectors.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FX = 'tests/fixtures/detectors'
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function run(args: string[], env: Record<string, string> = {}, cwd = ROOT) {
  const r = spawnSync(process.execPath, [join(ROOT, 'thorough/detectors.mjs'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  const out = `${r.stdout}${r.stderr}`
  const findings = out.split(/\r?\n/).filter((l) => l.startsWith('MEERKAT-FINDING'))
  return { code: r.status, out, findings }
}
const emptyDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-det-'))
  made.push(d)
  return d
}

describe('parsing recorded tool output', () => {
  test('osv-scanner: OSV id, fixed version, high only when a fix exists', () => {
    const f = parseOsv(JSON.parse(readFileSync(join(ROOT, FX, 'osv.json'), 'utf8')), '/work/app')
    expect(f).toHaveLength(2)
    expect(f[0]).toMatchObject({ severity: 'high', rule: 'ghsa-xvch-5gv4-984h', file: 'package-lock.json' })
    expect(f[0].message).toContain('fixed in 1.2.6')
    expect(f[1]).toMatchObject({ severity: 'medium', rule: 'rustsec-2022-0013' })
    expect(f[1].message).toContain('no fixed version')
  })

  test('semgrep: check id, path, line, message, severity mapping, confidence high', () => {
    const f = parseSemgrep(JSON.parse(readFileSync(join(ROOT, FX, 'semgrep.json'), 'utf8')))
    expect(f.map((x: any) => [x.severity, x.file, x.line])).toEqual([['medium', 'src/run.js', 12], ['high', 'app/views.py', 40]])
    expect(f[0].message).toContain('javascript.lang.security.audit.eval-detected.eval-detected')
    expect(f[0].message).toContain('confidence high')
    for (const x of f) expect(x.rule).toMatch(/^[a-z0-9][a-z0-9-]{0,60}$/)
  })

  test('clippy: only clippy:: lints, not plain rustc warnings', () => {
    const f = parseClippy(readFileSync(join(ROOT, FX, 'clippy.jsonl'), 'utf8'))
    expect(f.map((x: any) => x.rule)).toEqual(['clippy-absurd-extreme-comparisons', 'clippy-suspicious-else-formatting'])
    expect(f[0]).toMatchObject({ severity: 'high', file: 'src/main.rs', line: 5 })
  })

  test('tsc: rule tsc-<code>', () => {
    const f = parseTsc(readFileSync(join(ROOT, FX, 'tsc.txt'), 'utf8'))
    expect(f.map((x: any) => x.rule)).toEqual(['tsc-2322', 'tsc-7006', 'tsc-2345'])
    expect(f[0]).toMatchObject({ file: 'src/a.ts', line: 10 })
  })

  test('ruleId keeps ids valid and bounded', () => {
    expect(ruleId('A.B_c/d')).toBe('a-b-c-d')
    expect(ruleId('x'.repeat(200)).length).toBeLessThanOrEqual(61)
  })
})

describe('the script: findings, clean, NOT RUN', () => {
  const cases: [string, string, string][] = [
    ['osv-scan', 'osv.json', 'osv-clean.json'],
    ['semgrep-security', 'semgrep.json', 'semgrep-clean.json'],
    ['clippy-correctness', 'clippy.jsonl', 'clippy-clean.jsonl'],
    ['tsc-strict', 'tsc.txt', 'tsc-clean.txt'],
  ]
  for (const [id, bad, clean] of cases) {
    test(`${id}: findings fail with valid finding lines`, () => {
      const r = run([id, '--sample', join(FX, bad)])
      expect(r.code).toBe(1)
      expect(r.findings.length).toBeGreaterThan(0)
      for (const l of r.findings) expect(parseFindingLine(l), l).toBeTruthy()
    })
    test(`${id}: clean output passes`, () => {
      const r = run([id, '--sample', join(FX, clean)])
      expect(r.code).toBe(0)
      expect(r.findings).toHaveLength(0)
    })
  }

  test('a missing tool is NOT RUN (75) with an install hint, never a pass', () => {
    const env = { PATH: '', Path: '' }
    const dir = emptyDir()
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n')
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    for (const [id, hint] of [['osv-scan', 'osv-scanner'], ['semgrep-security', 'pip install semgrep'], ['clippy-correctness', 'rustup'], ['tsc-strict', 'npm i -D typescript']] as const) {
      const r = run([id, '--root', dir], env)
      expect(r.code, `${id}: ${r.out}`).toBe(75)
      expect(r.out).toContain('NOT RUN')
      expect(r.out).toContain(hint)
    }
  })

  test('clippy without Cargo.toml and tsc without tsconfig are not applicable (pass)', () => {
    const dir = emptyDir()
    expect(run(['clippy-correctness', '--root', dir]).code).toBe(0)
    expect(run(['tsc-strict', '--root', dir]).code).toBe(0)
  })

  test('tsc is capped at 200 findings with a rollup', () => {
    const dir = emptyDir()
    const file = join(dir, 'many.txt')
    writeFileSync(file, Array.from({ length: 250 }, (_, i) => `src/f.ts(${i + 1},1): error TS2322: bad ${i}`).join('\n'))
    const r = run(['tsc-strict', '--sample', file])
    expect(r.code).toBe(1)
    expect(r.findings).toHaveLength(201)
    expect(r.findings[200]).toContain('50 more')
  })
})

describe('the pack', () => {
  test('loads, all four checks are opt-in thorough checks with a self-test', async () => {
    const checks = (await loadChecks(join(ROOT, 'packs/detectors'))) as any[]
    const mine = checks.filter((c) => ['osv-scan', 'semgrep-security', 'clippy-correctness', 'tsc-strict'].includes(c.id))
    expect(mine).toHaveLength(4)
    for (const c of mine) {
      expect(c.optIn).toBe('detectors')
      expect(c.tier).toBe('thorough')
      expect(c.selfTest.expectFail).toBe(true)
    }
    expect(checks.some((c) => String(c.id).startsWith('bad-check-file'))).toBe(false)
  })
})
