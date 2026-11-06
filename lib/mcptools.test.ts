// The tools added after the first six: each rejects a bad argument and calls the right Meerkat command or reader.
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { handleMessage, TOOLS } from './mcp.mjs'
// @ts-expect-error plain .mjs module
import { getPrompt, PROMPTS, readResource } from './mcpextras.mjs'

const HERE = resolve('/work/proj')
const OTHER = resolve('/work/other')
const WORK = resolve('/work')
const doc = (projectPath: string) => ({
  run: { id: 'r1', project: { path: projectPath } },
  counts: { total: 2, new: 1, known: 1, fixed: 0 },
  findings: [
    { id: 'aaaa1111', severity: 'high', rule: 'no-eval', check: 'risky', suite: 'code', file: 'src/a.js', line: 3, status: 'new', message: 'eval call', confidence: 'high', detectedBy: { check: 'risky' }, firstSeen: 'r1' },
    { id: 'bbbb2222', severity: 'low', rule: null, check: 'lint', suite: 'style', file: null, line: null, status: 'known', message: 'style' },
  ],
})

function makeCtx(over: Record<string, unknown> = {}) {
  const cli: string[][] = []
  const red: string[] = []
  const ctx = {
    version: '9.9.9',
    cwd: HERE,
    isDirectory: (p: string) => p.startsWith(WORK),
    realpath: (p: string) => p,
    roots: () => [],
    latestFindings: () => ({ ok: true, dir: '/logs/run1', doc: doc(HERE) }),
    readFile: () => '# map',
    latestMap: () => ({ md: '/logs/map/codemap.md' }),
    buildCatalog: async () => ({ schema: 1, triggerMeaning: {}, costMeaning: {}, presets: [], totals: { kinds: 1, families: 1, checks: 1 }, kinds: [{ id: 'code', proves: 'code is sound', checkCount: 1, cost: 'fast', triggers: ['commit'] }], families: [], checks: [{ id: 'lint' }] }),
    runCli: async (argv: string[]) => {
      cli.push(argv)
      return { code: 0, stdout: JSON.stringify({ desc: 'staged files', files: ['a.js'], rows: [{ id: 'lint', kind: 'pass' }], skipped: [], runDir: '/logs/map', summary: { files: 3 }, found: true }), stderr: '', timedOut: false }
    },
    runRedtest: async (kind: string) => {
      red.push(kind)
      return { code: 0, stdout: 'ok', stderr: '', timedOut: false }
    },
    ...over,
  }
  return { ctx, cli, red }
}
const call = (ctx: unknown, name: string, args: unknown = {}) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx)
const isErr = (r: { result: { isError?: boolean } }) => r.result.isError === true

describe('gate and smoke', () => {
  test('gate passes staged and the folder to the gate command, and rejects bad arguments', async () => {
    const { ctx, cli } = makeCtx()
    const r = await call(ctx, 'meerkat_gate', { staged: true })
    expect(isErr(r)).toBe(false)
    expect(cli[0]).toEqual(['gate', '--app', HERE, '--json', '--staged'])
    expect(r.result.structuredContent.rows[0]).toMatchObject({ id: 'lint', result: 'pass' })
    expect(isErr(await call(ctx, 'meerkat_gate', { staged: 'yes' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_gate', { base: '--upload-pack=x' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_gate', { staged: true, base: 'main' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_gate', { nope: 1 }))).toBe(true)
    expect(cli).toHaveLength(1)
  })

  test('smoke maps timeout to --timeout and rejects a bad one', async () => {
    const { ctx, cli } = makeCtx()
    await call(ctx, 'meerkat_smoke', { base: 'origin/main', timeout: 9 })
    expect(cli[0]).toEqual(['smoke', '--app', HERE, '--json', '--base', 'origin/main', '--timeout', '9'])
    expect(isErr(await call(ctx, 'meerkat_smoke', { timeout: 0 }))).toBe(true)
    expect(cli).toHaveLength(1)
  })
})

describe('blast and map', () => {
  test('blast runs the blast command; a flag-like or empty target is refused', async () => {
    const { ctx, cli } = makeCtx()
    const r = await call(ctx, 'meerkat_blast', { target: 'lib/a.mjs#run' })
    expect(isErr(r)).toBe(false)
    expect(cli[0]).toEqual(['blast', 'lib/a.mjs#run', '--app', HERE, '--json'])
    expect(isErr(await call(ctx, 'meerkat_blast', { target: '--app' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_blast', {}))).toBe(true)
    expect(cli).toHaveLength(1)
  })

  test('map runs the map command and refuses a folder outside the roots', async () => {
    const { ctx, cli } = makeCtx()
    const r = await call(ctx, 'meerkat_map', {})
    expect(cli[0]).toEqual(['map', '--app', HERE, '--json'])
    expect(r.result.structuredContent.runFolder).toBe('/logs/map')
    expect(isErr(await call(ctx, 'meerkat_map', { folder: '/elsewhere' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_map', { folder: 5 }))).toBe(true)
  })
})

describe('tests, findings, finding', () => {
  test('tests reads the catalog; bad detail is refused', async () => {
    const { ctx } = makeCtx()
    const r = await call(ctx, 'meerkat_tests', { detail: 'full' })
    expect(r.result.structuredContent.checks).toHaveLength(1)
    const s = await call(ctx, 'meerkat_tests', {})
    expect(s.result.structuredContent.checks).toBeUndefined()
    expect(isErr(await call(ctx, 'meerkat_tests', { detail: 'all' }))).toBe(true)
  })

  test('findings filters and sorts; bad severity is refused', async () => {
    const { ctx } = makeCtx()
    const r = await call(ctx, 'meerkat_findings', { severity: 'high' })
    expect(r.result.structuredContent.findings.map((f: { id: string }) => f.id)).toEqual(['aaaa1111'])
    const all = await call(ctx, 'meerkat_findings', {})
    expect(all.result.structuredContent.findings[0].id).toBe('aaaa1111')
    expect(isErr(await call(ctx, 'meerkat_findings', { severity: 'huge' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_findings', { limit: 0 }))).toBe(true)
  })

  test('finding returns one by id prefix; short or unknown id is refused', async () => {
    const { ctx } = makeCtx()
    const r = await call(ctx, 'meerkat_finding', { id: 'aaaa' })
    expect(isErr(r)).toBe(false)
    expect(r.result.content[0].text).toContain('eval call')
    expect(isErr(await call(ctx, 'meerkat_finding', { id: 'aa' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_finding', { id: 'zzzz' }))).toBe(true)
  })
})

describe('redtest', () => {
  test('runs the red-test runner for a kind; unknown kind is refused', async () => {
    const { ctx, red } = makeCtx()
    await call(ctx, 'meerkat_redtest', { kind: 'faults' })
    expect(red).toEqual(['faults'])
    expect(isErr(await call(ctx, 'meerkat_redtest', { kind: 'rm -rf' }))).toBe(true)
    expect(red).toHaveLength(1)
  })
})

describe('write tools: folder is required and the run must belong to it', () => {
  test('dismiss passes folder and run dir to the command', async () => {
    const { ctx, cli } = makeCtx()
    const r = await call(ctx, 'meerkat_dismiss', { folder: HERE, id: 'aaaa1111', reason: 'sample text' })
    expect(isErr(r)).toBe(false)
    expect(cli[0]).toEqual(['dismiss', 'aaaa1111', '--reason', 'sample text', '--app', HERE, '--run', '/logs/run1'])
  })

  test('dismiss refuses a missing folder, a bad id, and a run from another folder', async () => {
    const { ctx, cli } = makeCtx({ latestFindings: () => ({ ok: true, dir: '/logs/other', doc: doc(OTHER) }) })
    expect(isErr(await call(ctx, 'meerkat_dismiss', { id: 'aaaa1111', reason: 'sample text' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_dismiss', { folder: HERE, id: 'a', reason: 'sample text' }))).toBe(true)
    const r = await call(ctx, 'meerkat_dismiss', { folder: HERE, id: 'aaaa1111', reason: 'sample text' })
    expect(isErr(r)).toBe(true)
    expect(r.result.content[0].text).toContain('nothing was written')
    expect(cli).toHaveLength(0)
  })

  test('baseline passes folder and run dir; a run from another folder is refused', async () => {
    const { ctx, cli } = makeCtx()
    await call(ctx, 'meerkat_baseline', { folder: HERE })
    expect(cli[0]).toEqual(['baseline', '--app', HERE, '--run', '/logs/run1'])
    const other = makeCtx({ latestFindings: () => ({ ok: true, dir: '/logs/other', doc: doc(OTHER) }) })
    expect(isErr(await call(other.ctx, 'meerkat_baseline', { folder: HERE }))).toBe(true)
    expect(isErr(await call(other.ctx, 'meerkat_baseline', {}))).toBe(true)
    expect(isErr(await call(other.ctx, 'meerkat_baseline', { folder: HERE, clear: 'yes' }))).toBe(true)
    expect(other.cli).toHaveLength(0)
  })

  test('a run that records no project is refused', async () => {
    const { ctx, cli } = makeCtx({ latestFindings: () => ({ ok: true, dir: '/logs/x', doc: { run: { id: 'x' }, findings: [] } }) })
    expect(isErr(await call(ctx, 'meerkat_baseline', { folder: HERE }))).toBe(true)
    expect(cli).toHaveLength(0)
  })
})

describe('resources and prompts', () => {
  test('map and catalog resources read; a missing map is an error', async () => {
    const { ctx } = makeCtx()
    const safe = (t: string) => t
    expect((await readResource('meerkat://map/latest', ctx, safe)).contents[0].text).toBe('# map')
    expect(JSON.parse((await readResource('meerkat://tests/catalog', ctx, safe)).contents[0].text).totals.checks).toBe(1)
    expect((await readResource('meerkat://map/latest', { ...ctx, latestMap: () => null }, safe)).error).toContain('meerkat_map')
  })

  test('each job prompt names the tools to call; bad arguments are refused', () => {
    const names = PROMPTS.map((p: { name: string }) => p.name)
    for (const n of ['pre_commit_check', 'pre_pr_check', 'scan_for_secrets', 'blast_before_edit', 'map_unfamiliar_repo', 'red_test_scenario']) expect(names).toContain(n)
    expect(getPrompt('pre_commit_check', {}).messages[0].content.text).toContain('meerkat_gate')
    expect(getPrompt('pre_pr_check', { base: 'origin/dev' }).messages[0].content.text).toContain('origin/dev')
    expect(getPrompt('pre_pr_check', { base: '--x' }).error).toBeTruthy()
    expect(getPrompt('scan_for_secrets', {}).messages[0].content.text).toContain('meerkat_run')
    expect(getPrompt('blast_before_edit', { target: 'a.js#b' }).messages[0].content.text).toContain('meerkat_blast')
    expect(getPrompt('blast_before_edit', {}).error).toBeTruthy()
    expect(getPrompt('map_unfamiliar_repo', {}).messages[0].content.text).toContain('meerkat_map')
    expect(getPrompt('red_test_scenario', { kind: 'faults' }).messages[0].content.text).toContain('meerkat_redtest')
    expect(getPrompt('red_test_scenario', { kind: 'x' }).error).toBeTruthy()
  })

  test('every tool schema is a closed object and no text has an em dash', () => {
    for (const t of TOOLS) {
      expect(t.inputSchema.additionalProperties).toBe(false)
      expect(JSON.stringify(t)).not.toContain(String.fromCharCode(8212))
    }
  })
})

describe('the last group of tools: each rejects a bad argument and builds the right command', () => {
  test('every tool in the group has a two-line description, a closed schema and a registered handler', () => {
    const names = ['meerkat_doctor', 'meerkat_discover', 'meerkat_recommend', 'meerkat_tools', 'meerkat_trend', 'meerkat_suggest', 'meerkat_pr_comment', 'meerkat_dismissals', 'meerkat_hook_status', 'meerkat_describe', 'meerkat_undismiss', 'meerkat_hook']
    for (const n of names) {
      const t = TOOLS.find((x: { name: string }) => x.name === n)
      expect(t, n).toBeTruthy()
      expect(t.description.split('\n')).toHaveLength(2)
      expect(t.inputSchema.additionalProperties).toBe(false)
    }
    for (const n of ['meerkat_undismiss', 'meerkat_hook']) {
      const t = TOOLS.find((x: { name: string }) => x.name === n)
      expect(t.description.startsWith('WRITES:')).toBe(true)
      expect(t.inputSchema.required).toContain('folder')
    }
  })

  test.each([['meerkat_doctor', 'doctor'], ['meerkat_discover', 'discover'], ['meerkat_recommend', 'recommend'], ['meerkat_tools', 'tools']])('%s runs the command on the folder and rejects an unknown argument and a folder outside', async (tool, word) => {
    const { ctx, cli } = makeCtx()
    expect(isErr(await call(ctx, tool, {}))).toBe(false)
    expect(cli[0]).toEqual([word, HERE, '--json'])
    expect(isErr(await call(ctx, tool, { extra: 1 }))).toBe(true)
    expect(isErr(await call(ctx, tool, { folder: 42 }))).toBe(true)
    expect(isErr(await call(ctx, tool, { folder: resolve('/elsewhere') }))).toBe(true)
    expect(cli).toHaveLength(1)
  })

  test('trend and hook_status reject a bad folder and build their argument lists', async () => {
    const { ctx, cli } = makeCtx()
    await call(ctx, 'meerkat_trend', {})
    await call(ctx, 'meerkat_hook_status', {})
    expect(cli).toEqual([['trend', '--app', HERE], ['hook', 'status', HERE]])
    expect(isErr(await call(ctx, 'meerkat_trend', { folder: '\\host\share' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_hook_status', { folder: '' }))).toBe(true)
    expect(cli).toHaveLength(2)
  })

  test('suggest and pr_comment take the run folder from the server and reject a bad argument', async () => {
    const { ctx, cli } = makeCtx()
    await call(ctx, 'meerkat_suggest', {})
    await call(ctx, 'meerkat_pr_comment', { run_url: 'https://ci.example/run/1' })
    expect(cli).toEqual([['suggest', '/logs/run1'], ['pr-comment', '/logs/run1', '--run-url', 'https://ci.example/run/1']])
    expect(isErr(await call(ctx, 'meerkat_suggest', { dir: '/etc' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_pr_comment', { run_url: 'file:///etc/passwd' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_pr_comment', { run_url: 'https://x.example/a b' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_pr_comment', { run_url: 7 }))).toBe(true)
    expect(cli).toHaveLength(2)
    const none = makeCtx({ latestFindings: () => ({ ok: false, text: 'There is no run yet.' }) })
    expect(isErr(await call(none.ctx, 'meerkat_suggest', {}))).toBe(true)
    expect(none.cli).toHaveLength(0)
  })

  test('dismissals and describe validate their arguments', async () => {
    const { ctx, cli } = makeCtx({ runCli: async (argv: string[]) => ({ code: 0, stdout: argv[0] === 'describe' ? '{"commands":[]}' : 'No dismissals.', stderr: '', timedOut: false }) })
    expect(isErr(await call(ctx, 'meerkat_dismissals', { stats: 'yes' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_dismissals', { nope: true }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_dismissals', { stats: true }))).toBe(false)
    expect(isErr(await call(ctx, 'meerkat_describe', { x: 1 }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_describe', {}))).toBe(false)
    expect(cli).toHaveLength(0)
  })

  test('undismiss needs a folder, a good id and a run of that folder', async () => {
    const { ctx, cli } = makeCtx()
    const r = await call(ctx, 'meerkat_undismiss', { folder: HERE, id: 'aaaa1111' })
    expect(isErr(r)).toBe(false)
    expect(cli[0]).toEqual(['undismiss', 'aaaa1111', '--app', HERE, '--run', '/logs/run1'])
    expect(isErr(await call(ctx, 'meerkat_undismiss', { id: 'aaaa1111' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_undismiss', { folder: HERE, id: 'a' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_undismiss', { folder: HERE, id: '--run' }))).toBe(true)
    const other = makeCtx({ latestFindings: () => ({ ok: true, dir: '/logs/other', doc: doc(OTHER) }) })
    expect(isErr(await call(other.ctx, 'meerkat_undismiss', { folder: HERE, id: 'aaaa1111' }))).toBe(true)
    expect(other.cli).toHaveLength(0)
    expect(cli).toHaveLength(1)
  })

  test('hook needs a folder and an action of install or remove', async () => {
    const { ctx, cli } = makeCtx()
    expect(isErr(await call(ctx, 'meerkat_hook', { folder: HERE, action: 'install' }))).toBe(false)
    expect(isErr(await call(ctx, 'meerkat_hook', { folder: HERE, action: 'remove' }))).toBe(false)
    expect(cli).toEqual([['hook', 'install', HERE], ['hook', 'remove', HERE]])
    expect(isErr(await call(ctx, 'meerkat_hook', { action: 'install' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_hook', { folder: HERE }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_hook', { folder: HERE, action: 'status; rm -rf' }))).toBe(true)
    expect(isErr(await call(ctx, 'meerkat_hook', { folder: resolve('/elsewhere'), action: 'install' }))).toBe(true)
    expect(cli).toHaveLength(2)
  })
})
