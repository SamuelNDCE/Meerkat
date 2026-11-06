import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { dataRuleChecks, loadRuleFile, scanRules, selfTestRule } from './datarules.mjs'

const PACK = fileURLToPath(new URL('../packs/c-cpp/rules.json', import.meta.url))

test('every rule in the c-cpp pack is valid and passes its self-test', () => {
  const { rules, errors } = loadRuleFile(PACK)
  expect(errors).toEqual([])
  expect(rules.length).toBe(7)
  for (const r of rules) expect(selfTestRule(r), r.id).toMatchObject({ ok: true })
})

test('an invalid rule is reported by loadRuleFile', () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-dr-'))
  try {
    const f = join(d, 'r.json')
    writeFileSync(f, JSON.stringify({ rules: [{ id: 'Bad Id', severity: 'huge', glob: '*.c', pattern: '(', message: 'm', title: 't', bad: '', good: 'x' }] }))
    const { rules, errors } = loadRuleFile(f)
    expect(rules).toEqual([])
    expect(errors.length).toBe(1)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('scanRules finds a planted gets() and ignores a commented one', () => {
  const { rules } = loadRuleFile(PACK)
  const found = scanRules(rules, [{ path: 'src/a.c', text: 'int main() {\n  // gets(buf);\n  gets(buf);\n}\n' }])
  expect(found).toHaveLength(1)
  expect(found[0]).toMatchObject({ rule: 'c-gets', file: 'src/a.c', line: 3, severity: 'high' })
})

test('a glob that does not match gives no findings', () => {
  const { rules } = loadRuleFile(PACK)
  expect(scanRules(rules, [{ path: 'src/a.py', text: 'gets(buf);\n' }])).toEqual([])
})

test('a check fails its self-test (as the runner expects) and runs clean on an empty repo', () => {
  const { rules } = loadRuleFile(PACK)
  const checks = dataRuleChecks(rules, { trackedFiles: () => [], readText: () => null })
  expect(checks[0].selfTest()).toMatchObject({ ok: false })
  expect(checks[0].run({ repoRoot: '.' })).toMatchObject({ ok: true, detail: 'clean' })
})
