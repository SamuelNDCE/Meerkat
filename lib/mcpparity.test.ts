// MCP parity with the CLI: folder-scoped reads, ratchet and run flags, the severity gate and export, version and tool count,
// the four new tools, structured output with a schemaVersion, and the folder-aware findings resource.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { handleMessage, TOOLS } from './mcp.mjs'
// @ts-expect-error plain .mjs module
import { readResource, RESOURCE_TEMPLATES } from './mcpextras.mjs'
// @ts-expect-error plain .mjs module
import { resolveRunFor, folderRuns } from './mcpruns.mjs'
// @ts-expect-error plain .mjs module
import { findingsCommand } from './findingscmd.mjs'
// @ts-expect-error plain .mjs module
import { planCommand } from './cli.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HERE = resolve('/work/proj')
const OTHER = resolve('/work/other')
const WORK = resolve('/work')
const doc = (projectPath: string) => ({
  run: { id: 'r1', project: { name: 'proj', path: projectPath } },
  counts: { total: 3, new: 1, known: 2, fixed: 0 },
  findings: [
    { id: 'aaaa1111', severity: 'high', rule: 'no-eval', check: 'risky', suite: 'code', file: 'src/a.js', line: 3, status: 'known', message: 'eval call', confidence: 'high', detectedBy: { check: 'risky' }, firstSeen: 'r0' },
    { id: 'bbbb2222', severity: 'low', rule: null, check: 'lint', suite: 'style', file: null, line: null, status: 'new', message: 'style' },
    { id: 'cccc3333', severity: 'medium', rule: 'x', check: 'lint', suite: 'style', file: 'b.js', line: 1, status: 'known', message: 'm' },
  ],
})

function makeCtx(over: Record<string, unknown> = {}) {
  const cli: string[][] = []
  const picks: unknown[] = []
  const meerkat: string[][] = []
  const ctx = {
    version: '9.9.9',
    cwd: HERE,
    now: () => Date.now(),
    isDirectory: (p: string) => p.startsWith(WORK),
    realpath: (p: string) => p,
    roots: () => [],
    readFile: () => '{}',
    latestRunDir: () => '/logs/run1',
    latestFindings: (pick: unknown) => {
      picks.push(pick ?? null)
      return { ok: true, dir: '/logs/run1', doc: doc(HERE) }
    },
    showLast: (pick: unknown) => {
      picks.push(pick ?? null)
      return { ok: true, text: '# Meerkat run: quick' }
    },
    showWhy: (id: string, lines: number, pick: unknown) => {
      picks.push(pick ?? null)
      return { ok: true, text: `why ${id} ${lines}` }
    },
    resolveRun: (q: { folder?: string; run?: string; preset?: string }) => {
      picks.push({ resolved: q })
      return { ok: true, dir: '/logs/runs/20261107-100000-proj--quick', id: '20261107-100000-proj--quick', project: { name: 'proj', path: q.folder ?? HERE }, preset: q.preset ?? 'quick', exitCode: 0 }
    },
    runInfo: () => ({ id: '20261107-100000-proj--quick', project: { name: 'proj', path: HERE }, preset: 'quick', exitCode: 0 }),
    listFolderRuns: () => [{ id: '20261107-100000-proj--quick', preset: 'quick', exitCode: 1, ms: 4200, startedAt: '2026-11-07T10:00:00.000Z' }],
    exportFile: (_dir: string, fmt: string) => ({ ok: true, file: `/logs/run1/findings.${fmt === 'sarif' ? 'sarif' : 'md'}` }),
    runMeerkat: async (argv: string[]) => {
      meerkat.push(argv)
      return { code: 1, stdout: '', stderr: '', timedOut: false }
    },
    runCli: async (argv: string[]) => {
      cli.push(argv)
      const word = argv[0]
      const body: Record<string, unknown> = {
        'check': [{ id: 'mine-one', origin: 'project', kind: 'security', tier: 'fast', title: 'mine' }, { id: 'risky-code', origin: 'bundled', kind: 'security', tier: 'fast', title: 'b' }],
        'pack': { folder: HERE, packs: [{ name: 'python', source: 'bundled', enabled: true, checks: 3, tools: [] }] },
        'prompt': { file: '/logs/run1/meerkat-prompt-x.md', short: 'read it', copied: false, findings: 3 },
      }
      return { code: 0, stdout: JSON.stringify(body[word] ?? {}), stderr: '', timedOut: false }
    },
    userPresets: () => ({}),
    presets: { quick: { tier: 'fast', groups: [], about: 'q' } },
    findingsSummary: () => ({ counts: { total: 3, new: 1, known: 2, fixed: 0 }, top: [], runFolder: '/logs/run1', findingsFile: '/logs/run1/findings.json' }),
    ...over,
  }
  return { ctx, cli, picks, meerkat }
}
const call = (ctx: unknown, name: string, args: unknown = {}) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx)
const isErr = (r: { result: { isError?: boolean } }) => r.result.isError === true
const text = (r: { result: { content: { text: string }[] } }) => r.result.content[0].text

describe('1. folder, run and preset on the read tools', () => {
  test.each(['meerkat_last', 'meerkat_findings', 'meerkat_suggest', 'meerkat_pr_comment'])('%s accepts folder, run and preset and says which project and run it read', async (name) => {
    const { ctx, picks } = makeCtx()
    const r = await call(ctx, name, { folder: HERE, preset: 'quick' })
    expect(isErr(r)).toBe(false)
    expect(picks).toContainEqual({ resolved: { folder: HERE, run: undefined, preset: 'quick' } })
    expect(text(r).split('\n')[0]).toMatch(/project proj/)
    expect(text(r).split('\n')[0]).toMatch(/run 20261107-100000-proj--quick/)
  })
  test('why and finding accept the same arguments', async () => {
    const { ctx, picks } = makeCtx()
    expect(isErr(await call(ctx, 'meerkat_why', { check: 'build', folder: HERE, run: '20261107-1000' }))).toBe(false)
    expect(isErr(await call(ctx, 'meerkat_finding', { id: 'aaaa1111', folder: HERE }))).toBe(false)
    expect(picks.filter((p: any) => p?.resolved).length).toBe(2)
  })
  test('without folder the old behaviour stays, and the result still names the project and run it read', async () => {
    const { ctx, picks } = makeCtx()
    const r = await call(ctx, 'meerkat_last', {})
    expect(picks.some((p: any) => p?.resolved)).toBe(false)
    expect(text(r).split('\n')[0]).toMatch(/project proj/)
    expect(r.result.structuredContent.context.project).toBe('proj')
  })
  test('a folder outside the roots, a UNC folder and a bad run are refused before anything is read', async () => {
    const { ctx, picks } = makeCtx()
    expect(isErr(await call(ctx, 'meerkat_last', { folder: resolve('/elsewhere') }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_findings', { folder: '\\\\host\\share' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_last', { folder: HERE, run: '../x' }))).toBe(true)
    expect(picks).toHaveLength(0)
  })
  test('a failed resolve is an error with the reason', async () => {
    const { ctx } = makeCtx({ resolveRun: () => ({ ok: false, text: 'No run has been saved for that folder yet.' }) })
    const r = await call(ctx, 'meerkat_findings', { folder: HERE })
    expect(isErr(r)).toBe(true)
    expect(text(r)).toContain('No run has been saved for that folder')
  })
})

describe('1b. resolveRunFor on a real log folder', () => {
  const made: string[] = []
  afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))
  const mk = () => {
    const logs = mkdtempSync(join(tmpdir(), 'meerkat-par-'))
    made.push(logs)
    const add = (name: string, project: string, preset: string, tier = 'fast') => {
      const d = join(logs, 'runs', name)
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'summary.json'), JSON.stringify({ project: { name: 'x', path: project }, preset, tier, exitCode: 1, ms: 1500, startedAt: '2026-11-07T10:00:00.000Z', summary: 's' }))
      writeFileSync(join(d, 'findings.json'), '{}')
    }
    add('20261107-100000-aaa--quick', '/p/aaa', 'quick')
    add('20261107-100100-bbb--full', '/p/bbb', 'full', 'thorough')
    add('20261107-100200-aaa--full', '/p/aaa', 'full', 'thorough')
    add('20261107-100300-bbb--quick', '/p/bbb', 'quick')
    return { MEERKAT_LOG_DIR: logs }
  }
  test('newest run of the folder, newest of a preset in the folder, and a run of another folder is refused', () => {
    const env = mk()
    expect(resolveRunFor(env, { folder: '/p/aaa' }).dir).toContain('100200-aaa--full')
    expect(resolveRunFor(env, { folder: '/p/aaa', preset: 'quick' }).dir).toContain('100000-aaa--quick')
    expect(resolveRunFor(env, { folder: '/p/bbb', preset: 'quick' }).dir).toContain('100300-bbb--quick')
    expect(resolveRunFor(env, { folder: '/p/aaa', run: '20261107-100200' }).ok).toBe(true)
    const wrong = resolveRunFor(env, { folder: '/p/aaa', run: '20261107-100300-bbb--quick' })
    expect(wrong.ok).toBe(false)
    expect(wrong.text).toContain('belongs to')
    expect(resolveRunFor(env, { folder: '/p/ccc' }).ok).toBe(false)
    expect(resolveRunFor(env, { folder: '/p/aaa', preset: 'security' }).text).toContain('quick')
  })
  test('folderRuns lists runs of one folder with preset, exit code and time', () => {
    const env = mk()
    const rows = folderRuns(env, '/p/aaa', 10)
    expect(rows.map((r: any) => r.preset)).toEqual(['full', 'quick'])
    expect(rows[0]).toMatchObject({ exitCode: 1, ms: 1500 })
  })
})

describe('2 and 3. ratchet and the run flags', () => {
  test('ratchet and every run flag become the CLI flags of run.mjs', async () => {
    const { ctx, meerkat } = makeCtx()
    await call(ctx, 'meerkat_run', { folder: HERE, ratchet: true, noConfig: true, group: ['security', 'ui'], failFast: true, maxRunMinutes: 5, timeoutScale: 2 })
    const argv = meerkat[0]
    expect(argv).toEqual(expect.arrayContaining(['--ratchet', '--no-config', '--fail-fast']))
    expect(argv[argv.indexOf('--group') + 1]).toBe('security,ui')
    expect(argv[argv.indexOf('--max-run-minutes') + 1]).toBe('5')
    expect(argv[argv.indexOf('--timeout-scale') + 1]).toBe('2')
  })
  test('keepGoing and config; config must be a file inside the folder', async () => {
    const { ctx, meerkat } = makeCtx({ isFile: (p: string) => p.endsWith('meerkat.config.json') })
    await call(ctx, 'meerkat_run', { folder: HERE, keepGoing: true, config: 'meerkat.config.json' })
    expect(meerkat[0]).toContain('--keep-going')
    expect(meerkat[0][meerkat[0].indexOf('--config') + 1]).toBe(join(HERE, 'meerkat.config.json'))
    expect(isErr(await call(ctx, 'meerkat_run', { folder: HERE, config: '../other/meerkat.config.json' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_run', { folder: HERE, config: resolve('/etc/x/meerkat.config.json') }))).toBe(true)
    expect(meerkat).toHaveLength(1)
  })
  test('bad values are refused before anything starts', async () => {
    const { ctx, meerkat } = makeCtx()
    for (const bad of [{ ratchet: 'yes' }, { group: ['bogus'] }, { group: 'security' }, { failFast: true, keepGoing: true }, { timeoutScale: 11 }, { timeoutScale: 0 }, { maxRunMinutes: 0 }, { maxRunMinutes: 31 }, { maxRunMinutes: 1.5 }, { config: 'x.json', noConfig: true }, { noConfig: 1 }]) {
      expect(isErr(await call(ctx, 'meerkat_run', { folder: HERE, ...bad }))).toBe(true)
    }
    expect(meerkat).toHaveLength(0)
  })
  test('meerkat run --help lists --ratchet', () => {
    const out = execFileSync(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), 'run', '--help'], { encoding: 'utf8' })
    expect(out).toContain('--ratchet')
    expect(out).toContain('--fail-fast')
  })
})

describe('4. severity gate and export', () => {
  test('failOn fails when a finding at or above exists; with new only new ones count', async () => {
    const { ctx } = makeCtx()
    const a = await call(ctx, 'meerkat_findings', { failOn: 'high' })
    expect(isErr(a)).toBe(true)
    expect(a.result.structuredContent.gate).toMatchObject({ failOn: 'high', exitCode: 1, matched: 1 })
    const b = await call(ctx, 'meerkat_findings', { failOn: 'high', new: true })
    expect(isErr(b)).toBe(false)
    expect(b.result.structuredContent.gate).toMatchObject({ exitCode: 0, matched: 0, onlyNew: true })
    const c = await call(ctx, 'meerkat_findings', { failOn: 'low', new: true })
    expect(c.result.structuredContent.gate.exitCode).toBe(1)
    expect(isErr(await call(ctx, 'meerkat_findings', { failOn: 'huge' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_findings', { new: 'yes' }))).toBe(true)
  })
  test('export returns the path of the file in the run folder', async () => {
    const { ctx } = makeCtx()
    const r = await call(ctx, 'meerkat_findings', { export: 'sarif' })
    expect(r.result.structuredContent.export).toEqual({ format: 'sarif', file: '/logs/run1/findings.sarif' })
    expect(text(r)).toContain('/logs/run1/findings.sarif')
    const m = await call(ctx, 'meerkat_findings', { export: 'markdown' })
    expect(m.result.structuredContent.export.file).toContain('findings.md')
    expect(isErr(await call(ctx, 'meerkat_findings', { export: 'xml' }))).toBe(true)
  })
  describe('the CLI', () => {
    const made: string[] = []
    afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))
    const savedRun = (findings: unknown[]) => {
      const logs = mkdtempSync(join(tmpdir(), 'meerkat-gate-'))
      made.push(logs)
      const dir = join(logs, 'runs', '20261107-100000-fast')
      mkdirSync(dir, { recursive: true })
      const counts = { total: findings.length, new: 0, known: findings.length, fixed: 0 }
      writeFileSync(join(dir, 'findings.json'), JSON.stringify({ schemaVersion: 1, run: { id: '20261107-100000-fast' }, counts, findings, fixed: [] }))
      writeFileSync(join(dir, 'findings.md'), '# md\n')
      writeFileSync(join(dir, 'findings.sarif'), '{"version":"2.1.0"}')
      writeFileSync(join(logs, 'latest.json'), JSON.stringify({ dir: dir.split('\\').join('/') }))
      return { MEERKAT_LOG_DIR: logs }
    }
    const f = (sev: string, status: string) => ({ id: `${sev}${status}00000000`.slice(0, 16), severity: sev, rule: 'r', check: 'c', suite: 's', file: 'a.js', line: 1, message: 'm', status })
    const run = (env: any, argv: string[]) => {
      const out: string[] = []
      const err: string[] = []
      const plan = planCommand(argv, { cwd: process.cwd(), env })
      const code = plan.kind === 'noun' ? findingsCommand(plan, { out: (t: string) => out.push(t), err: (t: string) => err.push(t), env, cwd: process.cwd() }) : -1
      return { code, out: out.join('\n'), err: err.join('\n'), plan }
    }
    test('--fail-on with --new counts only new findings', () => {
      const env = savedRun([f('high', 'known'), f('low', 'new')])
      expect(run(env, ['findings', '--fail-on', 'high']).code).toBe(1)
      expect(run(env, ['findings', '--fail-on', 'high', '--new']).code).toBe(0)
      expect(run(env, ['findings', '--fail-on', 'low', '--new']).code).toBe(1)
    })
    test('--export markdown is accepted and --export with --json prints the file path in the run folder', () => {
      const env = savedRun([f('high', 'known')])
      const r = run(env, ['findings', '--export', 'markdown', '--json'])
      expect(r.code).toBe(0)
      const j = JSON.parse(r.out)
      expect(j.format).toBe('md')
      expect(j.file.replace(/\\/g, '/')).toMatch(/20261107-100000-fast\/findings\.md$/)
    })
  })
})

describe('5. version and tool count', () => {
  test('meerkat_list reports the version and the tool count from the registration', async () => {
    const { ctx } = makeCtx({ runMeerkat: async () => ({ code: 0, stdout: 'lint  security  fast  free  ~1s  Lint\n', stderr: '' }) })
    const r = await call(ctx, 'meerkat_list', {})
    expect(r.result.structuredContent.server).toEqual({ version: '9.9.9', tools: TOOLS.length })
    expect(text(r)).toContain(`${TOOLS.length} tools`)
  })
  test('meerkat-mcp --list-tools prints the same names and count', () => {
    const out = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'bin', 'meerkat-mcp.mjs'), '--list-tools'], { encoding: 'utf8' }))
    expect(out.count).toBe(TOOLS.length)
    expect(out.tools).toEqual(TOOLS.map((t: { name: string }) => t.name))
    expect(typeof out.version).toBe('string')
  })
  test('the docs and the skill never type the tool count', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['README.md', 'docs/ai.md', 'docs/for-ai-agents.md', 'docs/features.md', 'docs/commands.md', 'skills/meerkat/SKILL.md']) {
      const t = readFileSync(join(ROOT, f), 'utf8')
      expect(t, f).not.toMatch(/\b\d{2,3}\s+(MCP\s+)?tools\b/i)
    }
  })
})

describe('6. the four new tools', () => {
  test('meerkat_version returns the version and the build commit when there is one', async () => {
    const { ctx } = makeCtx({ buildCommit: () => 'abc1234' })
    const r = await call(ctx, 'meerkat_version', {})
    expect(r.result.structuredContent).toMatchObject({ schemaVersion: 1, version: '9.9.9', commit: 'abc1234', tools: TOOLS.length })
    const none = await call(makeCtx({ buildCommit: () => null }).ctx, 'meerkat_version', {})
    expect(none.result.structuredContent.commit).toBeNull()
    expect(isErr(await call(ctx, 'meerkat_version', { folder: HERE }))).toBe(true)
  })
  test('meerkat_check_list is read-only: own checks and packs of a folder', async () => {
    const { ctx, cli } = makeCtx()
    const r = await call(ctx, 'meerkat_check_list', { folder: HERE })
    expect(cli.map((c) => c.slice(0, 2))).toEqual([['check', 'list'], ['pack', 'list']])
    expect(r.result.structuredContent.own.map((c: { id: string }) => c.id)).toEqual(['mine-one'])
    expect(r.result.structuredContent.packs[0].name).toBe('python')
    expect(isErr(await call(ctx, 'meerkat_check_list', { folder: resolve('/elsewhere') }))).toBe(true)
    const tool = TOOLS.find((t: { name: string }) => t.name === 'meerkat_check_list')
    expect(tool.annotations.readOnlyHint).toBe(true)
  })
  test('meerkat_prompt writes the prompt file for a folder-scoped run and never touches the clipboard', async () => {
    const { ctx, cli } = makeCtx()
    const r = await call(ctx, 'meerkat_prompt', { folder: HERE, preset: 'quick' })
    expect(cli[0]).toEqual(['prompt', '--run-dir', '/logs/runs/20261107-100000-proj--quick', '--no-copy', '--json'])
    expect(r.result.structuredContent.file).toBe('/logs/run1/meerkat-prompt-x.md')
    expect(isErr(await call(ctx, 'meerkat_prompt', {}))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_prompt', { folder: resolve('/elsewhere') }))).toBe(true)
  })
  test('meerkat_run_list lists past runs of a folder with preset, exit code and time', async () => {
    const { ctx } = makeCtx()
    const r = await call(ctx, 'meerkat_run_list', { folder: HERE, limit: 5 })
    expect(r.result.structuredContent.runs[0]).toMatchObject({ preset: 'quick', exitCode: 1, ms: 4200 })
    expect(text(r)).toContain('quick')
    expect(isErr(await call(ctx, 'meerkat_run_list', { folder: HERE, limit: 0 }))).toBe(true)
  })
})

describe('7. structured output on every tool', () => {
  test('every tool declares an outputSchema that requires schemaVersion', () => {
    for (const t of TOOLS) {
      expect(t.outputSchema, t.name).toBeTruthy()
      expect(t.outputSchema.type).toBe('object')
      expect(t.outputSchema.required).toContain('schemaVersion')
    }
  })
  test('every result has a one-line status first and structuredContent with a schemaVersion, errors included', async () => {
    const { ctx } = makeCtx({ runMeerkat: async () => ({ code: 0, stdout: 'lint  security  fast  free  ~1s  Lint\n', stderr: '' }), buildCatalog: async () => ({ schema: 1, totals: { kinds: 0, families: 0, checks: 0 }, kinds: [], families: [], presets: [], triggerMeaning: {}, costMeaning: {} }), latestMap: () => null })
    const calls: [string, Record<string, unknown>][] = [['meerkat_presets', {}], ['meerkat_last', { folder: HERE }], ['meerkat_why', { check: 'build' }], ['meerkat_findings', {}], ['meerkat_finding', { id: 'aaaa1111' }], ['meerkat_list', {}], ['meerkat_version', {}], ['meerkat_describe', {}], ['meerkat_tests', {}], ['meerkat_run', { folder: '/nope' }], ['meerkat_blast', {}]]
    for (const [name, args] of calls) {
      const r = await call(ctx, name, args)
      expect(r.result.structuredContent?.schemaVersion, name).toBe(1)
      const first = text(r).split('\n')[0]
      expect(first, name).toMatch(/^meerkat_[a-z_]+: (ok|error)\b/)
      expect(first.length, name).toBeLessThan(400)
    }
  })
})

describe('8. the findings resource takes a folder', () => {
  test('a template with folder, run and preset is listed and read', async () => {
    expect(RESOURCE_TEMPLATES.map((t: { uriTemplate: string }) => t.uriTemplate)).toContain('meerkat://run/latest/findings{?folder,run,preset}')
    const { ctx, picks } = makeCtx()
    const pick = (a: { folder?: string }) => (a.folder === undefined ? { folder: resolve(HERE) } : { folder: a.folder })
    const uri = `meerkat://run/latest/findings?folder=${encodeURIComponent(HERE)}&preset=quick`
    const r = await readResource(uri, ctx, (s: string) => s, pick)
    expect(r.error).toBeUndefined()
    expect(JSON.parse(r.contents[0].text).findings).toHaveLength(3)
    expect(picks).toContainEqual({ resolved: { folder: HERE, run: undefined, preset: 'quick' } })
    const bad = await readResource('meerkat://run/latest/findings?folder=%2Felsewhere', ctx, (s: string) => s, () => ({ error: 'outside' }))
    expect(bad.error).toBe('outside')
    const plain = await readResource('meerkat://run/latest/findings', ctx, (s: string) => s, pick)
    expect(plain.contents).toHaveLength(1)
  })
})
