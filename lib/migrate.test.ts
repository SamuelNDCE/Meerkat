// Migration help: reads manifests and the migrations/ data only. Temp folders, no network, never edits a project.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { MIGRATIONS_DIR, formatMigration, loadMigrations, majorOf, planMigration, testCommand } from './migrate.mjs'

let dir = ''
const project = (pkg: object, files: Record<string, string> = {}) => {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c)
  return dir
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'meerkat-migrate-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('versions', () => {
  test('major of common ranges', () => {
    expect(majorOf('^14.2.3')).toBe(14)
    expect(majorOf('~15')).toBe(15)
    expect(majorOf('>=14 <16')).toBe(14)
    expect(majorOf('latest')).toBeNull()
    expect(majorOf('15.0.0-rc.1')).toBe(15)
  })
})

describe('shipped data', () => {
  test('every guide item has a url, files, pattern and change, and every pattern compiles', () => {
    const all = loadMigrations()
    expect(all.length).toBeGreaterThan(0)
    for (const d of all) for (const g of d.guides) {
      expect(g.url).toMatch(/^https:\/\//)
      for (const i of g.items) {
        expect(i.files.length).toBeGreaterThan(0)
        expect(i.change.length).toBeGreaterThan(0)
        expect(() => new RegExp(i.pattern)).not.toThrow()
        expect(i.anchor === undefined || i.anchor.startsWith('#')).toBe(true)
      }
    }
  })
  test('the data folder is plain JSON only', () => {
    expect(readdirSync(MIGRATIONS_DIR).every((f) => f.endsWith('.json'))).toBe(true)
  })
})

describe('planMigration', () => {
  test('next 14 to 15 gives a checklist with guide urls and the test judge', () => {
    const r = planMigration({ folder: project({ dependencies: { next: '^14.2.0' }, scripts: { test: 'vitest run' } }), framework: 'next', target: '15' })
    expect(r.ok).toBe(true)
    expect(r.current).toBe(14)
    expect(r.checklist.length).toBeGreaterThan(5)
    expect(r.checklist.every((i: { url: string }) => i.url.startsWith('https://nextjs.org/'))).toBe(true)
    expect(r.judge).toEqual({ before: 'npm test', after: 'npm test' })
    expect(r.missingGuides).toEqual([])
  })
  test('a skipped step is reported, not invented', () => {
    const r = planMigration({ folder: project({ dependencies: { next: '13.5.0' } }), framework: 'next', target: '15' })
    expect(r.ok).toBe(true)
    expect(r.missingGuides).toEqual(['13 to 14'])
    expect(r.checklist.length).toBeGreaterThan(0)
  })
  test('no test script means no judge, said plainly', () => {
    const r = planMigration({ folder: project({ dependencies: { next: '14.0.0' } }), framework: 'next', target: '15' })
    expect(r.judge.before).toBeNull()
    expect(formatMigration(r)).toContain('no judge')
  })
  test('pnpm lockfile picks pnpm; placeholder test script is no judge', () => {
    const f = project({ scripts: { test: 'vitest' } }, { 'pnpm-lock.yaml': '' })
    expect(testCommand(f, { scripts: { test: 'vitest' } })).toBe('pnpm test')
    expect(testCommand(f, { scripts: { test: 'echo "Error: no test specified" && exit 1' } })).toBeNull()
  })
  test('refusals: unknown framework, not newer, bad target, missing dependency, no manifest', () => {
    const f = project({ dependencies: { next: '15.0.0' } })
    expect(planMigration({ folder: f, framework: 'rails', target: '8' }).reason).toContain('no migration data')
    expect(planMigration({ folder: f, framework: 'next', target: '15' }).reason).toContain('not newer')
    expect(planMigration({ folder: f, framework: 'next', target: 'abc' }).ok).toBe(false)
    const g = project({ dependencies: {} })
    expect(planMigration({ folder: g, framework: 'next', target: '15' }).reason).toContain('not a dependency')
    rmSync(join(dir, 'package.json'))
    expect(planMigration({ folder: dir, framework: 'next', target: '15' }).reason).toContain('no package.json')
  })
  test('a new framework needs only a JSON file', () => {
    const data = join(dir, 'data')
    mkdirSync(data)
    writeFileSync(join(data, 'demo.json'), JSON.stringify({ framework: 'demo', name: 'Demo', package: 'demo', guides: [{ from: 1, to: 2, url: 'https://example.test/g', items: [{ id: 'a', title: 'T', files: ['src/**'], pattern: 'x', change: 'c' }] }] }))
    const proj = join(dir, 'p')
    mkdirSync(proj)
    writeFileSync(join(proj, 'package.json'), JSON.stringify({ dependencies: { demo: '1.0.0' } }))
    const r = planMigration({ folder: proj, framework: 'demo', target: '2', dir: data })
    expect(r.checklist[0].url).toBe('https://example.test/g')
  })
  test('never edits the project', () => {
    const f = project({ dependencies: { next: '14.0.0' } }, { 'app.js': 'x' })
    const before = readFileSync(join(f, 'package.json'), 'utf8')
    planMigration({ folder: f, framework: 'next', target: '15' })
    expect(readFileSync(join(f, 'package.json'), 'utf8')).toBe(before)
    expect(readdirSync(f).sort()).toEqual(['app.js', 'package.json'])
  })
})
