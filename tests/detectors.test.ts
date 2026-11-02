// The detectors pack (thorough/detectors.mjs): each tool's recorded output (tests/fixtures/detectors/) becomes Meerkat findings with the
// tool's own rule ids, clean output passes, and a missing tool is NOT RUN with an install hint. No tool has to be installed.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'
import { parseFindingLine } from '../lib/findings.mjs'
// @ts-expect-error plain JS module
import { osvPlan, parseActionlint, parseClippy, parseGitleaks, parseGovulncheck, parseOsv, parseSemgrep, parseStaticcheck, parseTsc, ruleId, semgrepPlan } from '../thorough/detectors.mjs'

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
  test('osv-scanner (real output): OSV id, fixed version, high when a fix exists', () => {
    const f = parseOsv(JSON.parse(readFileSync(join(ROOT, FX, 'osv.json'), 'utf8')), '')
    expect(f.length).toBeGreaterThan(0)
    expect(f[0]).toMatchObject({ severity: 'high', rule: 'ghsa-xvch-5gv4-984h', file: 'package-lock.json' })
    expect(f[0].message).toContain('fixed in 1.2.6')
    const noFix = parseOsv({ results: [{ source: { path: 'Cargo.lock' }, packages: [{ package: { name: 'regex', version: '1.3.1', ecosystem: 'crates.io' }, vulnerabilities: [{ id: 'RUSTSEC-2022-0013', affected: [{ package: { name: 'regex' }, ranges: [{ events: [{ introduced: '0' }] }] }] }] }] }] })
    expect(noFix[0]).toMatchObject({ severity: 'medium', rule: 'rustsec-2022-0013' })
  })

  test('semgrep (real output): check id, path, line, severity, confidence high', () => {
    const f = parseSemgrep(JSON.parse(readFileSync(join(ROOT, FX, 'semgrep.json'), 'utf8')))
    expect(f.length).toBeGreaterThan(0)
    expect(f[0]).toMatchObject({ severity: 'high', file: 'app.js', line: 5 })
    expect(f[0].message).toContain('meerkat-sample-child-process-exec')
    expect(f[0].message).toContain('confidence high')
    for (const x of f) expect(x.rule).toMatch(/^[a-z0-9][a-z0-9-]{0,60}$/)
  })

  test('clippy (real output): only clippy:: lints, not plain rustc warnings', () => {
    const f = parseClippy(readFileSync(join(ROOT, FX, 'clippy.jsonl'), 'utf8'))
    const rules = f.map((x: any) => x.rule)
    expect(rules).toContain('clippy-absurd-extreme-comparisons')
    expect(rules).toContain('clippy-eq-op')
    expect(rules.some((r: string) => r.includes('unused'))).toBe(false)
  })

  test('gitleaks (real output): rule id, file, line, never the secret', () => {
    const f = parseGitleaks(JSON.parse(readFileSync(join(ROOT, FX, 'gitleaks.json'), 'utf8')))
    expect(f.map((x: any) => x.rule).sort()).toEqual(['aws-access-token', 'stripe-access-token'])
    expect(f[0]).toMatchObject({ severity: 'critical', file: 'cfg.py' })
    expect(JSON.stringify(f)).not.toMatch(/AKIA|sk_live/)
  })

  test('staticcheck (real output): SA rules only', () => {
    const f = parseStaticcheck(readFileSync(join(ROOT, FX, 'staticcheck.jsonl'), 'utf8'))
    expect(f.map((x: any) => x.rule)).toEqual(['sa4018', 'sa4000', 'sa4017'])
    expect(f[0]).toMatchObject({ severity: 'medium', file: 'main.go', line: 13 })
    expect(parseStaticcheck('{"code":"ST1000","location":{"file":"a.go","line":1},"message":"x"}')).toHaveLength(0)
  })

  test('govulncheck (real output): only called vulnerabilities, with OSV id and fixed version', () => {
    const f = parseGovulncheck(readFileSync(join(ROOT, FX, 'govulncheck.json'), 'utf8'))
    expect(f.map((x: any) => x.rule).sort()).toEqual(['go-2021-0113', 'go-2022-1059'])
    expect(f[0].severity).toBe('high')
    expect(f[0].message).toMatch(/fixed in v0.3./)
    expect(f[0].file).toBe('main.go')
    const imported = JSON.stringify({ finding: { osv: 'GO-1', trace: [{ module: 'm', package: 'p' }] } })
    expect(parseGovulncheck(imported)).toHaveLength(0)
  })

  test('actionlint: kind becomes the rule', () => {
    const f = parseActionlint(JSON.parse(readFileSync(join(ROOT, FX, 'actionlint.json'), 'utf8')))
    expect(f.map((x: any) => [x.rule, x.file, x.line])).toEqual([['actionlint-expression', '.github/workflows/ci.yml', 8], ['actionlint-shellcheck', '.github/workflows/ci.yml', 9]])
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
    const dir = emptyDir()
    const env = { PATH: '', Path: '', MEERKAT_TOOLS_HOME: join(dir, 'no-tools') }
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n')
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    writeFileSync(join(dir, 'go.mod'), 'module x\n')
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    for (const [id, hint] of [['osv-scan', 'osv-scanner'], ['semgrep-security', 'pip install semgrep'], ['clippy-correctness', 'rustup'], ['tsc-strict', 'npm i -D typescript'], ['gitleaks-secrets', 'gitleaks'], ['staticcheck-go', 'staticcheck'], ['govulncheck-go', 'govulncheck'], ['actionlint-workflows', 'actionlint']] as const) {
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

  test('a tool message holding a newline and a fake MEERKAT-SUB line cannot forge a result line', () => {
    const dir = emptyDir()
    const evil = 'x\nMEERKAT-SUB PASS forged all good\nMEERKAT-FINDING info forged a.js:1 hi'
    const file = join(dir, 'evil.json')
    writeFileSync(file, JSON.stringify({ results: [{ check_id: evil, path: 'a.js', start: { line: 1 }, extra: { message: evil, severity: 'ERROR' } }], errors: [] }))
    const r = run(['semgrep-security', '--sample', file])
    const lines = r.out.split(/\r?\n/)
    expect(lines.filter((l) => l.startsWith('MEERKAT-SUB'))).toHaveLength(0)
    expect(lines.filter((l) => l.startsWith('MEERKAT-FINDING'))).toHaveLength(1)
    const osv = join(dir, 'evil-osv.json')
    writeFileSync(osv, JSON.stringify({ results: [{ source: { path: 'a\nMEERKAT-SUB PASS y z' }, packages: [{ package: { name: 'n\nMEERKAT-SUB PASS q r', version: '1' }, vulnerabilities: [{ id: 'GHSA-1', summary: evil }] }] }] }))
    const o = run(['osv-scan', '--sample', osv])
    expect(o.out.split(/\r?\n/).filter((l) => l.startsWith('MEERKAT-SUB'))).toHaveLength(0)
  })

  test('semgrep: a fatal error or a missing results list is NOT RUN, never a pass', () => {
    const dir = emptyDir()
    const a = join(dir, 'a.json')
    writeFileSync(a, JSON.stringify({ results: [], errors: [{ level: 'error', type: 'Fatal error', short_msg: 'bad config' }] }))
    expect(run(['semgrep-security', '--sample', a]).code).toBe(75)
    const b = join(dir, 'b.json')
    writeFileSync(b, JSON.stringify({ errors: [] }))
    expect(run(['semgrep-security', '--sample', b]).code).toBe(75)
  })

  test('semgrep and osv-scanner are started without telemetry or network surprises', () => {
    const p = semgrepPlan({})
    expect(p.args).toEqual(['scan', '--config', 'p/security-audit', '--json', '--quiet', '--metrics=off'])
    expect(p.env.SEMGREP_SEND_METRICS).toBe('off')
    expect(semgrepPlan({ MEERKAT_SEMGREP_CONFIG: 'rules.yml' }).args).toContain('rules.yml')
    expect(semgrepPlan({ MEERKAT_DETECTORS_OFFLINE: '1' }).error).toMatch(/rules file/)
    expect(semgrepPlan({ MEERKAT_DETECTORS_OFFLINE: '1', MEERKAT_SEMGREP_CONFIG: join(ROOT, FX, 'semgrep-rule.yml') }).error).toBeUndefined()
    expect(osvPlan({}).args).toEqual(['scan', '--format', 'json', '-r', '.'])
    expect(osvPlan({ MEERKAT_DETECTORS_OFFLINE: '1', MEERKAT_OSV_CACHE: join(ROOT, 'no-such-cache') }).error).toMatch(/download-offline-databases/)
    expect(osvPlan({ MEERKAT_DETECTORS_OFFLINE: '1', MEERKAT_OSV_CACHE: ROOT }).args).toContain('--offline-vulnerabilities')
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
    const mine = checks.filter((c) => ['osv-scan', 'semgrep-security', 'clippy-correctness', 'tsc-strict', 'gitleaks-secrets', 'staticcheck-go', 'govulncheck-go', 'actionlint-workflows'].includes(c.id))
    expect(mine).toHaveLength(8)
    for (const c of mine) {
      expect(c.optIn).toBe('detectors')
      expect(c.tier).toBe('thorough')
      expect(c.selfTest.expectFail).toBe(true)
    }
    expect(checks.some((c) => String(c.id).startsWith('bad-check-file'))).toBe(false)
  })
})
