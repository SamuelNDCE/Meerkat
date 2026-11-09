// Team-shared accepted findings (.meerkat-team.json): parsing, states, matching, the `team` command and a real run.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { applyTeam, entryState, parseDate, readTeam, teamCheckFailures, teamCounts, teamRunNotes } from './team.mjs'
// @ts-expect-error plain .mjs module
import { runTeam, teamText } from './team-cli.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const runMjs = join(here, '..', 'run.mjs')
const SP = ['secrets', 'plus'].join('-')
const tmp = mkdtempSync(join(tmpdir(), 'meerkat-084-team-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const emptyGlobal = join(tmp, 'global.gitconfig')
writeFileSync(emptyGlobal, '')
const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyGlobal, GIT_CONFIG_NOSYSTEM: '1', MEERKAT_LOG_DIR: join(tmp, 'logs'), NO_COLOR: '1' }
const NOW = new Date('2026-11-09T12:00:00Z')
const entry = (o: object = {}) => ({ check: SP, file: 'src/a.js', reason: 'test key', owner: '@sam', expires: '2026-12-31', ...o })
let n = 0
const repo = (team: unknown, raw?: string) => {
  const dir = join(tmp, `r${n++}`)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', dir], { env })
  if (raw !== undefined) writeFileSync(join(dir, '.meerkat-team.json'), raw)
  else if (team !== undefined) writeFileSync(join(dir, '.meerkat-team.json'), JSON.stringify(team))
  return dir
}
const cmd = (args: string[], cwd: string) => {
  const out: string[] = []
  const err: string[] = []
  const code = runTeam(args, { cwd, out: (t: string) => out.push(t), err: (t: string) => err.push(t) })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('dates and states', () => {
  test('parseDate accepts real dates only', () => {
    expect(parseDate('2026-12-31')).not.toBeNull()
    for (const bad of ['2026-02-30', '2026-13-01', '12/31/2026', '2026-1-1', '', null, undefined, '30d', '2026-12-31T00:00:00Z']) expect(parseDate(bad)).toBeNull()
  })
  test('active, expiring within 14 days, expired', () => {
    expect(entryState(entry({ expires: '2026-12-31' }), NOW).state).toBe('active')
    expect(entryState(entry({ expires: '2026-11-23' }), NOW).state).toBe('expiring')
    expect(entryState(entry({ expires: '2026-11-24' }), NOW).state).toBe('active')
    expect(entryState(entry({ expires: '2026-11-08' }), NOW).state).toBe('expired')
  })
  test('the expiry day itself is still active, the day after is expired', () => {
    expect(entryState(entry({ expires: '2026-11-09' }), new Date('2026-11-09T23:59:59Z')).state).toBe('expiring')
    expect(entryState(entry({ expires: '2026-11-09' }), new Date('2026-11-10T00:00:00Z')).state).toBe('expired')
  })
  test('no expiry or a bad one never counts as active', () => {
    for (const expires of [undefined, '', '   ', 'never', '2026-02-30', 20261231, null]) {
      const e = entryState(entry({ expires }), NOW)
      expect(e.state).toBe('no-expiry')
      expect(e.problems.join(' ')).toContain('expiry')
    }
  })
  test('an entry without a check or a file is invalid, one without an owner is flagged', () => {
    expect(entryState(entry({ check: '' }), NOW).state).toBe('invalid')
    expect(entryState(entry({ file: undefined }), NOW).state).toBe('invalid')
    const e = entryState(entry({ owner: undefined }), NOW)
    expect(e.state).toBe('active')
    expect(e.problems).toContain('no owner')
  })
  test('control characters in text are cleaned', () => {
    const e = entryState(entry({ reason: 'a\u001b[31mb\nc' }), NOW)
    expect(e.reason).not.toMatch(/[\u0000-\u001f]/)
  })
})

describe('reading the file', () => {
  test('no file is not an error', () => {
    const t = readTeam(repo(undefined), NOW)
    expect(t).toMatchObject({ exists: false, error: null, entries: [] })
    expect(teamRunNotes(t)).toEqual([])
    expect(teamCheckFailures(t)).toEqual([])
  })
  test('an object with entries, a bare list and a BOM all read', () => {
    expect(readTeam(repo({ entries: [entry()] }), NOW).entries).toHaveLength(1)
    expect(readTeam(repo([entry(), entry()]), NOW).entries).toHaveLength(2)
    expect(readTeam(repo(undefined, `﻿${JSON.stringify([entry()])}`), NOW).entries).toHaveLength(1)
  })
  test('broken JSON and a wrong shape are errors that a run and --check both say out loud', () => {
    for (const raw of ['{nope', '"text"', '{"entries": 3}', '']) {
      const t = readTeam(repo(undefined, raw), NOW)
      expect(t.error).toBeTruthy()
      expect(teamRunNotes(t)[0]).toContain('no team rule was applied')
      expect(teamCheckFailures(t)).toHaveLength(1)
    }
  })
  test('an entry that is not an object is invalid, not a crash', () => {
    const t = readTeam(repo([1, null, 'x', [], entry()]), NOW)
    expect(t.entries.map((e: { state: string }) => e.state)).toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'active'])
  })
  test('an oversized file is refused with a reason', () => {
    const t = readTeam(repo(undefined, ' '.repeat(1024 * 1024 + 1)), NOW)
    expect(t.error).toContain('larger than 1 MB')
  })
  test('counts', () => {
    const t = readTeam(repo([entry(), entry({ expires: '2026-11-20' }), entry({ expires: '2020-01-01' }), entry({ expires: undefined, owner: '' })]), NOW)
    expect(teamCounts(t)).toMatchObject({ total: 4, active: 1, expiring: 1, expired: 1, noExpiry: 1, noOwner: 1 })
  })
})

describe('applying the team to a run', () => {
  const sets = () => ({ dismissed: new Map<string, string>(), expired: new Map<string, string>(), baseline: new Set<string>(), ratchet: false })
  const f = (id: string, check: string, file: string | null, extra: object = {}) => ({ id, check, file, ...extra })
  const team = (list: object[]) => readTeam(repo(list), NOW)

  test('an active entry suppresses its finding and nothing else', () => {
    const s = sets()
    const r = applyTeam(s, [f('a', SP, 'src/a.js'), f('b', SP, 'src/b.js'), f('c', 'license', 'src/a.js')], team([entry()]))
    expect(r.matched).toBe(1)
    expect([...s.dismissed.keys()]).toEqual(['a'])
    expect(s.dismissed.get('a')).toContain('test key')
    expect(s.dismissed.get('a')).toContain('owner @sam')
  })
  test('globs, ** and Windows separators match', () => {
    const s = sets()
    applyTeam(s, [f('a', 'x', 'src/deep/a.js'), f('b', 'x', 'src\\deep\\b.js'), f('c', 'x', 'lib/c.js'), f('d', 'x', null)], team([entry({ check: 'x', file: 'src/**' })]))
    expect([...s.dismissed.keys()].sort()).toEqual(['a', 'b'])
    const s2 = sets()
    applyTeam(s2, [f('c', 'x', 'lib/c.js'), f('d', 'x', null)], team([entry({ check: 'x', file: '**' })]))
    expect([...s2.dismissed.keys()].sort()).toEqual(['c', 'd'])
    const s3 = sets()
    applyTeam(s3, [f('a', 'x', 'src/a.js')], team([entry({ check: 'x', file: './src/a.js' })]))
    expect(s3.dismissed.has('a')).toBe(true)
  })
  test('a regex-looking file pattern is literal, not a regex', () => {
    const s = sets()
    applyTeam(s, [f('a', 'x', 'src/aXjs'), f('b', 'x', 'src/a.js')], team([entry({ check: 'x', file: 'src/a.js' })]))
    expect([...s.dismissed.keys()]).toEqual(['b'])
  })
  test('a folded finding matches the check that also reported it', () => {
    const s = sets()
    applyTeam(s, [f('a', 'one', 'src/a.js', { alsoDetectedBy: [SP] }), f('b', 'two', 'src/a.js', { alsoReportedBy: [{ check: SP }] })], team([entry()]))
    expect([...s.dismissed.keys()].sort()).toEqual(['a', 'b'])
  })
  test('an expired entry stops suppressing and marks the finding as lapsed', () => {
    const s = sets()
    const r = applyTeam(s, [f('a', SP, 'src/a.js')], team([entry({ expires: '2020-01-01' })]))
    expect(r).toEqual({ matched: 0, lapsed: 1 })
    expect(s.dismissed.size).toBe(0)
    expect(s.expired.get('a')).toContain('2020-01-01')
  })
  test('an entry with no expiry never suppresses', () => {
    const s = sets()
    applyTeam(s, [f('a', SP, 'src/a.js')], team([entry({ expires: undefined })]))
    expect(s.dismissed.size).toBe(0)
  })
  test('an active entry wins over an expired twin, and over an existing lapsed mark', () => {
    const s = sets()
    s.expired.set('a', '2020-01-01')
    applyTeam(s, [f('a', SP, 'src/a.js')], team([entry({ expires: '2020-01-01' }), entry()]))
    expect(s.dismissed.has('a')).toBe(true)
    expect(s.expired.has('a')).toBe(false)
  })
  test('empty inputs do nothing', () => {
    expect(applyTeam(null, [], team([entry()]))).toEqual({ matched: 0, lapsed: 0 })
    expect(applyTeam(sets(), undefined, team([entry()]))).toEqual({ matched: 0, lapsed: 0 })
    expect(applyTeam(sets(), [f('a', 'x', 'y')], team([]))).toEqual({ matched: 0, lapsed: 0 })
  })
  test('run notes name every entry that does not suppress', () => {
    const notes = teamRunNotes(team([entry(), entry({ expires: '2020-01-01', owner: 'amy' }), entry({ expires: undefined }), entry({ check: '' })]))
    expect(notes).toHaveLength(3)
    expect(notes[0]).toContain('rule 2')
    expect(notes[0]).toContain('expired on 2020-01-01')
    expect(notes[0]).toContain('owner amy')
    expect(notes[1]).toContain('no valid expiry')
    expect(notes[2]).toContain('incomplete')
  })
})

describe('meerkat team', () => {
  test('lists every entry with owner, expiry and state', () => {
    const dir = repo([entry(), entry({ expires: '2020-01-01', check: 'license', file: 'package.json' }), entry({ expires: undefined, owner: '' })])
    const r = cmd([], dir)
    expect(r.code).toBe(0)
    expect(r.out).toContain('3 entries')
    expect(r.out).toMatch(new RegExp(`1\\s+active\\s+${SP}\\s+src/a\\.js\\s+@sam\\s+2026-12-31\\s+test key`))
    expect(r.out).toMatch(/2\s+expired\s+license/)
    expect(r.out).toContain('NO OWNER')
    expect(r.out).toContain('no expiry')
  })
  test('says so when an entry is expiring within 14 days', () => {
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
    const r = cmd([], repo([entry({ expires: soon })]))
    expect(r.out).toMatch(/expiring \(\d+d\)/)
    expect(r.out).toContain('1 expiring within 14 days')
  })
  test('no file: friendly text, exit 0, and --check passes', () => {
    const dir = repo(undefined)
    expect(cmd([], dir)).toMatchObject({ code: 0 })
    expect(cmd([], dir).out).toContain('No .meerkat-team.json')
    expect(cmd(['--check'], dir).code).toBe(0)
  })
  test('--check exits 1 on an expired entry, with the reason on stderr', () => {
    const r = cmd(['--check'], repo([entry(), entry({ expires: '2020-01-01' })]))
    expect(r.code).toBe(1)
    expect(r.err).toContain('rule 2 expired on 2020-01-01')
  })
  test('--check exits 1 on a missing owner, a missing expiry and a broken file', () => {
    expect(cmd(['--check'], repo([entry({ owner: '' })])).code).toBe(1)
    expect(cmd(['--check'], repo([entry({ owner: undefined })])).err).toContain('no owner')
    expect(cmd(['--check'], repo([entry({ expires: undefined })])).code).toBe(1)
    expect(cmd(['--check'], repo(undefined, '{broken')).code).toBe(1)
  })
  test('--check exits 0 when every entry is active or expiring with an owner', () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    const r = cmd(['--check'], repo([entry({ expires: '2099-12-31' }), entry({ expires: soon })]))
    expect(r.code).toBe(0)
    expect(r.out).toContain('team --check: ok')
  })
  test('--json is one parseable object; a folder argument and --app both work; unknown options are refused', () => {
    const dir = repo([entry({ expires: '2099-12-31' })])
    const j = JSON.parse(cmd(['--json'], dir).out)
    expect(j.counts.total).toBe(1)
    expect(j.entries[0].state).toBe('active')
    expect(JSON.parse(cmd(['--json', dir], tmp).out).counts.total).toBe(1)
    expect(JSON.parse(cmd(['--json', '--app', dir], tmp).out).counts.total).toBe(1)
    expect(cmd(['--wat'], dir).code).toBe(2)
  })
  test('a broken file is shown, never silent, and exits 1', () => {
    const r = cmd([], repo(undefined, '{broken'))
    expect(r.code).toBe(1)
    expect(r.out).toContain('could not be read')
  })
  test('teamText works on an empty list', () => {
    expect(teamText(readTeam(repo([]), NOW))).toContain('0 entries')
  })
  test('the real CLI routes `team` and `team --check`', () => {
    const bin = join(here, '..', 'bin', 'meerkat.mjs')
    const dir = repo([entry({ expires: '2020-01-01' })])
    const a = spawnSync(process.execPath, [bin, 'team', '--check', '--app', dir], { env, encoding: 'utf8' })
    expect(a.status).toBe(1)
    expect(a.stdout).toContain('expired')
    const b = spawnSync(process.execPath, [bin, 'team', '--app', dir], { env, encoding: 'utf8' })
    expect(b.status).toBe(0)
  })
})

describe('a real run', () => {
  const fixture = (team: unknown) => {
    const dir = join(tmp, `run${n++}`)
    mkdirSync(join(dir, 'src'), { recursive: true })
    execFileSync('git', ['init', '-q', dir], { env })
    writeFileSync(join(dir, 'src', 'a.js'), 'const k2 = "ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789"\n')
    writeFileSync(join(dir, 'package.json'), '{"name":"fx"}')
    if (team !== undefined) writeFileSync(join(dir, '.meerkat-team.json'), JSON.stringify(team))
    execFileSync('git', ['-C', dir, 'add', '-A'], { env })
    execFileSync('git', ['-C', dir, '-c', 'user.email=a@b.c', '-c', 'user.name=n', 'commit', '-qm', 'init'], { env })
    return dir
  }
  const run = (dir: string, extra: string[] = []) => spawnSync(process.execPath, [runMjs, '--app', dir, '--preset', 'quick', '--only', SP, '--plain', ...extra], { env, encoding: 'utf8', timeout: 120000 })

  test('without a team file the check fails on the planted token', () => {
    const r = run(fixture(undefined))
    expect(r.stdout).toContain('1 failed')
    expect(r.stderr + r.stdout).not.toContain('team:')
  }, 130000)
  test('an active entry suppresses its finding: the check passes', () => {
    const r = run(fixture([entry({ expires: '2099-12-31' })]))
    expect(r.stdout).toContain('0 failed')
    expect(r.stdout).not.toMatch(new RegExp(`^FAIL\\s+${SP}`, 'm'))
  }, 130000)
  test('an expired entry stops suppressing and the run prints the expiry line', () => {
    const r = run(fixture([entry({ expires: '2020-01-01' })]))
    const all = r.stdout + r.stderr
    expect(all).toContain(`team: rule 1 (${SP} in src/a.js) expired on 2020-01-01 (owner @sam), so it no longer suppresses`)
    expect(r.stdout).toContain('1 failed')
    expect(all).toContain('team rule 1')
  }, 130000)
  test('an entry with no expiry does not suppress and says so', () => {
    const r = run(fixture([entry({ expires: undefined })]))
    expect(r.stdout + r.stderr).toContain('has no valid expiry date')
    expect(r.stdout).toContain('1 failed')
  }, 130000)
  test('an entry for another file or check suppresses nothing', () => {
    expect(run(fixture([entry({ file: 'src/other.js', expires: '2099-12-31' })])).stdout).toContain('1 failed')
    expect(run(fixture([entry({ check: 'license', expires: '2099-12-31' })])).stdout).toContain('1 failed')
  }, 130000)
  test('a broken team file is reported and the run still finishes', () => {
    const dir = fixture(undefined)
    writeFileSync(join(dir, '.meerkat-team.json'), '{broken')
    const r = run(dir)
    expect(r.stdout + r.stderr).toContain('no team rule was applied')
    expect(r.stdout).toContain('1 failed')
  }, 130000)
})
