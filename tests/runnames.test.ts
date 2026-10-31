import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs
import { checkLogText, latestRunDirOf, makeRunDir, parseRunName, slugProject, sortRunNames, writeRunReport } from '../lib/runlog.mjs'
// @ts-expect-error plain .mjs
import { listRuns, listRunsText, resolveRun } from '../lib/runs.mjs'

const logs = () => mkdtempSync(join(tmpdir(), 'meerkat-names-'))
const mk = (env: Record<string, string>, name: string, summary: object | null = {}) => {
  const dir = join(env.MEERKAT_LOG_DIR, 'runs', name)
  mkdirSync(dir, { recursive: true })
  if (summary) writeFileSync(join(dir, 'summary.json'), JSON.stringify({ tier: 'fast', summary: 'ok', exitCode: 0, ...summary }))
  return dir.replace(/\\/g, '/')
}

describe('run folder names', () => {
  it('parses both shapes', () => {
    expect(parseRunName('20261031-091438-thorough')).toEqual({ stamp: '20261031-091438', project: null, tier: 'thorough' })
    expect(parseRunName('20261031-091438-plume-thorough')).toEqual({ stamp: '20261031-091438', project: 'plume', tier: 'thorough' })
    expect(parseRunName('20261031-091438-my-fast-app-fast-selftest')).toEqual({ stamp: '20261031-091438', project: 'my-fast-app', tier: 'fast-selftest' })
    expect(parseRunName('20261031-091438-fast-selftest')).toEqual({ stamp: '20261031-091438', project: null, tier: 'fast-selftest' })
    expect(parseRunName('nonsense').stamp).toBeNull()
  })
  it('slugs a project name safely', () => {
    expect(slugProject('Plume')).toBe('plume')
    expect(slugProject('My App_v2.0!')).toBe('my-app-v2-0')
    expect(slugProject('x'.repeat(50))).toHaveLength(30)
    expect(slugProject('***')).toBe('project')
    expect(slugProject('')).toBe('project')
  })
  it('makes the new folder name and sorts both shapes by time', () => {
    const env = { MEERKAT_LOG_DIR: logs() }
    const dir = makeRunDir(env, 'thorough', new Date(2026, 9, 31, 9, 14, 38), undefined, 'C:/Work/Plume')
    expect(dir.endsWith('/20261031-091438-plume-thorough')).toBe(true)
    expect(makeRunDir(env, 'fast', new Date(2026, 9, 31, 9, 14, 39)).endsWith('/20261031-091439-fast')).toBe(true)
    expect(sortRunNames(['20261031-091438-plume-thorough', '20261030-235959-fast', '20261031-091500-thorough'])).toEqual(['20261031-091500-thorough', '20261031-091438-plume-thorough', '20261030-235959-fast'])
  })
})

describe('project in logs and listings', () => {
  it('puts the project in the check log header', () => {
    const text = checkLogText({ check: { id: 'lint' }, spec: null, result: { status: 'PASS' }, code: 0, ms: 5, output: 'x', project: 'C:/Work/Plume' })
    expect(text.split('\n')[0]).toMatch(/^project:\s+plume\s+\(.*Work\/Plume\)$/)
  })
  it('titles the report and records the project in summary.json and latest.json', () => {
    const env = { MEERKAT_LOG_DIR: logs() }
    const dir = makeRunDir(env, 'fast', new Date(2026, 9, 31, 9, 0, 0), undefined, 'C:/Work/Plume')
    const report = writeRunReport({ dir, tier: 'fast', preset: 'full', results: [], line: 'done', exitCode: 0, ms: 10, env, appDir: 'C:/Work/Plume' })
    expect(report.split('\n')[0]).toBe('# Meerkat run: full on plume')
    expect(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).project.name).toBe('plume')
    expect(JSON.parse(readFileSync(join(env.MEERKAT_LOG_DIR, 'latest.json'), 'utf8')).project.name).toBe('plume')
  })
  it('lists by project, shows a PROJECT column and still resolves old folders', () => {
    const env = { MEERKAT_LOG_DIR: logs() }
    mk(env, '20261030-100000-fast')
    mk(env, '20261031-090000-plume-thorough')
    mk(env, '20261031-100000-meerkat-fast')
    mk(env, '20261031-110000-plume-fast')
    const rows = listRuns(env)
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['20261031-110000-plume-fast', '20261031-100000-meerkat-fast', '20261031-090000-plume-thorough', '20261030-100000-fast'])
    expect(rows[3].project).toBeNull()
    expect(listRuns(env, { project: 'Plume' }).map((r: { id: string }) => r.id)).toEqual(['20261031-110000-plume-fast', '20261031-090000-plume-thorough'])
    expect(listRunsText(rows, env).split('\n')[0]).toContain('PROJECT')
    expect(latestRunDirOf(env, 'plume')).toMatch(/20261031-110000-plume-fast$/)
    expect(resolveRun(env, 'plume').dir).toMatch(/20261031-110000-plume-fast$/)
    expect(resolveRun(env, '20261030-100000-fast').ok).toBe(true)
    expect(resolveRun(env, '20261030').ok).toBe(true)
    expect(resolveRun(env, 'nothere').ok).toBe(false)
  })
})
