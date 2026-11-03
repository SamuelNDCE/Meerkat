// The generator reports false alarms on clean twins from FALSE-ALARM lines; the corpus side counts only bug severities.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const FAKE = [
  'running node-api',
  'running node-api-clean',
  'running py-service-clean',
  'OK   node-api:js-eval [risky-code] server.js:19 => risky-code/risky-call',
  'MISS node-api:js-cors-wildcard [cors-wildcard] server.js:12 => ',
  'FALSE-ALARM node-api-clean risky-code/risky-call server.js:19',
  'FALSE-ALARM node-api-clean empty-catch/- server.js:63',
  'FALSE-ALARM-TOTAL 2 across 2 twins',
  '',
].join('\n')

describe('clean twin false alarms', () => {
  test('the results document gets the section, the total, the per-twin count and the lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-twinfa-'))
    const input = join(dir, 'run.txt')
    const out = join(dir, 'results.md')
    writeFileSync(input, FAKE)
    execFileSync(process.execPath, [join(root, 'tools', 'gen-accuracy-results.mjs'), input, '--out', out, '--readme', join(dir, 'readme.md')], { cwd: root, stdio: 'pipe' })
    const md = readFileSync(out, 'utf8')
    expect(md).toContain('## False alarms on clean twins')
    expect(md).toContain('- Clean-twin false alarms: 2 across 2 clean twins')
    expect(md).toContain('Total: 2 false alarms across 2 clean twins.')
    expect(md).toContain('| node-api-clean | 2 |')
    expect(md).toContain('- node-api-clean risky-code/risky-call server.js:19')
    expect(md).toContain('- node-api-clean empty-catch/- server.js:63')
    expect(md).toContain('## Recall by tier')
  })

  test('only critical, high and medium findings on clean twins are printed and counted', async () => {
    const { falseAlarmReport } = await import(pathToFileURL(join(root, 'tools', 'accuracy-corpus.mjs')).href)
    const f = (severity: string, check: string, line: number) => ({ severity, check, rule: null, file: 'a.js', line })
    const r = falseAlarmReport({
      'x-clean': { findings: { findings: [f('high', 'c1', 3), f('low', 'c2', 4), f('info', 'c3', 5), f('medium', 'c4', 6)] } },
      'x': { findings: { findings: [f('critical', 'c5', 1)] } },
    })
    expect(r.lines).toEqual(['FALSE-ALARM x-clean c1/- a.js:3', 'FALSE-ALARM x-clean c4/- a.js:6', 'FALSE-ALARM-TOTAL 2 across 1 twins'])
    expect(r.notes).toBe(2)
  })
})
