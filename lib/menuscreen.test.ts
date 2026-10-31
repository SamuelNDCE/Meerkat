// The menu screens: header with the pixel-art meerkat, sections, the yellow update bar, the u key, and the remembered-version rules.
// No network anywhere: update checks use an injected exec and clock.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { headerLines, headerMode, initialState, menuItems, menuStep, renderScreen, updateBar, withUpdateBar } from './menu.mjs'
import { DAY_MS, checkDue, clearUpdateCache, compareVersions, isVersion, maybeAutoUpdate, readUpdateCache, runUpdateCommand, statusText, updateNotice, writeUpdateCache } from './update.mjs'
import { readUserConfig, updateMode, writeUserConfig } from './userconfig.mjs'

const strip = (t: string) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
const plain = (lines: { text: string }[]) => lines.map((l) => strip(l.text))
const UP = { latest: '1.4.0', current: '1.3.2' }
const base = { version: '1.3.2', project: 'C:/code/shop', question: 'What would you like to run?', hint: '  Up/Down move   q quit', color: true, level: 'truecolor', env: {}, isTTY: true }
const state = () => initialState(menuItems({ user: {}, project: {} }))

describe('header layout', () => {
  test('wide and tall shows the pixel art beside the title block', () => {
    const lines = plain(renderScreen(state(), { ...base, width: 100, rows: 40 }) as never)
    const raw = renderScreen(state(), { ...base, width: 100, rows: 40 })
    expect(raw.some((l: { text: string }) => l.text.includes('\x1b[38;2;'))).toBe(true) // true-colour half blocks
    expect(lines.some((l) => /▀|▄/.test(l))).toBe(true)
    const text = lines.join('\n')
    expect(text).toContain('MEERKAT')
    expect(text).toMatch(/Version\s+1\.3\.2/)
    expect(text).toMatch(/Project\s+C:\/code\/shop/)
  })
  test.each([
    [69, 40],
    [100, 23],
  ])('%i columns by %i rows: text only, no art', (width, rows) => {
    expect(headerMode({ width, rows, color: true, env: {}, isTTY: true })).toBe('text')
    const lines = plain(renderScreen(state(), { ...base, width, rows }) as never)
    expect(lines.join('\n')).not.toMatch(/▀|▄/)
    expect(lines[0]).toContain('MEERKAT')
    expect(lines[0]).toContain('1.3.2')
    expect(lines[1]).toContain('C:/code/shop')
  })
  test('no art without colour, with MEERKAT_PLAIN, MEERKAT_MASCOT=0, NO_COLOR or without a terminal', () => {
    expect(headerMode({ width: 100, rows: 40, color: false, env: {}, isTTY: true })).toBe('text')
    expect(headerMode({ width: 100, rows: 40, color: true, env: { MEERKAT_PLAIN: '1' }, isTTY: true })).toBe('text')
    expect(headerMode({ width: 100, rows: 40, color: true, env: { MEERKAT_MASCOT: '0' }, isTTY: true })).toBe('text')
    expect(headerMode({ width: 100, rows: 40, color: true, env: { NO_COLOR: '1' }, isTTY: true })).toBe('text')
    expect(headerMode({ width: 100, rows: 40, color: true, env: {}, isTTY: false })).toBe('text')
    expect(headerMode({ width: 70, rows: 24, color: true, env: {}, isTTY: true })).toBe('art')
  })
  test('without colour nothing carries an escape code', () => {
    const lines = renderScreen(state(), { ...base, color: false, level: false, update: UP, width: 80, rows: 30 })
    expect(lines.every((l: { text: string }) => !l.text.includes('\x1b'))).toBe(true)
  })
  test('never taller than the terminal, and the highlighted row stays in view', () => {
    for (const [width, rows] of [[100, 24], [80, 24], [60, 12], [40, 12], [100, 50]]) {
      let st = state()
      for (let i = 0; i < 18; i++) st = menuStep(st, 'down').state
      const lines = renderScreen(st, { ...base, update: UP, width, rows }) as { text: string }[]
      expect(lines.length).toBeLessThanOrEqual(rows - 1)
      expect(lines.every((l) => strip(l.text).length <= width - 1)).toBe(true)
      expect(plain(lines).some((l) => l.startsWith(`> ${st.items[st.cursor].label}`))).toBe(true)
    }
  })
})

describe('sections', () => {
  test('the preset menu has the named sections, one line per item with its description', () => {
    const lines = plain(renderScreen(state(), { ...base, color: false, level: false, width: 120, rows: 60 }) as never)
    for (const h of ['Run', 'More']) expect(lines.some((l) => l.trim().startsWith(h))).toBe(true)
    expect(lines.some((l) => l.includes('Fast and combined'))).toBe(false)
    const quick = lines.find((l) => /^[> ] quick\b/.test(l.trimEnd()) || /^> quick|^ {2}quick/.test(l))!
    expect(quick).toMatch(/quick\s{2,}Every quick check/)
    expect(lines[lines.length - 1]).toContain('q quit')
  })
  test('personal presets get their own section', () => {
    const items = menuItems({ user: { mine: { tier: 'fast', groups: [] } }, project: {} })
    expect(items.filter((i: { kind: string }) => i.kind === 'heading').map((i: { label: string }) => i.label)).toContain('Your presets')
  })
  test('scrolling says how many items are out of view', () => {
    const lines = plain(renderScreen(state(), { ...base, color: false, level: false, width: 80, rows: 14 }) as never).join('\n')
    expect(lines).toMatch(/\d+ more below/)
  })
})

describe('the yellow bar', () => {
  test('text from the brief, black on yellow, first line of the screen', () => {
    const bar = updateBar(UP, { width: 120, color: true, hotkey: true })!
    expect(bar).toContain('\x1b[30;43m')
    expect(strip(bar).trimEnd()).toBe(' Update available: Meerkat 1.4.0 (you have 1.3.2).  Press u to update, or choose Check for updates below'.trimEnd())
    const lines = renderScreen(state(), { ...base, update: UP, width: 120, rows: 40 }) as { text: string }[]
    expect(lines[0].text).toBe(bar)
  })
  test('shorter wording on a narrow line, plain text without colour', () => {
    expect(strip(updateBar(UP, { width: 60, color: false })!)).toBe(' Update available: Meerkat 1.4.0 (you have 1.3.2).')
    expect(updateBar(UP, { width: 80, color: false })).not.toContain('\x1b')
  })
  test('absent without an update', () => {
    expect(updateBar(null)).toBeNull()
    const lines = renderScreen(state(), { ...base, update: null, width: 100, rows: 40 }) as { text: string }[]
    expect(plain(lines).join('\n')).not.toContain('Update available')
    expect(headerLines({ ...base, update: null, width: 80, rows: 24 })[0]).not.toContain('Update available')
  })
  test('the Update item says a version is waiting', () => {
    const item = menuItems({ user: {}, project: {}, update: UP }).find((i: { label: string }) => i.label === 'Check for updates')
    expect(item.about).toContain('1.4.0')
  })
  test('the screen after a run gets the bar in front', () => {
    const lines = withUpdateBar([{ text: 'x', style: 'plain' }], UP, { width: 100, color: true })
    expect(lines).toHaveLength(2)
    expect(lines[0].style).toBe('raw')
    expect(withUpdateBar([{ text: 'x', style: 'plain' }], null)).toHaveLength(1)
  })
})

describe('the u key', () => {
  const withKey = { ...state(), hotkeys: { u: 'update' } }
  test('asks for the update flow on screens that enable it (the flow itself still asks yes or no)', () => {
    expect(menuStep(withKey, 'u').action).toEqual({ type: 'hotkey', name: 'update' })
    expect(menuStep(withKey, 'U').action).toEqual({ type: 'hotkey', name: 'update' })
  })
  test('does nothing elsewhere, and other keys are unchanged', () => {
    expect(menuStep(state(), 'u').action).toBeNull()
    expect(menuStep(withKey, 'q').action).toEqual({ type: 'quit' })
    expect(menuStep(withKey, 'enter').action).toMatchObject({ type: 'choose' })
    expect(menuStep(withKey, 'constructor').action).toBeNull()
  })
})

describe('versions and the remembered answer', () => {
  let dir: string
  let env: Record<string, string>
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mk-menuscreen-'))
    env = { MEERKAT_USER_CONFIG: join(dir, 'u.json') }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('only plain version numbers are accepted', () => {
    for (const v of ['1.4.0', '0.1.0', '10.20.30', '1.4.0-beta.1', '1.4.0+build.5']) expect(isVersion(v)).toBe(true)
    for (const v of ['1.4', 'v1.4.0', '1.4.0 ', '1.4.x', '', null, 5, '1.4.0\n', '1.4.0; rm -rf', '<b>1.0.0</b>']) expect(isVersion(v)).toBe(false)
  })
  test('compareVersions', () => {
    expect(compareVersions('1.4.0', '1.3.2')).toBe(1)
    expect(compareVersions('1.3.2', '1.4.0')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0)
    expect(compareVersions('1.4.0-beta', '1.4.0')).toBe(-1)
  })
  test('write then read; bad versions are not written, bad files are ignored', () => {
    const t0 = Date.parse('2026-10-31T10:00:00Z')
    expect(writeUpdateCache('1.4.0', t0, env)).toBe(true)
    expect(readUpdateCache(env)).toEqual({ latest: '1.4.0', checkedAt: t0 })
    expect(writeUpdateCache('evil', t0, env)).toBe(false)
    expect(readUpdateCache(env)?.latest).toBe('1.4.0')
    for (const bad of [{ latest: '1.4', checkedAt: '2026-10-31T10:00:00Z' }, { latest: '1.4.0', checkedAt: 'yesterday' }, { latest: 7, checkedAt: 1 }, 'text', [], null]) {
      writeUserConfig({ updateCache: bad }, env)
      expect(readUpdateCache(env)).toBeNull()
    }
  })
  test('the notice appears only for a newer version and goes when cleared', () => {
    writeUpdateCache('1.4.0', Date.now(), env)
    expect(updateNotice({ current: '1.3.2', env })).toMatchObject({ latest: '1.4.0', current: '1.3.2' })
    expect(updateNotice({ current: '1.4.0', env })).toBeNull()
    expect(updateNotice({ current: '1.5.0', env })).toBeNull()
    expect(updateNotice({ current: 'unknown', env })).toBeNull()
    clearUpdateCache(env)
    expect(updateNotice({ current: '1.3.2', env })).toBeNull()
  })
  test('the default mode is notify (a daily look-up, nothing installed) and off can be chosen', () => {
    expect(updateMode(env)).toBe('notify')
    writeUserConfig({ updates: 'off' }, env)
    expect(updateMode(env)).toBe('off')
  })
  test('the daily rule', () => {
    const t0 = Date.parse('2026-10-31T10:00:00Z')
    expect(checkDue({ mode: 'notify', env, now: t0 })).toBe(true) // never checked
    writeUpdateCache('1.4.0', t0, env)
    expect(checkDue({ mode: 'notify', env, now: t0 + DAY_MS - 1000 })).toBe(false)
    expect(checkDue({ mode: 'notify', env, now: t0 + DAY_MS })).toBe(true)
    expect(checkDue({ mode: 'auto', env, now: t0 + DAY_MS })).toBe(true)
    expect(checkDue({ mode: 'off', env, now: t0 + 10 * DAY_MS })).toBe(false)
  })

  const repo = resolve('/meerkat/clone')
  const answers: Record<string, string> = { 'rev-parse --show-toplevel': `${repo}\n`, 'symbolic-ref': 'origin/main\n', 'fetch --quiet origin': '', 'rev-list --count': '2\n', 'log --format=%s': 'a\nb', 'show origin/main:package.json': '{"version":"1.4.0"}' }
  const exec = (calls: string[][]) => (cmd: string, args: string[]) => {
    calls.push(args)
    const key = args.join(' ')
    for (const [k, v] of Object.entries(answers)) if (key === k || key.startsWith(k)) return v
    throw new Error(`unexpected git ${key}`)
  }

  test('the default mode looks up once a day with an injected clock, remembers the answer, installs nothing', () => {
    const calls: string[][] = []
    const events: string[] = []
    const t0 = Date.parse('2026-10-31T10:00:00Z')
    const run = (now: number) => maybeAutoUpdate({ repoDir: repo, exec: exec(calls), env, now, print: () => {}, onCheck: () => events.push('check'), onDone: () => events.push('done') })
    expect(run(t0)).toMatchObject({ ran: true })
    expect(events).toEqual(['check', 'done'])
    expect(readUpdateCache(env)).toEqual({ latest: '1.4.0', checkedAt: t0 })
    expect(updateNotice({ current: '1.3.2', env })).not.toBeNull()
    const n = calls.length
    expect(run(t0 + 3600e3)).toMatchObject({ ran: false })
    expect(calls.length).toBe(n)
    expect(run(t0 + DAY_MS + 1)).toMatchObject({ ran: true })
    expect(calls.some((a) => a[0] === 'merge')).toBe(false)
  })
  test('a failed or timed-out look-up leaves no notice and is not retried the same day', () => {
    const t0 = Date.parse('2026-10-31T10:00:00Z')
    const calls: string[][] = []
    const boom = (cmd: string, args: string[]) => {
      calls.push(args)
      if (args[0] === 'fetch') throw new Error('timed out')
      return exec([])(cmd, args)
    }
    expect(maybeAutoUpdate({ repoDir: repo, exec: boom, env, now: t0 })).toMatchObject({ ran: true })
    expect(readUpdateCache(env)).toBeNull()
    const n = calls.length
    expect(maybeAutoUpdate({ repoDir: repo, exec: boom, env, now: t0 + 1000 })).toMatchObject({ ran: false })
    expect(calls.length).toBe(n)
  })
  test('mode off never calls out, yet an earlier manual check still shows the bar', () => {
    writeUserConfig({ updates: 'off' }, env)
    writeUpdateCache('1.4.0', Date.now(), env)
    const calls: string[][] = []
    expect(maybeAutoUpdate({ repoDir: repo, exec: exec(calls), env, now: Date.now() + 5 * DAY_MS })).toMatchObject({ ran: false, why: 'off' })
    expect(calls).toEqual([])
    expect(updateNotice({ current: '1.3.2', env })).not.toBeNull()
  })
  test('a successful update clears the notice', async () => {
    writeUserConfig({ updates: 'auto' }, env)
    writeUpdateCache('1.4.0', Date.now(), env)
    let merged = false
    const ex = (cmd: string, args: string[]) => {
      const key = args.join(' ')
      if (key.startsWith('merge --ff-only')) return ((merged = true), '')
      if (key === 'status --porcelain' || key.startsWith('merge-base')) return ''
      if (key.startsWith('show')) return JSON.stringify({ version: merged || key.startsWith('show origin') ? '1.4.0' : '1.3.2' })
      return exec([])(cmd, args)
    }
    const r = maybeAutoUpdate({ repoDir: repo, exec: ex, env, now: Date.now() + 2 * DAY_MS })
    expect(r.applied).toMatchObject({ ok: true })
    expect(readUpdateCache(env)).toBeNull()
  })
  test('meerkat update --check writes the cache; status shows the setting, the latest and when', async () => {
    let text = ''
    const stdout = { write: (t: string) => ((text += t), true) }
    await runUpdateCommand({ kind: 'update', action: 'check', yes: false }, { repoDir: repo, exec: exec([]), env, stdout: stdout as never, home: dir })
    expect(readUpdateCache(env)?.latest).toBe('1.4.0')
    text = ''
    await runUpdateCommand({ kind: 'update', action: 'status' }, { repoDir: repo, env, stdout: stdout as never, home: dir })
    expect(text).toContain('Update mode: notify')
    expect(text).toMatch(/Latest version known: 1\.4\.0 \(checked 20\d\d-/)
    expect(text).toContain('never installs without you')
    clearUpdateCache(env)
    expect(statusText(env)).toContain('none yet')
    expect(readUserConfig(env).updateCache).toBeUndefined()
  })
})
