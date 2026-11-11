// Settings audit: every documented setting, variable and flag must be read by code. A documented setting that nothing reads does nothing,
// and that is a bug in the docs or in the code. These tests fail the day one appears.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { applyConfig, KNOWN_KEYS, readConfig } from '../lib/config.mjs'
import { defaultParallel } from '../lib/priority.mjs'
import { COMMANDS } from '../lib/help.mjs'
import { disabledIn, evaluate, GUIDELINES } from '../lib/guidelines.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const tracked = (...paths: string[]) => execFileSync('git', ['ls-files', ...paths], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')
const isCode = (f: string) => /\.(mjs|js|cjs|py)$/.test(f) && !/\.test\.|(^|\/)tests\//.test(f)
const codeFiles = tracked('lib', 'bin', 'packs', 'thorough', 'tools', 'run.mjs').filter(isCode)
const codeText = codeFiles.map((f) => [f, read(f)] as const)
const withoutHelp = codeText.filter(([f]) => f !== 'lib/help.mjs')

describe('config keys', () => {
  // Keys that readConfig keeps and a file OTHER than config.mjs reads. Applied inside config.mjs itself (applyConfig): packs, extraChecks, disable, disableSubs, override.
  const INSIDE_CONFIG = ['packs', 'extraChecks', 'disable', 'disableSubs', 'override']
  // "workflow" is a record `meerkat init --profile` writes; docs/reference.md says Meerkat acts on none of it. "$schema" is for editors.
  const RECORD_ONLY = ['workflow', '$schema']

  test('every KNOWN_KEY is read by code (or is listed as a record with a stated reason)', () => {
    for (const key of KNOWN_KEYS) {
      if (RECORD_ONLY.includes(key) || INSIDE_CONFIG.includes(key)) continue
      const readers = codeText.filter(([f, t]) => f !== 'lib/config.mjs' && new RegExp(`(\\.|\\?\\.|\\[['"]|['"])${key.replace('$', '\\$')}\\b`).test(t)).map(([f]) => f)
      expect(readers.length, `config key "${key}" is in KNOWN_KEYS but no file reads it`).toBeGreaterThan(0)
    }
  })

  test('the keys applied in config.mjs really change the checks (packs excepted, needs files)', async () => {
    const builtIn = [
      { id: 'a-one', title: 'a', group: 'security', tier: 'fast', lane: 'free', run: { cmd: 'node', args: ['-v'] } },
      { id: 'a-two', title: 'b', group: 'security', tier: 'fast', lane: 'free', run: { cmd: 'node', args: ['-v'] } },
    ]
    const out = await applyConfig(builtIn as any, { packs: [], extraChecks: [], disable: ['a-one'], disableSubs: ['a-two/x-rule'], override: { 'a-two': { title: 'renamed' } }, customChecks: [], suites: {} } as any, { noProjectCode: true })
    expect(out.checks.map((c: any) => c.id)).toEqual(['a-two'])
    expect(out.checks[0].title).toBe('renamed')
    expect(out.disabled.map((d: any) => d.id)).toEqual(['a-one'])
    expect(out.disabledSubs).toEqual(['a-two/x-rule'])
  })

  test('guidelines.disable turns a guideline off (the documented example)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mk-settings-'))
    try {
      const id = GUIDELINES[0].id
      writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ guidelines: { disable: [id, 'g-not-real'] } }))
      expect(disabledIn(dir)).toContain(id)
      const ctx: any = { files: [], lines: 0, committed: [], subject: '', read: () => '', codeFlags: [], docText: '', lastRunDir: null }
      const off = evaluate(ctx, { disable: disabledIn(dir) }).find((r: any) => r.id === id)!
      expect(off.status).toBe('NOT CHECKED')
      expect(off.detail).toContain('guidelines.disable')
      // and it is a known key, so the config reader does not call it a typo
      expect(readConfig(join(dir, 'meerkat.config.json')).notes).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('budget, allowWrites and ignorePaths are parsed from the file into what run.mjs reads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mk-settings-'))
    try {
      const f = join(dir, 'meerkat.config.json')
      writeFileSync(f, JSON.stringify({ budget: { cpu: 2, maxParallel: 3, reserveGB: 1 }, allowWrites: ['x.lock'], ignorePaths: ['old/**'] }))
      const { config, notes } = readConfig(f)
      expect(notes).toEqual([])
      expect(config.budget).toEqual({ cpu: 2, maxParallel: 3, reserveGB: 1 })
      expect((config as any).ignorePaths).toEqual(['old/**'])
      expect(read('run.mjs')).toMatch(/read\.config\.allowWrites/)
      expect(read('run.mjs')).toMatch(/read\.config\.budget\?\.maxParallel/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('environment variables', () => {
  // A documented variable that no code file reads would do nothing. Each entry here is read indirectly; the reason is stated.
  const READ_INDIRECTLY: Record<string, string> = {
    MEERKAT_SKIP_ACCURACY: 'read by lib/accuracy.test.ts, the guard docs/accuracy.md describes (test files are not scanned as code)',
  }

  test('every MEERKAT_* name in the docs is read by a code file', () => {
    const docs = tracked('docs', 'README.md', 'llms.txt', 'CONTRIBUTING.md', 'SECURITY.md', 'skills').filter((f) => /\.(md|txt)$/.test(f))
    const documented = new Set<string>()
    for (const f of docs) for (const m of read(f).matchAll(/\bMEERKAT_[A-Z0-9_]+\b/g)) documented.add(m[0])
    const helpVars = new Set<string>([...read('lib/help.mjs').matchAll(/\bMEERKAT_[A-Z0-9_]+\b/g)].map((m) => m[0]))
    const dead: string[] = []
    for (const v of [...documented, ...helpVars]) {
      if (READ_INDIRECTLY[v]) continue
      const re = new RegExp(`\\b${v}\\b`)
      if (!withoutHelp.some(([, t]) => re.test(t))) dead.push(v)
    }
    expect(dead, `documented but read by no code: ${dead.join(', ')}`).toEqual([])
  })

  test('the allow list only names variables that really are documented (it cannot go stale)', () => {
    const docText = tracked('docs').map(read).join('\n')
    for (const v of Object.keys(READ_INDIRECTLY)) expect(docText, v).toContain(v)
  })

  test('MEERKAT_PRIORITY=normal changes the parallelism the documented way', () => {
    const low = defaultParallel(8, {} as any)
    const normal = defaultParallel(8, { MEERKAT_PRIORITY: 'normal' } as any)
    expect(normal).toBeGreaterThanOrEqual(low)
    expect(normal).toBe(7)
  })
})

describe('command flags', () => {
  test('every flag in meerkat help is mentioned by code other than the help text', () => {
    const flags = new Set<string>()
    const text = JSON.stringify(COMMANDS)
    for (const m of text.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]+)/g)) flags.add(m[1])
    // Flags that belong to another program and only appear inside an example command line.
    const OTHER_PROGRAMS = ['--body-file']
    const dead = [...flags].filter((f) => !OTHER_PROGRAMS.includes(f) && !withoutHelp.some(([, t]) => t.includes(f) || t.includes(f.slice(2))))
    expect(dead, `in help but read by no code: ${dead.join(', ')}`).toEqual([])
  })

  test('every option a small command lists in help is accepted by its parser', async () => {
    const { SMALL_COMMANDS } = await import('../lib/flagcheck.mjs')
    const GLOBAL = ['--json', '-q', '--quiet', '--no-color', '-y', '--yes', '--no-input', '--dry-run', '-h', '--help']
    const rejected: string[] = []
    for (const c of COMMANDS as any[]) {
      const spec = (SMALL_COMMANDS as any)[c.name]
      if (!spec) continue
      const ok = new Set([...GLOBAL, ...spec.switches, ...spec.values])
      for (const o of c.options ?? []) for (const f of o.flag.match(/--?[a-z][a-z0-9-]*/g) ?? []) if (!ok.has(f)) rejected.push(`${c.name} ${f}`)
    }
    expect(rejected).toEqual([])
  })
})
