// meerkat context (lib/ctxbrief.mjs): the project brief an AI reads first. Spawns bin/meerkat.mjs like tests/claims.test.ts.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-ctx-'))); tmps.push(d); return d }
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

function mk(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 120000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
function put(dir: string, rel: string, text: string) {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
}
// Every file and folder under dir, relative, sorted: used to prove nothing was written.
function tree(dir: string, rel = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${e}` : e
    out.push(r)
    if (statSync(join(dir, r)).isDirectory()) out.push(...tree(dir, r))
  }
  return out
}
const HEADINGS = ['## What it is', '## Verify with', '## Checks that apply', '## Folders', '## Rules files']

function fixture() {
  const d = tmp()
  put(d, 'package.json', JSON.stringify({ name: 'demo-app', description: 'A demo app for the brief test.', scripts: { test: 'vitest run', build: 'tsc', lint: 'eslint .', start: 'node src/index.js' } }))
  put(d, 'meerkat.config.json', JSON.stringify({ commands: { test: 'npm test', typecheck: 'npx tsc --noEmit' } }))
  put(d, 'README.md', '# Demo\n\nThis is the readme paragraph.\n')
  put(d, 'PROJECT.md', '# rules\n')
  put(d, 'CLAUDE.md', '# claude\n')
  put(d, 'src/index.js', 'export function main() { return 1 }\n')
  put(d, 'lib/util.js', 'export function util() { return 2 }\n')
  put(d, 'MAP.md', '# Map\n\n## Folders\n\n| Folder | What it holds | Detail |\n|---|---|---|\n| `src/` | The app source. | [src.md](docs/map/src.md) |\n| `lib/` | Helpers. | [lib.md](docs/map/lib.md) |\n| `gone/` | A folder that no longer exists. | [gone.md](docs/map/gone.md) |\n')
  return d
}

describe('meerkat context', () => {
  test('sections come in the fixed order', () => {
    const d = fixture()
    const r = mk(d, 'context')
    expect(r.code).toBe(0)
    let at = -1
    for (const h of HEADINGS) {
      const i = r.out.indexOf(h)
      expect(i, `${h} missing`).toBeGreaterThan(at)
      at = i
    }
    expect(r.out).toContain('demo-app')
    expect(r.out).toContain('package.json') // says which file the description came from
    expect(r.out).toContain('npm test') // commands block wins over package scripts
    expect(r.out).toContain('npx tsc --noEmit')
    expect(r.out).toContain('The app source.')
  })

  test('falls back to package.json scripts and to the README when there is no config or description', () => {
    const d = tmp()
    put(d, 'package.json', JSON.stringify({ scripts: { test: 'vitest', build: 'tsc', start: 'node x.js' } }))
    put(d, 'README.md', '# Title\n\nFirst paragraph of the readme.\nSecond line of it.\n\nSecond paragraph.\n')
    const r = mk(d, 'context')
    expect(r.out).toContain('First paragraph of the readme.')
    expect(r.out).toContain('README.md')
    expect(r.out).toContain('npm run test')
    expect(r.out).toContain('npm run build')
    expect(r.out).not.toContain('node x.js') // start is not a verify command
  })

  test('every path the brief names exists on disk', () => {
    const d = fixture()
    const r = mk(d, 'context')
    const body = r.out.split('## Folders')[1]!
    const named = [...body.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]!)
    expect(named.length).toBeGreaterThanOrEqual(4) // src/, lib/, PROJECT.md, CLAUDE.md
    for (const p of named) expect(existsSync(join(d, p)), `${p} does not exist`).toBe(true)
    expect(r.out).not.toContain('gone/') // listed in MAP.md but not on disk
    expect(r.out).not.toContain('AGENTS.md')
    expect(r.out).not.toContain('DESIGN.md')
    expect(r.out).toContain('`PROJECT.md`')
  })

  test('size cap: long folder lists are cut with a visible [truncated] marker, fixed sections stay', () => {
    const d = fixture()
    const rows = ['# Map', '', '## Folders', '', '| Folder | What it holds | Detail |', '|---|---|---|']
    for (let i = 0; i < 150; i++) {
      const name = `folder${String(i).padStart(3, '0')}`
      mkdirSync(join(d, name))
      put(d, `${name}/a.js`, 'export const a = 1\n')
      rows.push(`| \`${name}/\` | ${'Holds a lot of things. '.repeat(3)} | [x](docs/map/${name}.md) |`)
    }
    put(d, 'MAP.md', rows.join('\n') + '\n')
    const r = mk(d, 'context')
    expect(r.out.length).toBeLessThanOrEqual(4000)
    expect(r.out).toContain('[truncated]')
    for (const h of HEADINGS) expect(r.out).toContain(h)
    expect(r.out).toContain('`PROJECT.md`')
    // small project: no marker
    expect(mk(fixture(), 'context').out).not.toContain('[truncated]')
  })

  test('--json has the same sections in the same order', () => {
    const d = fixture()
    const r = mk(d, 'context', '--json')
    const j = JSON.parse(r.out)
    expect(Object.keys(j.sections)).toEqual(['what', 'verify', 'checks', 'folders', 'rules'])
    expect(j.sections.rules.map((x: { path: string }) => x.path)).toEqual(['PROJECT.md', 'CLAUDE.md'])
  })

  test('stdout only: no file or folder is created in the project', () => {
    const d = fixture()
    const before = tree(d)
    const r = mk(d, 'context')
    expect(r.code).toBe(0)
    expect(tree(d)).toEqual(before)
    expect(r.err).toBe('')
  })

  test('a folder argument is read; a missing one is a usage error', () => {
    const d = fixture()
    const other = tmp()
    expect(mk(other, 'context', d).out).toContain('demo-app')
    const bad = mk(other, 'context', join(other, 'nope'))
    expect(bad.code).toBe(2)
  })
})
