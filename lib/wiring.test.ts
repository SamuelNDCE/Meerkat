// Wiring for presets that bring packs, personal presets (~/.meerkat.json), extra pack folders, --list-presets and the estimate wording.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { applyConfig } from './config.mjs'
import { loadChecks } from './load-checks.mjs'
import { mergePresets, PRESETS, resolvePreset } from './presets.mjs'
import { durationText, parseArgs, presetLines } from '../run.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meerkat-wiring-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const config = (packs: string[]) => ({ packs, extraChecks: [], disable: [], override: {}, budget: null, presets: {} })

describe('presets can bring packs and personal presets', () => {
  test('a preset returns its packs, dropping any name that is not plain', () => {
    expect(resolvePreset('mine', { mine: { tier: 'fast', packs: ['hygiene', 'Bad Name!', 3] } }).preset?.packs).toEqual(['hygiene'])
    expect(resolvePreset('quick').preset?.packs).toEqual([])
  })

  test('a project preset beats a personal one, which beats a bundled one', () => {
    const personal = {
      quick: { tier: 'thorough', groups: [], about: 'personal quick' },
      mine: { tier: 'fast', groups: ['ui'], about: 'personal mine' },
    }
    const project = { mine: { tier: 'thorough', groups: ['security'], about: 'project mine' } }
    const merged = mergePresets(project, personal)
    expect(resolvePreset('mine', merged).preset).toMatchObject({ about: 'project mine', tier: 'thorough', groups: ['security'] })
    expect(resolvePreset('quick', merged).preset).toMatchObject({ about: 'personal quick', tier: 'thorough' })
    expect(resolvePreset('security', merged).preset).toMatchObject({ tier: 'thorough', groups: ['security'] })
    expect(resolvePreset('quick', mergePresets({}, {})).preset).toMatchObject({ about: PRESETS.quick.about })
  })

  test('applyConfig finds a pack in an extra pack folder, and says so when none has it', async () => {
    const packs = join(dir, 'my-packs')
    mkdirSync(join(packs, 'wiring-pack'), { recursive: true })
    writeFileSync(
      join(packs, 'wiring-pack', 'probe.mjs'),
      "export default [{ id: 'wiring-probe', group: 'functionality', tier: 'fast', lane: 'free', title: 'Probe from an extra folder', estSeconds: 1, run: { cmd: 'node', args: ['-e', ''] } }]\n",
    )
    const found = await applyConfig([], config(['wiring-pack']), { extraPackDirs: [packs], load: loadChecks })
    expect(found.checks.map((c: { id: string }) => c.id)).toContain('wiring-probe')
    expect(found.notes).toEqual([])
    const missing = await applyConfig([], config(['no-such-pack']), { extraPackDirs: [packs], load: loadChecks })
    expect(missing.notes.join(' ')).toContain('not found or empty')
  })
})

describe('wording and flags', () => {
  test('one second is said as one second, more is plural', () => {
    expect(durationText(1000)).toBe('1 second')
    expect(durationText(1400)).toBe('1 second')
    expect(durationText(5000)).toBe('5 seconds')
    expect(durationText(120_000)).toBe('2 minutes')
  })

  test('--list-presets is read, and each name shows once, from its winning source', () => {
    expect(parseArgs(['--list-presets']).listPresets).toBe(true)
    const lines = presetLines(
      { mine: { tier: 'thorough', groups: ['security'], about: 'project mine' } },
      { quick: { tier: 'thorough', about: 'personal quick' }, mine: { tier: 'fast', about: 'personal mine' } },
    )
    expect(lines).toHaveLength(Object.keys(PRESETS).length + 1)
    expect(lines.find((l) => l.startsWith('quick'))).toMatch(/^quick\s+personal\s+thorough\s+all\s+personal quick$/)
    expect(lines.find((l) => l.startsWith('mine'))).toMatch(/^mine\s+project\s+thorough\s+security\s+project mine$/)
  })
})
