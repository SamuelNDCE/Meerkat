// meerkat brief (lib/brief.mjs): symbol facts, callers, tests, the one-line honest answers, the JSON version field and the content-hash cache.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { runBrief } from './brief.mjs'

let tmp: string
let app: string
let env: Record<string, string>
function put(rel: string, text: string) {
  mkdirSync(dirname(join(app, rel)), { recursive: true })
  writeFileSync(join(app, rel), text)
}
function git(args: string[]) {
  execFileSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' })
}
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-brief-'))
  app = join(tmp, 'app')
  env = { MEERKAT_LOG_DIR: join(tmp, 'logs') }
  put('package.json', '{"name":"fx"}\n')
  put('src/core/calc.js', 'export function add(a, b) {\n  return a + b\n}\nexport const sub = (a, b) => a - b\n')
  put('src/api/a.js', "import { add } from '../core/calc.js'\nexport const total = (x) => {\n  return add(x, 1)\n}\n")
  put('src/ui/b.js', "import { add } from '../core/calc.js'\nexport function show() {\n  return add(2, 3)\n}\n")
  put('tests/a.test.js', "import { total } from '../src/api/a.js'\nconsole.log(total(1))\n")
  git(['init', '-q'])
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'init'])
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const run = (argv: string[], where = tmp) => {
  const lines: string[] = []
  const errs: string[] = []
  const code = runBrief(argv, { env, cwd: where, out: (l: string) => lines.push(l), err: (l: string) => errs.push(l) })
  return { code, text: lines.join('\n'), errs, json: () => JSON.parse(lines.join('\n')) }
}

describe('brief facts', () => {
  test('a symbol: line, signature, exported, callers with the calling function, tests, risk reasons and a checklist', () => {
    const r = run(['src/core/calc.js#add', '--app', 'app', '--json'])
    expect(r.code).toBe(0)
    const j = r.json()
    expect(j.target).toMatchObject({ symbol: 'add', kind: 'function', line: 1, exported: true, signature: 'export function add(a, b) {' })
    expect(j.callers.files).toBe(2)
    expect(j.callers.list.map((c: { file: string; function: string }) => `${c.file} ${c.function}`)).toEqual(['src/api/a.js total', 'src/ui/b.js show'])
    expect(j.callers.list[0].line).toBe(3)
    expect(j.tests.count).toBe(1)
    expect(j.tests.files[0].file).toBe('tests/a.test.js')
    expect(j.risk.tier).toMatch(/^(low|medium|high)$/)
    expect(j.risk.reasons.length).toBeGreaterThan(3)
    expect(j.checklist.join('\n')).toContain('2 calling files')
  })

  test('the default output is markdown with the risk reasons written out', () => {
    const r = run(['src/core/calc.js#add', '--app', 'app'])
    expect(r.text).toContain('# brief: src/core/calc.js#add')
    expect(r.text).toMatch(/risk: (LOW|MEDIUM|HIGH)/)
    expect(r.text).toContain('before you edit:')
    expect(r.text).toContain('- src/api/a.js:3  total')
  })

  test('a symbol nobody calls says so, and a file no test touches says that too', () => {
    put('src/lone.js', 'export function lonely() {\n  return 1\n}\n')
    const r = run(['src/lone.js#lonely', '--app', 'app'])
    expect(r.code).toBe(0)
    expect(r.text).toContain('callers: 0')
    expect(r.text).toContain('- none found in the import graph')
    expect(r.text).toContain('tests: 0 (none found)')
    expect(r.text).toContain('no test references')
    expect(run(['src/core/calc.js#sub', '--app', 'app', '--json']).json().callers.files).toBe(0)
  })

  test('JSON carries a version field', () => {
    const j = run(['src/core/calc.js', '--app', 'app', '--json']).json()
    expect(j.version).toBe(1)
    expect(typeof j.meerkat).toBe('string')
  })
})

describe('brief honest answers', () => {
  test('an unknown symbol is a clear message and exit code 2', () => {
    const r = run(['src/core/calc.js#nope', '--app', 'app'])
    expect(r.code).toBe(2)
    expect(r.text).toContain('unknown symbol')
    expect(r.text).toContain('"nope" does not occur in src/core/calc.js')
  })

  test('a file that is not there is exit code 75, a missing target is 2', () => {
    expect(run(['src/none.js', '--app', 'app']).code).toBe(75)
    expect(run(['--app', 'app']).code).toBe(2)
    expect(run(['a.js', '--bogus']).code).toBe(2)
  })

  test('with no saved run it says so in one line and starts no scan', () => {
    const j = run(['src/core/calc.js#add', '--app', 'app', '--json']).json()
    expect(j.findings.available).toBe(false)
    expect(j.findings.note).toContain('no saved run')
    expect(j.findings.note).toContain('meerkat verify')
    expect(existsSync(join(tmp, 'logs', 'runs'))).toBe(false)
    expect(run(['src/core/calc.js#add', '--app', 'app']).text).toContain('findings: no saved run')
  })

  test('outside a git repository churn says so', () => {
    const bare = join(tmp, 'bare')
    cpSync(app, bare, { recursive: true })
    rmSync(join(bare, '.git'), { recursive: true, force: true })
    const r = run(['src/core/calc.js#add', '--app', 'bare'])
    expect(r.code).toBe(0)
    expect(r.text).toContain('churn: not a git repository')
  })
})

describe('brief cache', () => {
  const cached = () => {
    const dir = join(tmp, 'logs', 'cache', 'brief')
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []
  }

  test('the first call writes a cache file by content hash and the repeat call reads it', () => {
    expect(cached()).toHaveLength(0)
    expect(run(['src/core/calc.js#add', '--app', 'app', '--json']).json().cache.source).toBe('built')
    expect(cached()).toHaveLength(1)
    const again = run(['src/core/calc.js#add', '--app', 'app', '--json']).json()
    expect(again.cache.source).toBe('cache')
    expect(cached()).toHaveLength(1)
  })

  test('changing the file makes a new cache entry instead of serving the old brief', () => {
    run(['src/core/calc.js#add', '--app', 'app'])
    put('src/core/calc.js', 'export function add(a, b, c) {\n  return a + b + c\n}\n')
    const j = run(['src/core/calc.js#add', '--app', 'app', '--json']).json()
    expect(j.cache.source).not.toBe('cache')
    expect(j.target.signature).toBe('export function add(a, b, c) {')
    expect(cached()).toHaveLength(2)
  })

  test('changing a caller (not the target) also invalidates it', () => {
    run(['src/core/calc.js#add', '--app', 'app'])
    put('src/ui/b.js', 'export const x = 1\n')
    const j = run(['src/core/calc.js#add', '--app', 'app', '--json']).json()
    expect(j.cache.source).not.toBe('cache')
    expect(j.callers.files).toBe(1)
  })
})
