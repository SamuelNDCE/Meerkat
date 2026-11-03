// Rules whose only signal is the shape of the code are reported as info, not as bugs (lib/findings.mjs RULE_SEVERITY). The detection is unchanged:
// the finding is still printed, only its severity differs. A rule outside the list keeps the severity it had.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { RULE_SEVERITY } from '../lib/findings.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { CHECK_TABLES } from '../thorough/rules-code-patterns.mjs'

const root = join(__dirname, '..')
const INFO_RULES = ['py-bind-all-interfaces', 'py-jinja-autoescape-off', 'py-shelve-open', 'js-template-no-escape', 'js-helmet-csp-off', 'rb-csrf-skipped', 'go-weak-crypto-import', 'go-md4-md5-sha1', 'java-weak-digest', 'cs-weak-hash', 'rb-weak-digest', 'go-math-rand-import', 'cs-cookie-insecure', 'cs-antiforgery-ignored']
const work = mkdtempSync(join(tmpdir(), 'meerkat-info-rules-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

// Runs the real check on the rule's own bad sample and returns the severity printed on the finding line for that rule.
function severityPrinted(ruleId: string): { severity: string | null; sub: boolean } {
  for (const [checkId, table] of Object.entries(CHECK_TABLES) as [string, any[]][]) {
    const rule = table.find((r) => r.id === ruleId)
    if (!rule) continue
    const dir = join(work, ruleId)
    const file = join(dir, rule.files ? 'src/lib.rs' : `sample.${rule.ext[0]}`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, rule.bad)
    let out = ''
    try {
      out = execFileSync(process.execPath, [join(root, 'thorough', 'code-patterns.mjs'), checkId, '--root', dir], { encoding: 'utf8' })
    } catch (e: any) {
      out = String(e.stdout ?? '') // a check that finds something exits 1
    }
    const m = out.split(/\r?\n/).find((l) => l.startsWith('MEERKAT-FINDING ') && l.split(' ')[2] === ruleId)
    return { severity: m ? m.split(' ')[1] : null, sub: out.includes(`MEERKAT-SUB FAIL ${ruleId} `) }
  }
  throw new Error(`no rule ${ruleId}`)
}

describe('shape-only rules are reported as info, not as bugs', () => {
  for (const id of INFO_RULES) {
    test(`${id} is listed as info and still found, printed at info`, () => {
      expect(RULE_SEVERITY[id]).toBe('info')
      const r = severityPrinted(id)
      expect(r.sub, 'the rule still finds its bad sample').toBe(true)
      expect(r.severity).toBe('info')
      expect(['critical', 'high', 'medium']).not.toContain(r.severity)
    })
  }
  test('a planted bug for a check outside the list keeps its severity', () => {
    for (const id of ['py-exec-text', 'go-sql-built-string', 'js-exec-variable']) {
      expect(INFO_RULES).not.toContain(id)
      expect(RULE_SEVERITY[id]).toBeUndefined()
      expect(severityPrinted(id).severity, id).toBe('medium')
    }
  })
})
