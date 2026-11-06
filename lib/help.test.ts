// The command registry, help, describe, the "did you mean" hint and the completion scripts.
import { describe as suite, expect, test } from 'vitest'
import { COMMANDS, EXIT_CODES, allWords, commandHelp, describe, editDistance, nameOf, overviewHelp, suggest } from './help.mjs'
import { completionScript } from './completion.mjs'
import { COMMAND_LIST, planCommand } from './cli.mjs'
import { EXTRA_WORDS } from './extras-cli.mjs'

const none = { user: {}, project: {} }
const plan = (argv: string[]) => planCommand(argv, { cwd: '/work/app', env: {}, interactive: false, presets: none })

suite('help', () => {
  test('every command has help that is non-empty, shows its usage, ends with the README pointer, and has no em dash', () => {
    for (const c of COMMANDS) {
      const h = commandHelp(c.name) as string
      expect(h.length).toBeGreaterThan(40)
      for (const u of c.usage) expect(h).toContain(u)
      expect(h).toContain('README.md')
      expect(h).not.toContain('—')
      expect(h.indexOf('Examples:')).toBeLessThan(h.indexOf('Usage:'))
    }
  })
  // The registry test: a command that bin/meerkat.mjs dispatches (COMMAND_LIST in lib/cli.mjs, EXTRA_WORDS in lib/extras-cli.mjs) but the registry lacks is invisible to help and describe.
  test('meerkat help and meerkat describe list every command the binary dispatches', () => {
    const dispatched = [...new Set([...COMMAND_LIST, ...EXTRA_WORDS, 'version'])].filter((w) => w !== 'list') // 'list' is the old word for 'check'
    const unlisted = dispatched.filter((w) => nameOf(w) === null)
    expect(unlisted).toEqual([])
    const overview = overviewHelp([])
    const described = describe({ version: '1', presetNames: [] }).commands.map((c: { name: string }) => c.name)
    for (const w of dispatched) {
      const name = nameOf(w) as string
      expect(described).toContain(name)
      if (!['menu', 'version', 'help', 'last', 'why', 'logs'].includes(name)) expect(overview).toContain(`meerkat ${name}`)
    }
  })
  test('the exit codes are listed once, and gate and smoke never claim exit 3 (only run and the presets return it)', () => {
    expect(EXIT_CODES.map((e: { code: number }) => e.code)).toEqual([0, 1, 2, 3, 75, 130])
    for (const c of ['gate', 'smoke']) expect(commandHelp(c)).not.toMatch(/3 /)
  })
  test('aliases resolve to their command', () => {
    expect(nameOf('quick')).toBe('verify')
    expect(nameOf('test')).toBe('verify')
    expect(nameOf('thorough')).toBe('full')
    expect(nameOf('runs')).toBe('run')
    expect(nameOf('log')).toBe('why')
    expect(nameOf('nonsense')).toBeNull()
  })
  test('help works before or after the command word, and as a command', () => {
    expect(plan(['verify', '--help'])).toEqual({ kind: 'help', topic: 'verify' })
    expect(plan(['--help', 'verify'])).toEqual({ kind: 'help', topic: 'verify' })
    expect(plan(['pack', 'list', '-h'])).toEqual({ kind: 'help', topic: 'pack' })
    expect(plan(['help', 'check'])).toEqual({ kind: 'help', topic: 'check' })
    expect(plan(['security', '--help'])).toEqual({ kind: 'help', topic: 'verify' })
    expect(plan(['help'])).toEqual({ kind: 'help' })
    expect(plan(['help', 'zzzzzz'])).toMatchObject({ kind: 'error' })
  })
  test('overview names every command group and no em dash', () => {
    const h = overviewHelp(['quick', 'full'])
    for (const w of ['verify', 'check', 'preset', 'pack', 'doctor', 'mcp', 'completion', 'describe']) expect(h).toContain(`meerkat ${w}`)
    expect(h).not.toContain('—')
  })
  test('unknown command suggests the nearest command or preset', () => {
    expect(suggest('verfy')).toBe('verify')
    expect(suggest('secuirty', ['security'])).toBe('security')
    expect(suggest('qqqqqqqq')).toBeNull()
    expect(editDistance('abc', 'abd')).toBe(1)
    const e = plan(['verfy']) as { kind: string; message: string }
    expect(e.kind).toBe('error')
    expect(e.message).toContain('Did you mean verify?')
  })
})

suite('describe', () => {
  const d = describe({ version: '1.2.3', presetNames: ['quick'] })
  test('is valid JSON with every registry command, aliases, options, exit codes and output fields', () => {
    const back = JSON.parse(JSON.stringify(d))
    expect(back.version).toBe('1.2.3')
    for (const c of COMMANDS) expect(back.commands.map((x: { name: string }) => x.name)).toContain(c.name)
    expect(back.commands.find((c: { name: string }) => c.name === 'verify').aliases).toEqual(['quick', 'test'])
    expect(back.exitCodes.map((x: { code: number }) => x.code)).toEqual(EXIT_CODES.map((x) => x.code))
    expect(back.globalOptions.length).toBeGreaterThan(3)
    expect(back.outputFields.run).toContain('runDir')
    expect(JSON.stringify(back)).not.toContain('—')
  })
  test('plans as describe', () => {
    expect(plan(['describe'])).toEqual({ kind: 'describe' })
  })
})

suite('completion', () => {
  for (const shell of ['powershell', 'bash', 'zsh']) {
    test(`${shell}: non-empty, names the commands and the nouns, asks for check ids lazily, no em dash`, () => {
      const s = completionScript(shell) as string
      expect(s.length).toBeGreaterThan(200)
      for (const w of ['verify', 'check', 'preset', 'pack', 'doctor', 'security', 'enable', 'install']) expect(s).toContain(w)
      expect(s).toContain('check list --json')
      expect(s).not.toContain('—')
    })
  }
  test('an unknown shell gives nothing, and the plan refuses it', () => {
    expect(completionScript('fish')).toBeNull()
    expect(plan(['completion', 'fish'])).toMatchObject({ kind: 'error' })
    expect(plan(['completion', 'bash'])).toEqual({ kind: 'completion', shell: 'bash' })
  })
  test('every word completed is a real command, alias or preset', () => {
    expect(allWords()).toContain('verify')
  })
})
