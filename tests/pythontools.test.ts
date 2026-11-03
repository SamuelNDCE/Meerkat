// pip-audit, vulture and radon (the detectors pack): REAL recorded output of each tool becomes findings, the clean twin passes, both sides are
// tested, offline mode and a missing tool are NOT RUN, and the Python findings merge with Meerkat's own through lib/confirm-classes.mjs.
// The end-to-end tests run the real tools from ~/.meerkat-tools/python (or PATH) and are skipped when a tool is not installed.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'
import { parseFindingLine } from '../lib/findings.mjs'
// @ts-expect-error plain JS module
import { confirmFindings } from '../lib/confirm.mjs'
// @ts-expect-error plain JS module
import { classOf } from '../lib/confirm-classes.mjs'
// @ts-expect-error plain JS module
import { parsePipAudit, parseRadon, parseVulture, pipAuditSkipped, radonMinRank, requirementsOf, vultureConfidence } from '../thorough/detectors.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FX = 'tests/fixtures/detectors'
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-py-'))
  made.push(d)
  return d
}
function run(args: string[], env: Record<string, string> = {}, cwd = ROOT) {
  const r = spawnSync(process.execPath, [join(ROOT, 'thorough/detectors.mjs'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  const out = `${r.stdout}${r.stderr}`
  return { code: r.status, out, findings: out.split(/\r?\n/).filter((l) => l.startsWith('MEERKAT-FINDING')) }
}
const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' })
const toolsHome = process.env.MEERKAT_TOOLS_HOME || join(homedir(), '.meerkat-tools')
const have = (bin: string) => [join(toolsHome, 'python', 'Scripts', `${bin}.exe`), join(toolsHome, 'python', 'bin', bin)].some(existsSync)
const PLANTED_PY = `import os


def classify(a, b, c, d, e, f):
    score = 0
${'abcdef'.split('').map((v) => `    if ${v} > 0 and ${v} < 10 or ${v} == 99:\n        score += 1\n    elif ${v} < -5:\n        score -= 1\n`).join('')}    for x in (a, b, c):
        if x and score > 2 or x is None:
            score += 1
    return score
`
const CLEAN_PY = 'import sys\n\n\ndef main():\n    return sys.argv\n\n\ndef add(a, b):\n    return a + b\n\n\nif __name__ == "__main__":\n    print(add(1, len(main())))\n'

describe('pip-audit (real output from pip-audit 2.10.1)', () => {
  const bad = JSON.parse(readFileSync(join(ROOT, FX, 'pip-audit.json'), 'utf8'))
  test('one finding per package and advisory id, repeats folded, ids and fixed versions in the message', () => {
    const items = parsePipAudit(bad, 'requirements.txt')
    // the recorded output lists PYSEC-2018-28 and PYSEC-2023-74 twice each
    expect(bad.dependencies[0].vulns.length).toBeGreaterThan(items.length)
    expect(new Set(items.map((i: any) => i.rule)).size).toBe(items.length)
    expect(items[0]).toMatchObject({ severity: 'high', rule: 'pysec-2018-28', file: 'requirements.txt', line: 0 })
    expect(items[0].message).toContain('requests@2.19.0')
    expect(items[0].message).toContain('CVE-2018-18074')
    expect(items[0].message).toContain('fixed in 2.20.0')
  })
  test('no known vulnerability gives nothing; a skipped dependency is reported as not audited, never as clean', () => {
    expect(parsePipAudit({ dependencies: [{ name: 'requests', version: '2.34.2', vulns: [] }], fixes: [] })).toEqual([])
    const skip = { dependencies: [{ name: 'x', skip_reason: 'Dependency not found on PyPI and could not be audited: x (1.0)' }] }
    expect(parsePipAudit(skip)).toEqual([])
    expect(pipAuditSkipped(skip)[0]).toContain('not found on PyPI')
  })
  test('a vulnerability with no fixed version is medium, not high', () => {
    const j = { dependencies: [{ name: 'p', version: '1', vulns: [{ id: 'PYSEC-2000-1', fix_versions: [], aliases: [], description: 'x' }] }] }
    expect(parsePipAudit(j)[0].severity).toBe('medium')
  })
  test('only requirements files are audited', () => {
    expect(requirementsOf(['a/requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'x.py'])).toEqual(['a/requirements.txt', 'requirements-dev.txt'])
  })
  test('the script: findings fail with valid lines, the clean twin passes', () => {
    const r = run(['pip-audit-python', '--sample', join(FX, 'pip-audit.json')])
    expect(r.code).toBe(1)
    expect(r.findings.length).toBe(5)
    for (const l of r.findings) expect(parseFindingLine(l), l).toBeTruthy()
    const c = run(['pip-audit-python', '--sample', join(FX, 'pip-audit-clean.json')])
    expect(c.code).toBe(0)
    expect(c.findings).toHaveLength(0)
  })
  test('offline mode skips it with a clear note (NOT RUN, 75), because it contacts PyPI', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'requirements.txt'), 'requests==2.19.0\n')
    git(dir, 'init', '-q')
    git(dir, 'add', '.')
    const r = run(['pip-audit-python', '--root', dir], { MEERKAT_DETECTORS_OFFLINE: '1' })
    expect(r.code).toBe(75)
    expect(r.out).toContain('MEERKAT_DETECTORS_OFFLINE=1')
    expect(r.out).toContain('PyPI')
  })
  test.skipIf(!have('pip-audit'))('end to end with the real tool: a pinned clean requirement passes, a not-pinned one is "not audited" and never a pass', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'requirements.txt'), 'requests>=2\n')
    git(dir, 'init', '-q')
    git(dir, 'add', '.')
    const r = run(['pip-audit-python', '--root', dir, '--sample', join(ROOT, FX, 'pip-audit-clean.json')])
    expect(r.code).toBe(0)
    const real = run(['pip-audit-python', '--root', dir])
    expect(real.code).toBe(75)
    expect(real.out).toContain('could not audit any requirements file')
  })
})

describe('vulture (real output from vulture 2.16)', () => {
  const text = readFileSync(join(ROOT, FX, 'vulture.txt'), 'utf8')
  test('keeps 80 percent and above by default: the unused import is reported, the 60 percent function is not', () => {
    const items = parseVulture(text, '')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ rule: 'vulture-unused-import', line: 1, file: 'broken/app.py', severity: 'low' })
    expect(parseVulture(text, '', 60).map((i: any) => i.rule)).toEqual(['vulture-unused-import', 'vulture-unused-function'])
    expect(vultureConfidence({ MEERKAT_VULTURE_MIN_CONFIDENCE: '60' })).toBe(60)
    expect(vultureConfidence({ MEERKAT_VULTURE_MIN_CONFIDENCE: 'x' })).toBe(80)
  })
  test('the script: findings fail, the clean twin (empty output) passes', () => {
    const r = run(['vulture-dead-code', '--sample', join(FX, 'vulture.txt')])
    expect(r.code).toBe(1)
    for (const l of r.findings) expect(parseFindingLine(l), l).toBeTruthy()
    expect(run(['vulture-dead-code', '--sample', join(FX, 'vulture-clean.txt')]).code).toBe(0)
  })
  test.skipIf(!have('vulture'))('end to end with the real tool: planted file fails, clean twin passes', () => {
    const bad = tmp()
    writeFileSync(join(bad, 'app.py'), PLANTED_PY)
    git(bad, 'init', '-q')
    git(bad, 'add', '.')
    const r = run(['vulture-dead-code', '--root', bad])
    expect(r.code).toBe(1)
    expect(r.out).toContain('vulture-unused-import')
    const good = tmp()
    writeFileSync(join(good, 'app.py'), CLEAN_PY)
    git(good, 'init', '-q')
    git(good, 'add', '.')
    expect(run(['vulture-dead-code', '--root', good]).code).toBe(0)
  })
})

describe('radon (real output from radon 6.0.1)', () => {
  const json = JSON.parse(readFileSync(join(ROOT, FX, 'radon.json'), 'utf8'))
  test('reports rank D and worse by default with the score', () => {
    const items = parseRadon(json, '', 'D')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ rule: 'radon-cc-d', line: 4, file: 'broken/app.py', severity: 'low' })
    expect(items[0].message).toContain('complexity 29')
    expect(parseRadon(json, '', 'F')).toHaveLength(0)
    expect(radonMinRank({ MEERKAT_RADON_MIN_RANK: 'C' })).toBe('C')
    expect(radonMinRank({ MEERKAT_RADON_MIN_RANK: 'Z' })).toBe('D')
  })
  test('a method listed both under its class and at top level is reported once; a file radon could not parse is counted', () => {
    const m = { type: 'method', rank: 'E', classname: 'K', name: 'm', complexity: 35, lineno: 9, methods: [], closures: [] }
    const j = { 'a.py': [{ type: 'class', rank: 'A', name: 'K', complexity: 2, lineno: 8, methods: [m], closures: [] }, m], 'b.py': { error: 'invalid syntax' } }
    const items = parseRadon(j, '', 'D')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ severity: 'medium', rule: 'radon-cc-e' })
    expect(items.errors).toBe(1)
  })
  test('the script: findings fail, the clean twin passes', () => {
    const r = run(['radon-complexity', '--sample', join(FX, 'radon.json')])
    expect(r.code).toBe(1)
    for (const l of r.findings) expect(parseFindingLine(l), l).toBeTruthy()
    expect(run(['radon-complexity', '--sample', join(FX, 'radon-clean.json')]).code).toBe(0)
  })
  test.skipIf(!have('radon'))('end to end with the real tool: planted file fails, clean twin passes', () => {
    const bad = tmp()
    writeFileSync(join(bad, 'app.py'), PLANTED_PY)
    git(bad, 'init', '-q')
    git(bad, 'add', '.')
    const r = run(['radon-complexity', '--root', bad])
    expect(r.code).toBe(1)
    expect(r.out).toContain('radon-cc-d')
    const good = tmp()
    writeFileSync(join(good, 'app.py'), CLEAN_PY)
    git(good, 'init', '-q')
    git(good, 'add', '.')
    expect(run(['radon-complexity', '--root', good]).code).toBe(0)
  })
})

describe('missing tools and the pack', () => {
  test('each tool missing is NOT RUN (75) with its install hint, never a pass', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'requirements.txt'), 'requests==2.19.0\n')
    writeFileSync(join(dir, 'app.py'), CLEAN_PY)
    git(dir, 'init', '-q')
    git(dir, 'add', '.')
    const env = { PATH: '', Path: '', MEERKAT_TOOLS_HOME: join(dir, 'no-tools') }
    for (const [id, hint] of [['pip-audit-python', 'pip install pip-audit'], ['vulture-dead-code', 'pip install vulture'], ['radon-complexity', 'pip install radon']] as const) {
      const r = run([id, '--root', dir], env)
      expect(r.code, `${id}: ${r.out}`).toBe(75)
      expect(r.out).toContain(hint)
    }
  })
  test('a folder with no Python is not applicable (pass)', () => {
    const dir = tmp()
    git(dir, 'init', '-q')
    for (const id of ['pip-audit-python', 'vulture-dead-code', 'radon-complexity']) expect(run([id, '--root', dir]).code, id).toBe(0)
  })
  test('the three checks are opt-in thorough checks with a self-test that expects the right reason', async () => {
    const checks = (await loadChecks(join(ROOT, 'packs/detectors'))) as any[]
    for (const id of ['pip-audit-python', 'vulture-dead-code', 'radon-complexity']) {
      const c = checks.find((x) => x.id === id)
      expect(c, id).toBeTruthy()
      expect(c.optIn).toBe('detectors')
      expect(c.tier).toBe('thorough')
      expect(c.selfTest.expectFail).toBe(true)
      expect(c.selfTest.expectMatch).toBeTruthy()
    }
  })
})

describe('one site or one advisory reported by two checks is one finding', () => {
  let n = 0
  const f = (over: Record<string, unknown>) => ({ id: `p${++n}`, severity: 'low', suite: 'x', check: 'a', rule: null, file: 'app.py', line: 4, lines: [4], occurrences: 1, message: 'm', confidence: 'medium', ...over })
  const merge = (list: any[]) => {
    const map = new Map(list.map((x) => [x.id, x]))
    confirmFindings(map)
    return [...map.values()]
  }
  test('the rule families are known', () => {
    expect(classOf({ rule: 'vulture-unused-import' })).toBe('dead-code')
    expect(classOf({ rule: 'dead-code' })).toBe('dead-code')
    expect(classOf({ rule: 'radon-cc-d' })).toBe('complexity')
    expect(classOf({ rule: 'cyclomatic-complexity' })).toBe('complexity')
  })
  test('vulture and Meerkat\'s dead-code rule at the same line merge; a different line, a line of 0 or a different class do not', () => {
    expect(merge([f({ check: 'vulture-dead-code', rule: 'vulture-unused-function' }), f({ check: 'refactor', rule: 'dead-code' })])).toHaveLength(1)
    expect(merge([f({ check: 'vulture-dead-code', rule: 'vulture-unused-function' }), f({ check: 'refactor', rule: 'dead-code', line: 40, lines: [40] })])).toHaveLength(2)
    expect(merge([f({ check: 'vulture-dead-code', rule: 'vulture-unused-function', line: 0 }), f({ check: 'refactor', rule: 'dead-code', line: 0 })])).toHaveLength(2)
    expect(merge([f({ check: 'vulture-dead-code', rule: 'vulture-unused-function' }), f({ check: 'radon-complexity', rule: 'radon-cc-d' })])).toHaveLength(2)
  })
  test('radon and Meerkat\'s cyclomatic-complexity rule at the same function merge', () => {
    const out = merge([f({ check: 'radon-complexity', rule: 'radon-cc-d' }), f({ check: 'quality', rule: 'cyclomatic-complexity' })])
    expect(out).toHaveLength(1)
    expect(out[0].confirmations).toBe(2)
  })
  test('pip-audit and osv-scan on the same PYSEC advisory and package merge; another package does not', () => {
    const a = f({ check: 'pip-audit-python', rule: 'pysec-2018-28', file: 'requirements.txt', line: 0, severity: 'high', message: 'requests@2.19.0 (PyPI) is vulnerable: PYSEC-2018-28 (CVE-2018-18074)' })
    const b = f({ check: 'osv-scan', rule: 'pysec-2018-28', file: 'requirements.txt', line: 0, severity: 'high', message: 'requests@2.19.0 (PyPI) is vulnerable: PYSEC-2018-28' })
    expect(merge([a, b])).toHaveLength(1)
    const c = f({ check: 'osv-scan', rule: 'pysec-2018-28', file: 'requirements.txt', line: 0, severity: 'high', message: 'flask@1.0 (PyPI) is vulnerable: PYSEC-2018-28' })
    expect(merge([a, c])).toHaveLength(2)
  })
})
