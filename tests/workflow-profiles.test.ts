// Workflow profiles (profiles/*.json, lib/workflow-profiles.mjs) and `meerkat init --profile <name>`.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { EXTRA_WORDS } from '../lib/extras-words.mjs'
import { planCommand } from '../lib/cli.mjs'
import { readConfig } from '../lib/config.mjs'
import { PRESETS } from '../lib/presets.mjs'
import { configFor, loadProfile, profileNames, profileProblems, runInitProfile } from '../lib/workflow-profiles.mjs'
import { parseArgs } from '../run.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SIX = ['ai-agent', 'ci-only', 'legacy', 'monorepo', 'solo', 'team']

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const project = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-wf-'))
  made.push(d)
  writeFileSync(join(d, 'package.json'), '{"name":"demo"}\n')
  return d
}
const run = (argv: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const code = runInitProfile(argv, { out: (t: string) => out.push(t), err: (t: string) => err.push(t) })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('workflow profiles', () => {
  test('the six profiles exist as data files under profiles/, one JSON file each', () => {
    expect(profileNames()).toEqual(SIX)
    expect(readdirSync(join(ROOT, 'profiles')).sort()).toEqual(SIX.map((n) => `${n}.json`))
  })

  test.each(SIX)('profile %s loads, is valid, names a real preset, scope, blocking checks, output format and cache use', (name) => {
    const p = loadProfile(name)
    expect(profileProblems(p)).toEqual([])
    expect(p.name).toBe(name)
    expect(Object.keys(PRESETS)).toContain(p.preset)
    expect(['all', 'changed', 'package']).toContain(p.scope.mode)
    expect(p.blocking.failOn).toMatch(/^(critical|high|medium|low|info)$/)
    expect(['text', 'json', 'github']).toContain(p.output.format)
    expect(['on', 'off']).toContain(p.cache)
    expect(JSON.stringify(p)).not.toContain('—')
    expect(JSON.stringify(p)).not.toMatch(/[A-Za-z]:\\|\/Users\//)
  })

  test('the profiles differ in the ways their descriptions say', () => {
    expect(loadProfile('solo').hooks).toEqual(['pre-commit'])
    expect(loadProfile('solo').pullRequestGate).toBe(false)
    expect(loadProfile('team').pullRequestGate).toBe(true)
    expect(loadProfile('team').baseline).toBe('existing-debt')
    expect(loadProfile('ai-agent').output.format).toBe('json')
    expect(loadProfile('legacy').baseline).toBe('everything')
    expect(loadProfile('monorepo').scope.mode).toBe('package')
    expect(loadProfile('ci-only').hooks).toEqual([])
    expect(loadProfile('ci-only').preset).toBe('full')
    expect(loadProfile('ci-only').cache).toBe('off')
  })

  test.each(SIX)('every command of profile %s is a command Meerkat really accepts', (name) => {
    for (const cmd of Object.values(loadProfile(name).commands) as string[]) {
      const argv = cmd.replace(/^meerkat /, '').replace('<file>', 'lib/gate.mjs').replace('<package-folder>', 'packages/web').split(/\s+/)
      if (EXTRA_WORDS.includes(argv[0])) continue // gate, baseline, hook, brief: handled by lib/extras-cli.mjs, which has its own usage errors
      const plan: any = planCommand(argv, { cwd: ROOT, env: {}, interactive: false, presets: { user: {}, project: {} } })
      expect(plan.kind, `${cmd}: ${plan.message ?? ''}`).not.toBe('error')
      if (plan.kind === 'run') expect(parseArgs(plan.args).errors, cmd).toEqual([])
    }
  })

  test('a profile with a problem is described, not used', () => {
    expect(profileProblems({})).toContain('"name" is missing')
    const p = { ...loadProfile('solo'), preset: 'no-such-preset', commands: { x: 'rm -rf /' } }
    expect(profileProblems(p).join(' ')).toMatch(/preset/)
    expect(profileProblems(p).join(' ')).toMatch(/commands/)
  })

  test('configFor keeps the detected packs and records what the profile chose, and the result reads back with no notes', () => {
    const cfg: any = configFor(loadProfile('legacy'), { packs: ['security', 'hygiene'] })
    expect(cfg.packs).toEqual(['security', 'hygiene'])
    expect(cfg.workflow.profile).toBe('legacy')
    const d = project()
    const file = join(d, 'meerkat.config.json')
    writeFileSync(file, JSON.stringify(cfg))
    const read: any = readConfig(file)
    expect(read.notes).toEqual([])
    expect(read.config.workflow.profile).toBe('legacy')
    expect(read.config.packs).toEqual(['security', 'hygiene'])
  })
})

describe('meerkat init --profile', () => {
  test('without --write it prints the config and writes nothing', () => {
    const d = project()
    const before = readdirSync(d).sort()
    const r = run(['init', '--profile', 'team', d])
    expect(r.code).toBe(0)
    expect(readdirSync(d).sort()).toEqual(before)
    expect(existsSync(join(d, 'meerkat.config.json'))).toBe(false)
    const printed = JSON.parse(r.out.slice(0, r.out.indexOf('\n}\n') + 2))
    expect(printed.workflow.profile).toBe('team')
    expect(r.out).toContain('Dry run: nothing written')
    expect(r.out).toContain('meerkat gate --base origin/main --format github')
  })

  test('--write creates meerkat.config.json with exactly the config it printed', () => {
    const d = project()
    const dry = run(['init', '--profile', 'solo', d])
    const wrote = run(['init', '--profile', 'solo', '--write', d])
    expect(wrote.code).toBe(0)
    const onDisk = JSON.parse(readFileSync(join(d, 'meerkat.config.json'), 'utf8'))
    expect(onDisk).toEqual(JSON.parse(dry.out.slice(0, dry.out.indexOf('\n}\n') + 2)))
  })

  test('--write refuses to overwrite an existing config, and leaves it as it was', () => {
    const d = project()
    const file = join(d, 'meerkat.config.json')
    writeFileSync(file, '{"packs":["mine"]}\n')
    const r = run(['init', '--profile', 'team', '--write', d])
    expect(r.code).toBe(1)
    expect(r.err).toContain('already exists')
    expect(readFileSync(file, 'utf8')).toBe('{"packs":["mine"]}\n')
    const dry = run(['init', '--profile', 'team', d])
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('--write would refuse')
    expect(readFileSync(file, 'utf8')).toBe('{"packs":["mine"]}\n')
  })

  test('--write --force replaces it; --force alone is a usage error', () => {
    const d = project()
    const file = join(d, 'meerkat.config.json')
    writeFileSync(file, '{"packs":["mine"]}\n')
    expect(run(['init', '--profile', 'ci-only', '--force', d]).code).toBe(2)
    expect(readFileSync(file, 'utf8')).toBe('{"packs":["mine"]}\n')
    expect(run(['init', '--profile', 'ci-only', '--write', '--force', d]).code).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8')).workflow.profile).toBe('ci-only')
  })

  test('an unknown profile, a missing name and a path-shaped name are usage errors that list the real ones', () => {
    const d = project()
    for (const bad of [['--profile', 'nope'], ['--profile'], ['--profile', '../profiles/team'], ['--profile', 'team.json']]) {
      const r = run(['init', ...bad, d])
      expect(r.code, bad.join(' ')).toBe(2)
      expect(r.err).toContain('team')
    }
    expect(readdirSync(d)).toEqual(['package.json'])
  })

  test('through the real command line: no --write leaves the folder alone, --write then a second --write refuses', () => {
    const d = project()
    const bin = join(ROOT, 'bin', 'meerkat.mjs')
    const go = (...a: string[]) => spawnSync(process.execPath, [bin, 'init', '--profile', 'monorepo', d, ...a], { encoding: 'utf8' })
    const dry = go()
    expect(dry.status).toBe(0)
    expect(dry.stdout).toContain('"profile": "monorepo"')
    expect(existsSync(join(d, 'meerkat.config.json'))).toBe(false)
    expect(go('--write').status).toBe(0)
    mkdirSync(join(d, 'x'))
    const again = go('--write')
    expect(again.status).toBe(1)
    expect(again.stderr).toContain('already exists')
  })
})
