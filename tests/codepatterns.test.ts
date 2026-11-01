// The code-pattern checks (thorough/code-patterns.mjs): every rule proves itself, each check fails on its own fixture and passes
// on good code, regexes stay fast on hostile input, and the pack loads with no bad-check-file entries.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { selfProve } from '../thorough/rules.mjs'
// @ts-expect-error plain JS module
import { CHECK_TABLES } from '../thorough/rules-code-patterns.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/code-patterns.mjs'
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

const IDS = Object.keys(CHECK_TABLES) as string[]
const table = (id: string): any[] => CHECK_TABLES[id]

// Runs the check script; returns its exit code and its stdout (a crash is reported as code -1 with the error text).
function runCheck(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

// The file a rule's sample is written to, named for the rule's own extension (the runner uses the same naming).
const sampleName = (r: any, i: number) => `s${i}/${r.files ? 'src/lib.rs' : `sample.${r.ext[0]}`}`

// A folder holding one good sample per rule: no rule of the check may fire on it.
function cleanFolder(id: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-cp-'))
  made.push(dir)
  table(id).forEach((r: any, i: number) => {
    const p = join(dir, sampleName(r, i))
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, r.good)
  })
  return dir
}

describe('every rule proves itself', () => {
  for (const id of IDS) {
    test(`${id}: bad sample is found, good sample is not, ids are unique`, () => {
      expect(selfProve(table(id))).toEqual([])
    })
  }
  test('the total is at least 150 rules, and each check has 8 to 40', () => {
    const total = IDS.reduce((n, id) => n + table(id).length, 0)
    expect(total).toBeGreaterThanOrEqual(150)
    for (const id of IDS) {
      expect(table(id).length).toBeGreaterThanOrEqual(8)
      expect(table(id).length).toBeLessThanOrEqual(40)
    }
  })
  test('rule ids carry a family prefix and are unique across the checks', () => {
    const all = IDS.flatMap((id) => table(id).map((r: any) => r.id))
    expect(new Set(all).size).toBe(all.length)
    expect(all.every((x: string) => /^(py|js|go|rs|java|cs|php|rb)-/.test(x))).toBe(true)
  })
})

describe('each check fails on its own fixture', () => {
  for (const id of IDS) {
    test(`${id} --fixtures exits 1`, () => {
      expect(runCheck([id, '--fixtures']).code).toBe(1)
    })
  }
})

describe('each check passes on good code and prints one sub-check line per rule', () => {
  for (const id of IDS) {
    test(`${id} on a clean folder exits 0 with PASS or NA lines`, () => {
      const dir = cleanFolder(id)
      const r = runCheck([id, '--root', dir])
      expect(r.code).toBe(0)
      const subs = r.out.split('\n').filter((l) => l.startsWith('MEERKAT-SUB '))
      expect(subs).toHaveLength(table(id).length)
      expect(subs.every((l) => /^MEERKAT-SUB (PASS|NA) /.test(l))).toBe(true)
    })
  }
})

describe('hostile input stays fast', () => {
  const hostile = [
    'a'.repeat(100_000),
    '('.repeat(50_000) + 'a+'.repeat(20_000),
    'subprocess.run(' .repeat(6_000),
    'exec('.repeat(15_000),
    '"'.repeat(50_000) + '\u202a'.repeat(20_000),
    'checkServerTrusted('.repeat(6_000) + ' {',
    'requests.get('.repeat(8_000),
  ]
  for (const id of IDS) {
    test(`${id}: every rule finishes 7 hostile 100 KB lines in under 2 seconds`, () => {
      const started = Date.now()
      for (const r of table(id)) {
        for (const line of hostile) {
          const ctx = { file: 'x', lines: [line], index: 0, text: line }
          if (r.test) r.test(line, ctx)
          else r.re.test(line)
        }
      }
      expect(Date.now() - started).toBeLessThan(2000)
    })
  }
})

describe('the code-patterns pack', () => {
  test('loads 6 checks with no bad-check-file entries, and subs match each table', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'code-patterns'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks.map((c) => c.id).sort()).toEqual([...IDS].sort())
    for (const c of checks) expect(c.subs).toBe(table(c.id).length)
  })
})


// @ts-expect-error plain JS module
import { evaluate as reviewEvaluate } from '../thorough/rules.mjs'
// @ts-expect-error plain JS module
import { JS as reviewJS, GO as reviewGO, PY as reviewPY, RS as reviewRS } from '../thorough/rules-code-patterns.mjs'

const reviewFound = (rules: any[], file: string, text: string) => reviewEvaluate('.', rules, { files: [file], read: () => text }).found.map((f: any) => f.rule)

describe('regressions found in review', () => {
  test('a rule with its own files pattern reads only those files, even though the family sets ext', () => {
    const rules = reviewRS.filter((r: any) => r.id === 'rs-unwrap-in-library')
    expect(reviewFound(rules, 'src/other.rs', 'let v = x.unwrap();')).toEqual([])
    expect(reviewFound(rules, 'src/lib.rs', 'let v = x.unwrap();')).toEqual(['rs-unwrap-in-library'])
    expect(reviewFound(rules, 'src/lib.rs', '#[cfg(test)]\nmod tests {\n let v = x.unwrap();\n}')).toEqual([])
  })
  test('timing-unsafe compare flags secret versus variable only', () => {
    const f = (t: string) => reviewFound(reviewJS, 'a.js', t).includes('js-timing-unsafe-compare')
    expect(f('if (req.authToken === expected) ok()')).toBe(true)
    expect(f("if (typeof o.password !== 'string') bad()")).toBe(false)
    expect(f('if (MIN_PASSWORD === 12) ok()')).toBe(false)
    expect(f("if (r.signature === 'f0e8bd') ok()")).toBe(false)
  })
  test('Go: mode 0777 is world-writable, and tokenType is not a secret', () => {
    expect(reviewFound(reviewGO, 'a.go', 'os.WriteFile(p, d, 0777)')).toContain('go-world-writable-mode')
    expect(reviewFound(reviewGO, 'a.go', 'tokenType := "bearer-token"')).not.toContain('go-hardcoded-secret')
    expect(reviewFound(reviewGO, 'a.go', 'password := "hunter22"')).toContain('go-hardcoded-secret')
  })
  test('Python: an annotated hardcoded password is found', () => {
    expect(reviewFound(reviewPY, 'a.py', 'db_password: str = "s3cretvalue"')).toContain('py-hardcoded-password')
  })
  test('JS: a regex character class listing hidden characters is not a hidden character', () => {
    const line = 'const INVISIBLE = /[' + String.fromCharCode(0x202a) + '-' + String.fromCharCode(0x202e) + ']/g'
    expect(reviewFound(reviewJS, 'a.js', line)).not.toContain('js-hidden-bidi-control')
    expect(reviewFound(reviewJS, 'a.js', 'const role = "admin' + String.fromCharCode(0x202e) + '"')).toContain('js-hidden-bidi-control')
  })
})

