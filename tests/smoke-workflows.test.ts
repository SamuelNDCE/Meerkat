// SMOKE: four real workflows, each a sequence of real commands on a copy of tests/fixtures/smoke-app, with the expected outcome of every step.
// (a) first run then a planted bug is blocked, (b) the fix passes, (c) pull-request style gate against a base commit, (d) the AI workflow: brief, blast, map, map --check.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { git, hasStack, makeSandbox, runCli } from './smoke-helpers.mjs'

// A SQL statement built by joining text and a request value: the "sql-concat" check must block it.
const BUG = '\nexport function findUser(db, req) {\n  return db.query("SELECT * FROM users WHERE name = \'" + req.query.name + "\'")\n}\n'
const FIXED = '\nexport function findUser(db, req) {\n  return db.query("SELECT * FROM users WHERE name = $1", [req.query.name])\n}\n'
const T = 170000

type Sb = ReturnType<typeof makeSandbox>
const read = (sb: Sb, f: string) => readFileSync(join(sb.app, f), 'utf8')
const write = (sb: Sb, f: string, text: string) => writeFileSync(join(sb.app, f), text)
const stage = (sb: Sb, ...files: string[]) => git(sb.app, ['add', ...files], sb.env)
const commit = (sb: Sb, message: string) => {
  git(sb.app, ['commit', '-q', '-m', message], sb.env)
  return git(sb.app, ['rev-parse', 'HEAD'], sb.env)
}
const ok = (r: { timedOut: boolean; all: string }) => {
  expect(r.timedOut, 'timed out').toBe(false)
  expect(hasStack(r.all), `stack trace: ${r.all.slice(0, 400)}`).toBe(false)
}

describe('(a) and (b) first run, a planted bug is blocked, the fix passes', () => {
  let sb: Sb
  beforeAll(() => {
    sb = makeSandbox({ label: 'wf-ab' })
  })
  afterAll(() => sb?.cleanup())

  test('init writes a starting config', () => {
    const r = runCli(sb, ['init'])
    ok(r)
    expect(r.code).toBe(0)
    expect(JSON.parse(read(sb, 'meerkat.config.json')).packs).toBeTruthy()
  })
  test('a first run, then baseline accepts its findings', () => {
    const run = runCli(sb, ['verify', '--only', 'license,node-engines,secret-scan', '--plain'], { timeout: T })
    ok(run)
    expect([0, 1]).toContain(run.code)
    const r = runCli(sb, ['baseline'])
    ok(r)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/Baseline saved: \d+ open finding/)
  }, T)
  test('gate --staged on a clean change passes', () => {
    appendFileSync(join(sb.app, 'src', 'math.js'), '\nexport const triple = (n) => n * 3\n')
    stage(sb, 'src/math.js')
    const r = runCli(sb, ['gate', '--staged', '--no-cache'], { timeout: T })
    ok(r)
    expect(r.code, r.all.slice(0, 600)).toBe(0)
    expect(r.stdout).toContain('src/math.js')
  }, T)
  test('gate --staged blocks the planted SQL concatenation and names the file', () => {
    appendFileSync(join(sb.app, 'src', 'index.js'), BUG)
    stage(sb, 'src/index.js')
    const r = runCli(sb, ['gate', '--staged', '--no-cache'], { timeout: T })
    ok(r)
    expect(r.code, r.all.slice(0, 600)).toBe(1)
    expect(r.stdout).toMatch(/sql-concat[^\n]*src\/index\.js/)
    expect(r.stdout).toContain('in the files you changed')
  }, T)
  test('(b) fixing it makes the gate pass again', () => {
    write(sb, 'src/index.js', read(sb, 'src/index.js').replace(BUG, FIXED))
    stage(sb, 'src/index.js')
    const r = runCli(sb, ['gate', '--staged', '--no-cache'], { timeout: T })
    ok(r)
    expect(r.code, r.all.slice(0, 600)).toBe(0)
    expect(r.stdout).not.toMatch(/FAIL\s+sql-concat/)
  }, T)
})

describe('(c) pull request style: gate --base the commit before', () => {
  let sb: Sb
  let before = ''
  beforeAll(() => {
    sb = makeSandbox({ label: 'wf-c' })
    before = git(sb.app, ['rev-parse', 'HEAD'], sb.env)
  })
  afterAll(() => sb?.cleanup())

  test('a commit with the bug: only the changed files are reported, and it blocks', () => {
    appendFileSync(join(sb.app, 'src', 'math.js'), '\nexport const triple = (n) => n * 3\n')
    appendFileSync(join(sb.app, 'src', 'index.js'), BUG)
    stage(sb, 'src/math.js', 'src/index.js')
    commit(sb, 'add triple and findUser')
    const r = runCli(sb, ['gate', '--base', before, '--json', '--no-cache'], { timeout: T })
    ok(r)
    expect(r.code, r.all.slice(0, 600)).toBe(1)
    const j = JSON.parse(r.stdout)
    expect([...j.files].sort()).toEqual(['src/index.js', 'src/math.js'])
    const failing = j.rows.filter((x: { kind: string }) => x.kind === 'fail').map((x: { id: string; detail: string }) => `${x.id}: ${x.detail}`)
    expect(failing.join('\n')).toMatch(/sql-concat: src\/index\.js/)
  }, T)
  test('after the fix commit, gate against the commit before it passes and reports one file', () => {
    const bad = git(sb.app, ['rev-parse', 'HEAD'], sb.env)
    write(sb, 'src/index.js', read(sb, 'src/index.js').replace(BUG, FIXED))
    stage(sb, 'src/index.js')
    commit(sb, 'use placeholders')
    const r = runCli(sb, ['gate', '--base', bad, '--json', '--no-cache'], { timeout: T })
    ok(r)
    expect(r.code, r.all.slice(0, 600)).toBe(0)
    expect(JSON.parse(r.stdout).files).toEqual(['src/index.js'])
  }, T)
})

describe('(d) the AI workflow: brief, blast, map, map --check', () => {
  let sb: Sb
  beforeAll(() => {
    sb = makeSandbox({ label: 'wf-d' })
  })
  afterAll(() => sb?.cleanup())

  test('brief on a function names its callers and a risk tier', () => {
    const r = runCli(sb, ['brief', 'src/math.js#add'])
    ok(r)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/risk: (LOW|MEDIUM|HIGH)/)
    expect(r.stdout).toContain('src/math.js#add')
  })
  test('blast lists the importers of the file', () => {
    const r = runCli(sb, ['blast', 'src/math.js'])
    ok(r)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('src/index.js')
    expect(r.stdout).toContain('test/math.test.js')
  })
  test('map writes the code map, map --check says it is current', () => {
    const m = runCli(sb, ['map'])
    ok(m)
    expect(m.code).toBe(0)
    expect(m.stdout).toMatch(/code map saved/)
    const c = runCli(sb, ['map', '--check'])
    ok(c)
    expect(c.code, c.all).toBe(0)
    expect(c.stdout).toMatch(/map is current/)
  })
  test('after an edit map --check exits 1, map refreshes it, map --check exits 0 again', () => {
    write(sb, 'src/math.js', read(sb, 'src/math.js').replace('return a + b', 'const sum = a + b\n  return sum'))
    const stale = runCli(sb, ['map', '--check'])
    ok(stale)
    expect(stale.code, stale.all).toBe(1)
    expect(stale.all).toMatch(/stale|changed|out of date|map/i)
    const m = runCli(sb, ['map'])
    ok(m)
    expect(m.code).toBe(0)
    const c = runCli(sb, ['map', '--check'])
    ok(c)
    expect(c.code, c.all).toBe(0)
  })
})
