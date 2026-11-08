import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { readConfig } from '../lib/config.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { firstRunNote } from '../lib/firstrun.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { classifyFindings, missingFindingsText } from '../lib/findingsread.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { runPathLines, RETENTION_TEXT } from '../lib/runpath.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { CLI } from './smoke-helpers.mjs'

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `mk053-${p}-`))
const cli = (args: string[], cwd: string, env: Record<string, string> = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, NO_COLOR: '1', CI: '1', MEERKAT_LOG_DIR: join(cwd, '.logs'), ...env } })

describe('usage errors exit 2', () => {
  test('dismiss with no id exits 2 and shows usage', () => {
    const r = cli(['dismiss'], tmp('d'))
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('usage: meerkat dismiss')
  })
  test('rules test with no file exits 2; with a missing action exits 2', () => {
    const d = tmp('r')
    expect(cli(['rules', 'test'], d).status).toBe(2)
    expect(cli(['rules'], d).status).toBe(2)
  })
  test('global flags are accepted by the extras commands (map, blast, brief, memory)', () => {
    const d = tmp('g')
    for (const c of ['map', 'blast', 'brief', 'memory']) {
      const r = cli([c, '--no-input'], d)
      expect(`${r.stdout}${r.stderr}`, c).not.toMatch(/unknown option --no-input/)
    }
  })
})

describe('unknown config keys', () => {
  const read = (obj: unknown) => {
    const d = tmp('c')
    const f = join(d, 'meerkat.config.json')
    writeFileSync(f, JSON.stringify(obj))
    return readConfig(f)
  }
  test('a typo key produces a note naming it', () => {
    const r = read({ pakcs: ['security'], disable: [] })
    expect(r.notes.some((n: string) => n.includes('"pakcs"') && n.includes('"packs"'))).toBe(true)
  })
  test('a valid config produces none', () => {
    expect(read({ packs: ['security'], disable: ['typos'], budget: { cpu: 2 }, allowWrites: ['x'], $schema: 'https://x' }).notes).toEqual([])
  })
  test('the repository own config is clean', () => {
    expect(readConfig(join(__dirname, '..', 'meerkat.config.json')).notes).toEqual([])
  })
})

describe('findings file states', () => {
  const run = (text: string | null) => {
    const d = tmp('f')
    if (text !== null) writeFileSync(join(d, 'findings.json'), text)
    return d
  }
  test('truncated JSON says truncated, not version', () => {
    const d = run('{"schemaVersion":1,"findings":[{"id":"a"')
    expect(classifyFindings(d).state).toBe('truncated')
    const t = missingFindingsText(d)
    expect(t).toContain('findings file is truncated')
    expect(t).toContain('not a version mismatch')
  })
  test('valid JSON of an older schema says older Meerkat wrote it', () => {
    const d = run('{"schemaVersion":0,"findings":[]}')
    expect(classifyFindings(d).state).toBe('older')
    expect(missingFindingsText(d)).toContain('older Meerkat wrote this run')
  })
  test('a missing file and a good file', () => {
    expect(classifyFindings(run(null)).state).toBe('missing')
    expect(classifyFindings(run('{"schemaVersion":1,"findings":[]}')).state).toBe('ok')
  })
})

describe('first run note', () => {
  const none = () => null
  test('printed once per project, listing missing tools and the profile command', () => {
    const dir = tmp('p')
    const home = tmp('h')
    writeFileSync(join(dir, 'eslint.config.js'), 'export default []\n')
    const a = firstRunNote({ dir, home, env: {}, find: none })
    expect(a).toContain('hadolint')
    expect(a).toContain('actionlint')
    expect(a).toContain('eslint')
    expect(a).toContain('meerkat init --profile solo')
    expect(firstRunNote({ dir, home, env: {}, find: none })).toBeNull()
  })
  test('eslint is only listed when the project has an eslint config', () => {
    expect(firstRunNote({ dir: tmp('q'), home: tmp('h2'), env: {}, find: none })).not.toMatch(/eslint/)
  })
  test('never in plain, json or quiet output, and not when a config exists', () => {
    const home = tmp('h3')
    for (const o of [{ plain: true }, { json: true }, { quiet: true }, { configFile: 'meerkat.config.json' }]) expect(firstRunNote({ dir: tmp('r'), home, env: {}, find: none, ...o })).toBeNull()
  })
})

describe('run path note', () => {
  test('names the folder and says how long runs are kept', () => {
    const lines = runPathLines({ dir: '/logs/runs/x', env: { MEERKAT_LOG_DIR: '/logs' }, temp: '/tmp-nowhere' }).join('\n')
    expect(lines).toContain('/logs/runs/x')
    expect(lines).toContain(RETENTION_TEXT)
    expect(lines).not.toContain('Warning')
  })
  test('warns when the folder is inside the temp folder', () => {
    const t = tmp('t')
    mkdirSync(join(t, 'runs'), { recursive: true })
    expect(runPathLines({ dir: join(t, 'runs'), env: { MEERKAT_LOG_DIR: t }, temp: t }).join('\n')).toContain('Warning')
  })
})
