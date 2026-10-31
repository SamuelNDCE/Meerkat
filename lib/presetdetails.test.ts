// Preset descriptions: validation of about and purpose, the details screen (pure layout), the d key, and `preset edit` / `preset show`.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { loadPresets, planCommand } from './cli.mjs'
import { execute } from './commands.mjs'
import { readConfig } from './config.mjs'
import { browseStep, initialState, menuItems, menuStep, pickerState, pickerStep } from './menu.mjs'
import { detailsRows, detailsStep, detailsText, renderDetails } from './presetdetails.mjs'
import { ABOUT_MAX, cleanAbout, cleanPurpose, PRESETS, PURPOSE_MAX, resolvePreset } from './presets.mjs'

const strip = (t: string) => t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

const sample = {
  name: 'ci',
  source: 'bundled',
  tier: 'fast',
  kinds: ['security', 'functionality'],
  include: [] as string[],
  packs: [] as string[],
  about: 'quick security and functionality checks',
  purpose: PRESETS.ci.purpose,
  checks: [
    { id: 'secret-scan', kind: 'security', seconds: 3, title: 'Secret scan: keys, tokens and private keys in tracked files' },
    { id: 'risky-code', kind: 'security', seconds: 3, title: 'Risky calls: eval, shell strings, disabled TLS checks, weak hashes, plain http' },
    { id: 'build', kind: 'functionality', seconds: 45, title: 'The project builds' },
    { id: 'unit-tests', kind: 'functionality', seconds: 150, title: 'Unit tests pass' },
  ],
  estimateSeconds: 63,
}

describe('about and purpose validation', () => {
  test('text is trimmed, control characters removed, and cut to the limit', () => {
    expect(cleanAbout('  hello \x07world\n next\t line  ')).toBe('hello world next line')
    expect(cleanAbout('\x1b[31mred\x1b[0m')).not.toContain('\x1b')
    expect(cleanAbout('x'.repeat(500))).toHaveLength(ABOUT_MAX)
    expect(cleanPurpose('y'.repeat(900))).toHaveLength(PURPOSE_MAX)
    expect(ABOUT_MAX).toBe(200)
    expect(PURPOSE_MAX).toBe(600)
  })
  test('something that is not text becomes empty', () => {
    for (const v of [undefined, null, 5, {}, ['a'], true]) {
      expect(cleanAbout(v)).toBe('')
      expect(cleanPurpose(v)).toBe('')
    }
  })
  test('resolvePreset cleans custom presets, ignores extra keys, and old presets without the fields still work', () => {
    const r = resolvePreset('mine', { mine: { tier: 'thorough', groups: ['ui'], about: ' one\nline ', purpose: 'p'.repeat(700), colour: 'red' } }).preset
    expect(r.about).toBe('one line')
    expect(r.purpose).toHaveLength(PURPOSE_MAX)
    expect(r).not.toHaveProperty('colour')
    const old = resolvePreset('old', { old: { tier: 'fast', groups: [] } }).preset
    expect(old).toMatchObject({ tier: 'fast', about: '', purpose: '' })
  })
  test('the project config reader drops a description that is not text and says so', () => {
    const file = '/x/meerkat.config.json'
    const r = readConfig(file, () => JSON.stringify({ presets: { a: { tier: 'fast', about: 5, purpose: '  ok \x07 ', extra: 1 }, b: { tier: 'fast', about: 'fine' } } }))
    expect(r.config.presets.a).toEqual({ tier: 'fast', purpose: 'ok', extra: 1 })
    expect(r.config.presets.b.about).toBe('fine')
    expect(r.notes.join('\n')).toContain('"about" must be text')
  })
})

describe('the bundled purposes', () => {
  test('every bundled preset has a purpose of two or three plain sentences, with no em dash', () => {
    for (const [name, p] of Object.entries(PRESETS) as [string, { about: string; purpose?: string }][]) {
      expect(p.purpose, name).toBeTruthy()
      const sentences = (p.purpose as string).split(/(?<=[.!?])\s+/).filter(Boolean)
      expect(sentences.length, name).toBeGreaterThanOrEqual(2)
      expect(sentences.length, name).toBeLessThanOrEqual(4)
      expect((p.purpose as string).length, name).toBeLessThanOrEqual(PURPOSE_MAX)
      expect(p.purpose, name).not.toContain('—')
      expect(resolvePreset(name).preset?.purpose, name).toBe(p.purpose)
    }
  })
})

describe('the details screen layout', () => {
  test.each([40, 60, 80, 120])('no line is wider than the window at %i columns, in plain text', (width) => {
    for (const r of detailsRows(sample, { width })) expect(r.text.length, r.text).toBeLessThanOrEqual(width - 1)
    const view = renderDetails(sample, { width, rows: 60, color: false, env: { NO_COLOR: '1' } })
    for (const l of view.lines) expect(strip(l.text).length).toBeLessThanOrEqual(width - 1)
  })
  test('it names the preset, where it is from, the purpose, and every check grouped by kind with counts and times', () => {
    const text = detailsText(sample, { width: 100 })
    expect(text).toContain('ci')
    expect(text).toMatch(/From\s+bundled/)
    expect(text).toMatch(/Tier\s+fast/)
    expect(text).toMatch(/Kinds\s+security, functionality/)
    expect(text).toMatch(/Packs\s+none/)
    expect(text).toMatch(/Time\s+about 63 seconds for 4 checks/)
    expect(text).toContain('Purpose')
    expect(text).toContain('Made for a build server')
    expect(text).toContain('What it runs here (4 checks)')
    expect(text).toContain('security (2)')
    expect(text).toContain('functionality (2)')
    expect(text).toMatch(/secret-scan\s+~3s\s+Secret scan/)
    expect(text).toMatch(/unit-tests\s+~3m\s+Unit tests pass/)
  })
  test('a custom preset with no purpose is told how to add one; a project preset says where it lives', () => {
    const text = detailsText({ ...sample, name: 'mine', source: 'project', purpose: '', packs: ['rust'], include: ['ai'] }, { width: 80 })
    expect(text).toContain('meerkat preset edit mine --purpose')
    expect(text).toMatch(/From\s+project/)
    expect(text).toMatch(/Packs\s+brings the rust pack/)
    expect(text).toMatch(/Also runs\s+ai/)
  })
  test('a preset that selects nothing says so', () => {
    expect(detailsText({ ...sample, checks: [], estimateSeconds: 0 }, { width: 80 })).toContain('It selects no checks')
  })
  test('control characters in a name or title never reach the screen', () => {
    const evil = { ...sample, name: 'a\x1b[2Jb', checks: [{ id: 'x\x07y', kind: 'ui', seconds: 1, title: 'T\x1b[31mitle' }] }
    expect(detailsText(evil, { width: 80 })).not.toMatch(/[\x00-\x09\x0b-\x1f]/)
  })
  test('the screen is never taller than the window, scrolls, and keeps the offset in range', () => {
    const many = { ...sample, checks: Array.from({ length: 40 }, (_, i) => ({ id: `check-${i}`, kind: 'security', seconds: 2, title: `Check number ${i}` })) }
    const top = renderDetails(many, { rows: 20, width: 80, offset: 0 })
    expect(top.lines.length).toBeLessThanOrEqual(19)
    expect(top.maxOffset).toBeGreaterThan(0)
    expect(strip(top.lines.map((l) => l.text).join('\n'))).toMatch(/\d+ more below/)
    const end = renderDetails(many, { rows: 20, width: 80, offset: 9999 })
    expect(end.offset).toBe(end.maxOffset)
    expect(strip(end.lines.map((l) => l.text).join('\n'))).toContain('more above')
    expect(strip(end.lines.map((l) => l.text).join('\n'))).toContain('check-39')
  })
  test('a tall window with colour draws the meerkat; a short one keeps the one-line header', () => {
    const tall = renderDetails(sample, { rows: 50, width: 100, color: true, level: 'truecolor', env: {}, version: '1.0.0' })
    expect(tall.lines.some((l) => /▀|▄/.test(l.text))).toBe(true)
    const short = renderDetails(sample, { rows: 24, width: 100, color: true, level: 'truecolor', env: {}, version: '1.0.0' })
    expect(short.lines.some((l) => /▀|▄/.test(l.text))).toBe(false)
  })
  test('keys: Up/Down scroll when there is more, anything else goes back, Ctrl+C aborts', () => {
    expect(detailsStep(3, 'down', 10)).toEqual({ offset: 4, done: null })
    expect(detailsStep(3, 'j', 10)).toEqual({ offset: 4, done: null })
    expect(detailsStep(0, 'up', 10)).toEqual({ offset: 0, done: null })
    expect(detailsStep(10, 'down', 10)).toEqual({ offset: 10, done: null })
    expect(detailsStep(3, 'escape', 10).done).toBe('back')
    expect(detailsStep(3, 'x', 10).done).toBe('back')
    expect(detailsStep(0, 'down', 0).done).toBe('back')
    expect(detailsStep(3, 'ctrl-c', 10).done).toBe('abort')
  })
})

describe('the d key', () => {
  const items = () => menuItems({ user: {}, project: {} })
  test('only the preset menu has it: with the menu hotkeys d opens details, without them it does nothing', () => {
    const menu = { ...initialState(items()), hotkeys: { u: 'update', d: 'details' } }
    expect(menuStep(menu, 'd').action).toEqual({ type: 'hotkey', name: 'details' })
    expect(menuStep(menu, 'D').action).toEqual({ type: 'hotkey', name: 'details' })
    expect(menuStep(menu, 'u').action).toEqual({ type: 'hotkey', name: 'update' })
    expect(menuStep(initialState(items()), 'd').action).toBeNull()
    expect(menuStep(initialState(items(), { multi: true }), 'd').action).toBeNull()
  })
  test('the project picker and the folder browser still treat d as part of the filter', () => {
    const data = { here: null, recent: [{ name: 'dash', path: '/c/dash', isRepo: true, branch: 'main' }, { name: 'other', path: '/c/other', isRepo: true, branch: 'main' }], found: [] }
    const p = pickerStep(pickerState(data), 'd')
    expect(p.action).toBeNull()
    expect(p.state.filter).toBe('d')
    const b = browseStep({ dir: '/c', entries: [{ name: 'docs', path: '/c/docs', isRepo: false }], note: '', filter: '', cursor: 0 }, 'd', () => ({ entries: [], note: '' }))
    expect(b.action).toBeNull()
    expect(b.state.filter).toBe('d')
  })
  test('the menu hint tells you about it', () => {
    expect(readFileSync(new URL('./menu.mjs', import.meta.url), 'utf8')).toContain('d details')
  })
})

describe('preset show and preset edit', () => {
  let dir: string
  let env: Record<string, string>
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meerkat-desc-'))
    env = { MEERKAT_USER_CONFIG: join(dir, 'user.json'), MEERKAT_LOG_DIR: join(dir, 'logs') }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const run = async (argv: string[], extra: Record<string, unknown> = {}) => {
    const o: string[] = []
    const e: string[] = []
    const presets = loadPresets({ cwd: dir, env, home: dir })
    const p = planCommand(argv, { cwd: dir, env, interactive: false, presets })
    const code = await execute(p, { out: (t: string) => o.push(t), err: (t: string) => e.push(t), env, cwd: dir, interactive: false, presets, version: '9.9.9', ...extra })
    return { code, out: o.join('\n'), err: e.join('\n') }
  }
  const user = () => JSON.parse(readFileSync(join(dir, 'user.json'), 'utf8'))

  test('preset show prints the purpose and the checks; --json has purpose, about and the source', async () => {
    const text = await run(['preset', 'show', 'security-fast'])
    expect(text.code).toBe(0)
    expect(text.out).toContain('Purpose')
    expect(text.out).toContain(PRESETS['security-fast'].purpose.slice(0, 30))
    expect(text.out).toContain('What it runs here')
    const j = JSON.parse((await run(['preset', 'show', 'security-fast', '--json'])).out)
    expect(j).toMatchObject({ name: 'security-fast', source: 'bundled', about: PRESETS['security-fast'].about, purpose: PRESETS['security-fast'].purpose })
    expect(j.checks[0]).toHaveProperty('title')
  })
  test('preset list shows about', async () => {
    expect((await run(['preset', 'list'])).out).toContain(PRESETS.ci.about)
  })
  test('a personal preset made with --about and --purpose shows them in preset show', async () => {
    expect((await run(['preset', 'new', '--name', 'mine', '--tier', 'fast', '--group', 'security', '--about', 'my pushes', '--purpose', 'Run it before I push. It checks secrets only.'])).code).toBe(0)
    expect(user().presets.mine).toMatchObject({ about: 'my pushes', purpose: 'Run it before I push. It checks secrets only.' })
    const shown = await run(['preset', 'show', 'mine'])
    expect(shown.out).toContain('Run it before I push.')
    expect(shown.out).toMatch(/From\s+personal/)
  })
  test('preset new refuses a description that is too long', async () => {
    const r = await run(['preset', 'new', '--name', 'long', '--about', 'x'.repeat(ABOUT_MAX + 1)])
    expect(r.code).toBe(2)
    expect(r.err).toContain('too long')
  })

  test('edit changes a personal preset, keeps its other keys, and clears with an empty text', async () => {
    writeFileSync(join(dir, 'user.json'), JSON.stringify({ cargoLock: 'keep', presets: { mine: { tier: 'thorough', groups: ['ui'], about: 'old' } } }))
    const r = await run(['preset', 'edit', 'mine', '--about', ' new line ', '--purpose', 'What it is for.'])
    expect(r.code).toBe(0)
    expect(user()).toMatchObject({ cargoLock: 'keep', presets: { mine: { tier: 'thorough', groups: ['ui'], about: 'new line', purpose: 'What it is for.' } } })
    expect((await run(['preset', 'edit', 'mine', '--purpose', ''])).code).toBe(0)
    expect(user().presets.mine).not.toHaveProperty('purpose')
    expect(user().presets.mine.about).toBe('new line')
  })
  test('edit changes a project preset in meerkat.config.json and keeps the file as it was', async () => {
    writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ packs: ['security'], disable: ['x'], presets: { 'before-release': { tier: 'thorough', groups: [] } } }, null, 2).replace(/\n/g, '\r\n'))
    const r = await run(['preset', 'edit', 'before-release', '--purpose', 'Run it the day before a release.'])
    expect(r.code).toBe(0)
    const text = readFileSync(join(dir, 'meerkat.config.json'), 'utf8')
    expect(text).toContain('\r\n')
    const back = JSON.parse(text)
    expect(back.presets['before-release']).toEqual({ tier: 'thorough', groups: [], purpose: 'Run it the day before a release.' })
    expect(back.disable).toEqual(['x'])
    const shown = await run(['preset', 'show', 'before-release'])
    expect(shown.out).toContain('Run it the day before a release.')
    expect(shown.out).toMatch(/From\s+project/)
  })
  test('a bundled preset cannot be edited, and an unknown one is reported', async () => {
    const r = await run(['preset', 'edit', 'security', '--about', 'mine now'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('bundled')
    expect(existsSync(join(dir, 'user.json'))).toBe(false)
    const n = await run(['preset', 'edit', 'nope', '--about', 'x'])
    expect(n.code).toBe(2)
    expect(n.err).toContain('No preset of yours')
  })
  test('edit --dry-run writes nothing', async () => {
    writeFileSync(join(dir, 'user.json'), JSON.stringify({ presets: { mine: { tier: 'fast', groups: [], about: 'old' } } }))
    const before = readFileSync(join(dir, 'user.json'), 'utf8')
    const r = await run(['preset', 'edit', 'mine', '--about', 'new', '--dry-run'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('Dry run')
    expect(readFileSync(join(dir, 'user.json'), 'utf8')).toBe(before)
  })
  test('edit with nothing to change and no terminal says what to pass; too long text is refused', async () => {
    writeFileSync(join(dir, 'user.json'), JSON.stringify({ presets: { mine: { tier: 'fast', groups: [] } } }))
    const none = await run(['preset', 'edit', 'mine'])
    expect(none.code).toBe(2)
    expect(none.err).toContain('--purpose')
    const long = await run(['preset', 'edit', 'mine', '--purpose', 'z'.repeat(PURPOSE_MAX + 1)])
    expect(long.code).toBe(2)
    expect(long.err).toContain('too long')
    const dangling = await run(['preset', 'edit', 'mine', '--about'])
    expect(dangling.code).toBe(2)
    expect(user().presets.mine).toEqual({ tier: 'fast', groups: [] })
  })
  test('edit asks in a terminal when no flag is given', async () => {
    writeFileSync(join(dir, 'user.json'), JSON.stringify({ presets: { mine: { tier: 'fast', groups: [], about: 'old' } } }))
    const answers = ['', 'Typed purpose.']
    const r = await run(['preset', 'edit', 'mine'], { interactive: true, ask: async () => answers.shift() ?? '' })
    expect(r.code).toBe(0)
    expect(user().presets.mine).toEqual({ tier: 'fast', groups: [], about: 'old', purpose: 'Typed purpose.' })
  })
})
