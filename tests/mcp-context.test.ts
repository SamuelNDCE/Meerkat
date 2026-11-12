// MCP tools for the AI-context commands (roadmap C5): meerkat_context, meerkat_map with budget and for, meerkat_risks, meerkat_task_pack.
// Part 1 uses a stub for the command line to check the argument lists and the result shape; part 2 runs the real CLI on a scratch repository.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, realpathSync as rp, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { handleMessage, spawnNode, TOOLS } from '../lib/mcp.mjs'
// @ts-expect-error plain .mjs module
import { MAX_DESCRIPTION } from '../lib/mcpdesc.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'meerkat.mjs')
const HERE = resolve('/work/proj')
const tmps: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-mcpctx-'))); tmps.push(d); return d }
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

type Res = { result: { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, any> } }
const call = (ctx: unknown, name: string, args: unknown = {}) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx) as Promise<Res>
const isErr = (r: Res) => r.result.isError === true
const text = (r: Res) => r.result.content[0].text

function stubCtx(reply: { code?: number; stdout?: string; stderr?: string } = {}) {
  const cli: string[][] = []
  const ctx = {
    version: '9.9.9',
    cwd: HERE,
    now: () => Date.now(),
    isDirectory: (p: string) => p.startsWith(resolve('/work')),
    realpath: (p: string) => p,
    isFile: () => true,
    roots: () => [],
    runCli: async (argv: string[]) => { cli.push(argv); return { code: reply.code ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '', timedOut: false } },
  }
  return { ctx, cli }
}

describe('registration', () => {
  test.each(['meerkat_context', 'meerkat_risks', 'meerkat_task_pack'])('%s is listed with a two-line description under the limit', (name) => {
    const t = TOOLS.find((x: { name: string }) => x.name === name)
    expect(t, name).toBeTruthy()
    expect(t.description.split('\n')).toHaveLength(2)
    expect(t.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION + 1)
    expect(t.inputSchema.additionalProperties).toBe(false)
  })
  test('meerkat_map takes budget and for as well as folder', () => {
    const t = TOOLS.find((x: { name: string }) => x.name === 'meerkat_map')
    expect(Object.keys(t.inputSchema.properties)).toEqual(expect.arrayContaining(['folder', 'budget', 'for']))
  })
  test('meerkat_task_pack requires plan and task', () => {
    const t = TOOLS.find((x: { name: string }) => x.name === 'meerkat_task_pack')
    expect(t.inputSchema.required).toEqual(['plan', 'task'])
  })
})

describe('meerkat_context', () => {
  test('runs meerkat context on the folder and returns its stdout', async () => {
    const { ctx, cli } = stubCtx({ stdout: '# Project brief\nwhat it is\n' })
    const r = await call(ctx, 'meerkat_context', { folder: HERE })
    expect(isErr(r)).toBe(false)
    expect(cli).toEqual([['context', HERE]])
    expect(text(r)).toContain('# Project brief')
  })
  test('folder is optional', async () => {
    const { ctx, cli } = stubCtx({ stdout: 'brief' })
    expect(isErr(await call(ctx, 'meerkat_context', {}))).toBe(false)
    expect(cli[0][0]).toBe('context')
  })
  test('the text is size-capped', async () => {
    const { ctx } = stubCtx({ stdout: 'x'.repeat(50000) })
    const r = await call(ctx, 'meerkat_context', {})
    expect(text(r).length).toBeLessThan(20000)
  })
  test('a folder outside the allowed roots, an unknown argument and a failing command are errors', async () => {
    const { ctx } = stubCtx({ stdout: 'brief' })
    expect(isErr(await call(ctx, 'meerkat_context', { folder: resolve('/elsewhere') }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_context', { nope: 1 }))).toBe(true)
    expect(isErr(await call(stubCtx({ code: 2, stderr: 'context: x is not a folder' }).ctx, 'meerkat_context', {}))).toBe(true)
  })
})

describe('meerkat_map with budget and for', () => {
  test('budget and for run the ranked map and return its text whole', async () => {
    const { ctx, cli } = stubCtx({ stdout: '# Ranked map\nlib/a.mjs\n' })
    const r = await call(ctx, 'meerkat_map', { folder: HERE, budget: 1500, for: 'lib/a.mjs' })
    expect(isErr(r)).toBe(false)
    expect(cli).toEqual([['map', HERE, '--budget', '1500', '--for', join(HERE, 'lib', 'a.mjs')]])
    expect(text(r)).toContain('# Ranked map')
    expect(text(r)).toContain('lib/a.mjs')
  })
  test('for alone uses the default budget of 4000', async () => {
    const { ctx, cli } = stubCtx({ stdout: 'map' })
    await call(ctx, 'meerkat_map', { for: 'lib/a.mjs' })
    expect(cli[0]).toEqual(expect.arrayContaining(['--budget', '4000']))
  })
  test('budget must be a whole number of 1 or more; for must stay inside the folder', async () => {
    const { ctx, cli } = stubCtx({ stdout: 'map' })
    for (const budget of [0, -5, 1.5, '100', 10000000]) expect(isErr(await call(ctx, 'meerkat_map', { budget })), String(budget)).toBe(true)
    for (const f of ['../secret.txt', '/etc/passwd', 'C:\\Windows\\win.ini', '-x', '']) expect(isErr(await call(ctx, 'meerkat_map', { for: f })), f).toBe(true)
    expect(cli).toHaveLength(0)
  })
  test('plain meerkat_map keeps its old command line', async () => {
    const { ctx, cli } = stubCtx({ stdout: JSON.stringify({ runDir: '/logs/x', files: 3, schemaVersion: 2, summary: {} }) })
    await call(ctx, 'meerkat_map', { folder: HERE })
    expect(cli).toEqual([['map', '--app', HERE, '--json']])
  })
})

describe('meerkat_risks', () => {
  test('returns the risk list text', async () => {
    const { ctx, cli } = stubCtx({ stdout: 'Risks: newest run\nsrc/a.js\n' })
    const r = await call(ctx, 'meerkat_risks', { folder: HERE })
    expect(isErr(r)).toBe(false)
    expect(cli).toEqual([['risks', HERE]])
    expect(text(r)).toContain('src/a.js')
  })
  test('json: true asks for --json and returns the parsed list too', async () => {
    const { ctx, cli } = stubCtx({ stdout: JSON.stringify({ version: 1, total: 0, open: [], dismissed: [] }) })
    const r = await call(ctx, 'meerkat_risks', { folder: HERE, json: true })
    expect(cli[0]).toEqual(['risks', HERE, '--json'])
    expect(r.result.structuredContent?.risks).toMatchObject({ version: 1, total: 0 })
  })
  test('no saved run (exit 3) is not an error and says so', async () => {
    const { ctx } = stubCtx({ code: 3, stderr: 'risks: no run has been saved for this folder' })
    const r = await call(ctx, 'meerkat_risks', {})
    expect(isErr(r)).toBe(false)
    expect(text(r)).toMatch(/no run/i)
    expect(r.result.structuredContent?.noRun).toBe(true)
  })
  test('a usage error (exit 2), a bad json type and an unknown argument are errors', async () => {
    expect(isErr(await call(stubCtx({ code: 2, stderr: 'risks: bad' }).ctx, 'meerkat_risks', {}))).toBe(true)
    const { ctx } = stubCtx({ stdout: 'x' })
    expect(isErr(await call(ctx, 'meerkat_risks', { json: 'yes' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_risks', { nope: 1 }))).toBe(true)
  })
})

describe('meerkat_task_pack', () => {
  const plan = join(HERE, 'plan.json')
  test('runs meerkat brief --task and returns the pack', async () => {
    const { ctx, cli } = stubCtx({ stdout: '## Task\ngoal of t1\n## Done command\nnpm test\n' })
    const r = await call(ctx, 'meerkat_task_pack', { plan, task: 't1' })
    expect(isErr(r)).toBe(false)
    expect(cli).toEqual([['brief', '--task', plan, 't1']])
    expect(text(r)).toContain('## Task')
  })
  test('maxChars is passed as --max-chars', async () => {
    const { ctx, cli } = stubCtx({ stdout: 'pack' })
    await call(ctx, 'meerkat_task_pack', { plan, task: 't1', maxChars: 1200 })
    expect(cli[0]).toEqual(['brief', '--task', plan, 't1', '--max-chars', '1200'])
  })
  test('an invalid plan returns the plan check errors, as an error and not as a pack', async () => {
    const { ctx } = stubCtx({ code: 1, stderr: 'meerkat brief --task: refused, the plan does not pass plan check\n  - task t1 owns a file twice\n' })
    const r = await call(ctx, 'meerkat_task_pack', { plan, task: 't1' })
    expect(isErr(r)).toBe(true)
    expect(text(r)).toContain('task t1 owns a file twice')
    expect(text(r)).not.toContain('## Task')
  })
  test('missing or bad arguments are errors and nothing is run', async () => {
    const { ctx, cli } = stubCtx({ stdout: 'pack' })
    expect(isErr(await call(ctx, 'meerkat_task_pack', { task: 't1' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_task_pack', { plan }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_task_pack', { plan, task: '--json' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_task_pack', { plan, task: 't1', maxChars: 0 }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_task_pack', { plan: resolve('/elsewhere/plan.json'), task: 't1' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_task_pack', { plan, task: 't1', nope: 1 }))).toBe(true)
    expect(cli).toHaveLength(0)
  })
})

describe('with the real command line', () => {
  let repo = ''
  let logDir = ''
  const real = () => ({
    version: '9.9.9',
    cwd: repo,
    now: () => Date.now(),
    isDirectory: (p: string) => { try { return statSync(p).isDirectory() } catch { return false } },
    realpath: (p: string) => rp(p),
    roots: () => [],
    runCli: (argv: string[], opts: Record<string, unknown>) => spawnNode(BIN, argv, { ...opts, env: { ...process.env, MEERKAT_LOG_DIR: logDir } }),
  })
  const put = (rel: string, body: string) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), body) }
  beforeAll(() => {
    repo = tmp()
    logDir = tmp()
    const g = (...a: string[]) => { const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr) }
    g('init', '-q', '-b', 'main')
    put('package.json', '{"name":"fx","version":"1.0.0","private":true,"scripts":{"test":"node t.js"}}')
    put('README.md', '# fx\n\nA small fixture project for the context tools.\n')
    put('src/a.js', 'export function alpha() { return 1 }\n')
    put('src/b.js', "import { alpha } from './a.js'\nexport function useAlpha() { return alpha() }\n")
    put('plan.json', JSON.stringify({ version: 1, tasks: [{ id: 't1', goal: 'goal of t1', owns: ['src/a.js'], done: 'npm test', timeMinutes: 25, maxTurns: 40 }] }))
    put('bad.json', '{ not json')
    g('add', '.')
    g('commit', '-q', '-m', 'init')
  })

  test('meerkat_context returns the same text as meerkat context', async () => {
    const r = await call(real(), 'meerkat_context', { folder: repo })
    const cli = spawnSync(process.execPath, [BIN, 'context', repo], { encoding: 'utf8', env: { ...process.env, MEERKAT_LOG_DIR: logDir } })
    expect(isErr(r)).toBe(false)
    expect(text(r)).toContain(cli.stdout.trim().split('\n')[0])
    expect(text(r)).toContain('fx')
  }, 60000)

  test('meerkat_map with budget returns the ranked map', async () => {
    const r = await call(real(), 'meerkat_map', { folder: repo, budget: 500, for: 'src/a.js' })
    expect(isErr(r)).toBe(false)
    expect(text(r)).toContain('alpha')
  }, 60000)

  test('meerkat_risks with no saved run is not an error', async () => {
    const r = await call(real(), 'meerkat_risks', { folder: repo })
    expect(isErr(r)).toBe(false)
    expect(text(r)).toMatch(/no run/i)
  }, 60000)

  test('meerkat_task_pack returns a pack that lists the owned file', async () => {
    const r = await call(real(), 'meerkat_task_pack', { plan: join(repo, 'plan.json'), task: 't1' })
    expect(isErr(r)).toBe(false)
    expect(text(r)).toContain('src/a.js')
    expect(text(r)).toContain('## Done command')
  }, 60000)

  test('meerkat_task_pack on a broken plan is an error', async () => {
    const r = await call(real(), 'meerkat_task_pack', { plan: join(repo, 'bad.json'), task: 't1' })
    expect(isErr(r)).toBe(true)
    expect(text(r)).not.toContain('## Done command')
  }, 60000)
})
