// The MCP server: protocol replies, the six tools with fake side effects, input checks, and one real stdio smoke test.
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { createContext, createReader, handleLine, handleMessage, parseListLine, TOOLS } from './mcp.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const summary = (startedAt: string) => ({
  summary: 'MEERKAT fast: 2 passed, 1 failed, 1 not run, 0 skipped in 4.0s',
  counts: { pass: 2, fail: 1, notRun: 1 },
  startedAt,
  results: [
    { id: 'lint', status: 'PASS', ms: 100 },
    { id: 'build', status: 'FAIL', ms: 3200, detail: 'exit 1 [full output: /x/build.log]', logFile: '/logs/build.log', command: 'npm run build' },
    { id: 'e2e', status: 'NOT RUN', ms: 0, detail: 'missing on PATH: playwright', logFile: '/logs/e2e.log', command: null },
  ],
})

function makeCtx(over: Record<string, unknown> = {}) {
  const calls: { args: string[]; opts: unknown }[] = []
  const ctx = {
    version: '9.9.9',
    cwd: root,
    now: () => Date.now(),
    presets: { quick: { tier: 'fast', groups: [], about: 'every quick check' }, security: { tier: 'thorough', groups: ['security'], include: ['ai'], about: 'security' } },
    userPresets: () => ({ mine: { tier: 'fast', groups: ['ui'], about: 'my own' } }),
    isDirectory: (p: string) => p === root || p.endsWith('real-folder'),
    realpath: (p: string) => p,
    roots: () => [],
    readFile: () => JSON.stringify(summary(new Date().toISOString())),
    latestRunDir: () => '/logs/run1',
    showLast: () => ({ ok: true, text: '# Meerkat run: quick' }),
    showWhy: (id: string, lines: number) => ({ ok: true, text: `why ${id} ${lines}` }),
    runMeerkat: async (args: string[], opts: unknown) => {
      calls.push({ args, opts })
      return { code: 1, stdout: '', stderr: '', timedOut: false }
    },
    ...over,
  }
  return { ctx, calls }
}

const call = (ctx: unknown, name: string, args: unknown = {}, id = 1) => handleMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, ctx)

describe('protocol', () => {
  test('initialize echoes the version and names the server', async () => {
    const { ctx } = makeCtx()
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ctx)
    expect(r).toEqual({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'meerkat', version: '9.9.9' } } })
    const d = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize' }, ctx)
    expect(d.result.protocolVersion).toBe('2024-11-05')
  })

  test('tools/list names six tools, each with an input schema', async () => {
    const { ctx } = makeCtx()
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx)
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual(['meerkat_run', 'meerkat_list', 'meerkat_presets', 'meerkat_last', 'meerkat_why', 'meerkat_self_test'])
    for (const t of TOOLS) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(20)
      expect(`${t.name}${t.description}`).not.toContain('—')
    }
  })

  test('ping, unknown method, notification, bad request', async () => {
    const { ctx } = makeCtx()
    expect(await handleMessage({ jsonrpc: '2.0', id: 5, method: 'ping' }, ctx)).toEqual({ jsonrpc: '2.0', id: 5, result: {} })
    expect((await handleMessage({ jsonrpc: '2.0', id: 6, method: 'nope/what' }, ctx)).error.code).toBe(-32601)
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull()
    expect((await handleMessage({ id: 7 }, ctx)).error.code).toBe(-32600)
  })

  test('malformed JSON gives -32700 and a notification line gets no reply', async () => {
    const { ctx } = makeCtx()
    expect(JSON.parse(await handleLine('{not json', ctx)).error.code).toBe(-32700)
    expect(await handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), ctx)).toBeNull()
    expect(JSON.parse(await handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), ctx)).result).toEqual({})
  })

  test('the reader splits lines and Content-Length frames', () => {
    const r = createReader()
    expect(r.feed('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(r.feed(':2}\n')).toEqual(['{"b":2}'])
    const body = '{"c":3}'
    expect(createReader().feed(`Content-Length: ${body.length}\r\n\r\n${body}`)).toEqual([body])
  })

  test('an unknown tool is a protocol error', async () => {
    const { ctx } = makeCtx()
    expect((await call(ctx, 'rm_rf')).error.code).toBe(-32602)
    expect((await call(ctx, 'constructor')).error.code).toBe(-32602)
  })
})

describe('tools', () => {
  test('meerkat_run builds the argument list and reports failures from summary.json', async () => {
    const { ctx, calls } = makeCtx()
    const r = await call(ctx, 'meerkat_run', { preset: 'security', only: ['build', 'e2e'], include: ['ai'] })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual(['--app', root, '--preset', 'security', '--include', 'ai', '--only', 'build,e2e'])
    const res = r.result
    expect(res.isError).toBe(true)
    expect(res.structuredContent.exitCode).toBe(1)
    expect(res.structuredContent.counts).toEqual({ passed: 2, failed: 1, notRun: 1 })
    expect(res.structuredContent.failed.map((f: { id: string }) => f.id)).toEqual(['build', 'e2e'])
    expect(res.structuredContent.failed[0]).toMatchObject({ reason: 'exit 1', logFile: '/logs/build.log', command: 'npm run build', seconds: 3.2 })
    expect(res.structuredContent.runFolder).toBe('/logs/run1')
    const text = res.content[0].text
    expect(text).toContain('did not all pass')
    expect(text).toContain('FAILED build (3.2 s): exit 1, log: /logs/build.log')
    expect(text).toContain('NOT RUN e2e')
  })

  test('meerkat_run defaults to the quick preset and passes when exit code is 0', async () => {
    const ok = { ...summary(new Date().toISOString()), counts: { pass: 3, fail: 0, notRun: 0 }, results: [{ id: 'lint', status: 'PASS', ms: 10 }] }
    const { ctx, calls } = makeCtx({ readFile: () => JSON.stringify(ok), runMeerkat: async (args: string[]) => (calls.push(args), { code: 0, stdout: '', stderr: '', timedOut: false }) })
    const r = await call(ctx, 'meerkat_run', {})
    expect(calls[0]).toEqual(['--app', root, '--preset', 'quick'])
    expect(r.result.isError).toBe(false)
    expect(r.result.content[0].text).toContain('all checks passed')
  })

  test('a stale summary from an older run is not trusted', async () => {
    const { ctx } = makeCtx({ readFile: () => JSON.stringify(summary('2000-01-01T00:00:00.000Z')), runMeerkat: async () => ({ code: 2, stdout: 'bad config', stderr: '', timedOut: false }) })
    const r = await call(ctx, 'meerkat_run', {})
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('before it saved a report')
    expect(r.result.content[0].text).toContain('bad config')
  })

  test('a timeout is reported as an error', async () => {
    const { ctx } = makeCtx({ runMeerkat: async () => ({ code: null, stdout: '', stderr: '', timedOut: true }) })
    const r = await call(ctx, 'meerkat_run', {})
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('30 minutes')
  })

  test('meerkat_self_test passes --self-test', async () => {
    const { ctx, calls } = makeCtx()
    await call(ctx, 'meerkat_self_test', { only: ['lint'] })
    expect(calls[0].args).toEqual(['--app', root, '--self-test', '--only', 'lint'])
  })

  test('meerkat_list parses the list lines', async () => {
    const out = ['build                    functionality fast      serial    ~  30s  Build the app', 'ai-review                security      thorough  serial    ~ 120s  opt-in:ai  AI review'].join('\n')
    const { ctx, calls } = makeCtx({ runMeerkat: async (a: string[]) => (calls.push({ args: a, opts: null }), { code: 0, stdout: out, stderr: '', timedOut: false }) })
    const r = await call(ctx, 'meerkat_list', {})
    expect(calls[0].args).toEqual(['--list', '--app', root])
    expect(r.result.structuredContent.checks).toEqual([
      { id: 'build', kind: 'functionality', tier: 'fast', lane: 'serial', seconds: 30, title: 'Build the app', suite: 'other' },
      { id: 'ai-review', kind: 'security', tier: 'thorough', lane: 'serial', seconds: 120, title: 'AI review', optIn: 'ai', suite: 'other' },
    ])
    expect(parseListLine('garbage')).toBeNull()
  })

  test('meerkat_presets lists built in and personal presets', async () => {
    const { ctx } = makeCtx()
    const r = await call(ctx, 'meerkat_presets', {})
    const names = r.result.structuredContent.presets.map((p: { name: string }) => p.name)
    expect(names).toEqual(['quick', 'security', 'mine'])
    expect(r.result.structuredContent.presets[1]).toMatchObject({ tier: 'thorough', kinds: ['security'], include: ['ai'] })
  })

  test('meerkat_last and meerkat_why use the readers', async () => {
    const { ctx } = makeCtx()
    expect((await call(ctx, 'meerkat_last')).result.content[0].text).toBe('# Meerkat run: quick')
    expect((await call(ctx, 'meerkat_why', { check: 'build', lines: 5 })).result.content[0].text).toBe('why build 5')
    expect((await call(ctx, 'meerkat_why', { check: 'build' })).result.content[0].text).toBe('why build 80')
    const none = makeCtx({ showLast: () => ({ ok: false, text: 'no run has been saved yet' }) }).ctx
    const r = await call(none, 'meerkat_last')
    expect(r.result.isError).toBe(true)
  })
})

describe('input checks (nothing is ever spawned for a bad input)', () => {
  const bad: [string, string, Record<string, unknown>][] = [
    ['meerkat_run', 'folder that does not exist', { folder: 'does/not/exist' }],
    ['meerkat_run', 'check id with a space', { only: ['build now'] }],
    ['meerkat_run', 'check id with a semicolon', { only: ['build;calc'] }],
    ['meerkat_run', 'preset with a path separator', { preset: '../quick' }],
    ['meerkat_run', 'preset with a backslash', { preset: 'a\\b' }],
    ['meerkat_run', 'uppercase include', { include: ['AI'] }],
    ['meerkat_run', 'only is not a list', { only: 'build' }],
    ['meerkat_run', 'unknown argument', { shell: 'calc' }],
    ['meerkat_self_test', 'bad only', { only: ['x y'] }],
    ['meerkat_self_test', 'bad folder', { folder: 'nope' }],
    ['meerkat_list', 'bad folder', { folder: 'nope' }],
    ['meerkat_why', 'check with a slash', { check: 'a/b' }],
    ['meerkat_why', 'no check', {}],
    ['meerkat_why', 'lines too big', { check: 'build', lines: 99999 }],
  ]
  test.each(bad)('%s rejects %s', async (tool, _label, args) => {
    const { ctx, calls } = makeCtx()
    const r = await call(ctx, tool, args)
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text.length).toBeGreaterThan(5)
    expect(calls).toHaveLength(0)
  })
})

describe('folder confinement (real folders)', () => {
  const base = mkdtempSync(join(tmpdir(), 'meerkat-mcp-'))
  const start = join(base, 'start')
  const inside = join(start, 'proj')
  const sibling = join(base, 'sibling')
  const extra = join(base, 'extra')
  for (const d of [inside, sibling, extra]) mkdirSync(d, { recursive: true })
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  const real = (roots: string[] = []) => {
    const calls: string[][] = []
    const ctx = { ...createContext({ MEERKAT_USER_CONFIG: join(base, 'none.json') }), cwd: start, roots: () => roots, runMeerkat: async (a: string[]) => (calls.push(a), { code: 0, stdout: '', stderr: '', timedOut: false }) }
    return { ctx, calls }
  }
  const list = (ctx: unknown, folder: string) => call(ctx, 'meerkat_list', { folder })

  test('a folder inside the start folder is allowed', async () => {
    const { ctx, calls } = real()
    const r = await list(ctx, inside)
    expect(r.result.isError).toBeFalsy()
    expect(calls).toHaveLength(1)
  })

  test('a sibling folder is refused and the message says how to add a root', async () => {
    const { ctx, calls } = real()
    const r = await list(ctx, sibling)
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('meerkat root add <folder>')
    expect(r.result.content[0].text).toContain('Allowed:')
    expect(calls).toHaveLength(0)
  })

  test('a folder in the configured roots is allowed', async () => {
    const { ctx } = real([extra])
    expect((await list(ctx, extra)).result.isError).toBeFalsy()
  })

  test('.. cannot escape the root', async () => {
    const { ctx, calls } = real()
    const r = await list(ctx, join(inside, '..', '..', 'sibling'))
    expect(r.result.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })

  test('a symlink or junction pointing outside is refused', async () => {
    const link = join(start, 'escape')
    try {
      symlinkSync(sibling, link, 'junction')
    } catch {
      return // this platform cannot create one here
    }
    const { ctx, calls } = real()
    const r = await list(ctx, link)
    expect(r.result.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })

  test('UNC paths are refused', async () => {
    const { ctx, calls } = real()
    for (const p of ['\\\\server\\share\\proj', '//server/share/proj']) {
      const r = await list(ctx, p)
      expect(r.result.isError).toBe(true)
      expect(r.result.content[0].text).toContain('UNC')
    }
    expect(calls).toHaveLength(0)
  })
})

describe('secrets are left out of replies', () => {
  const key = 'AKIA' + 'IOSFODNN7EXAMPLE'

  test('meerkat_why and meerkat_last leave out text holding a key', async () => {
    const { ctx } = makeCtx({ showWhy: () => ({ ok: true, text: `output ${key} end` }), showLast: () => ({ ok: true, text: `report ${key}` }) })
    for (const [tool, args] of [['meerkat_why', { check: 'build' }], ['meerkat_last', {}]] as const) {
      const text = (await call(ctx, tool, args)).result.content[0].text
      expect(text).toBe('(left out: it looks like it contains a secret)')
    }
  })

  test('soft secrets are blanked, other text kept', async () => {
    const { ctx } = makeCtx({ showWhy: () => ({ ok: true, text: 'line one\napi_key = hunter2hunter2\nline three' }) })
    const text = (await call(ctx, 'meerkat_why', { check: 'build' })).result.content[0].text
    expect(text).toContain('line one')
    expect(text).toContain('line three')
    expect(text).not.toContain('hunter2')
  })

  test('a very long line is left out', async () => {
    const { ctx } = makeCtx({ showLast: () => ({ ok: true, text: 'x'.repeat(5000) }) })
    expect((await call(ctx, 'meerkat_last')).result.content[0].text).toBe('(left out: a line is too long to check)')
  })

  test('run reasons, commands and output tails are redacted', async () => {
    const s = summary(new Date().toISOString())
    s.results[1].detail = `failed with ${key}`
    s.results[1].command = `deploy --token ${key}`
    const { ctx } = makeCtx({ readFile: () => JSON.stringify(s) })
    const r = await call(ctx, 'meerkat_run', {})
    const out = JSON.stringify(r.result)
    expect(out).not.toContain(key)
    expect(r.result.structuredContent.failed[0].reason).toBe('(left out: it looks like it contains a secret)')
    expect(r.result.structuredContent.failed[0].command).toBe('(left out: it looks like it contains a secret)')

    const stale = makeCtx({ readFile: () => '{}', runMeerkat: async () => ({ code: 2, stdout: `oops ${key}`, stderr: '', timedOut: false }) }).ctx
    const r2 = await call(stale, 'meerkat_run', {})
    expect(JSON.stringify(r2.result)).not.toContain(key)
  })
})

describe('stdio smoke test', () => {
  test('initialize and tools/list over a real process', async () => {
    const child = spawn(process.execPath, [join(root, 'bin', 'meerkat-mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    try {
      const lines: string[] = await new Promise((res, rej) => {
        const got: string[] = []
        let buf = ''
        const timer = setTimeout(() => rej(new Error(`timed out; got ${JSON.stringify(got)}`)), 8000)
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (d: string) => {
          buf += d
          let i
          while ((i = buf.indexOf('\n')) >= 0) {
            got.push(buf.slice(0, i))
            buf = buf.slice(i + 1)
          }
          if (got.length >= 2) {
            clearTimeout(timer)
            res(got)
          }
        })
        child.on('error', rej)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })}\n`)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
      })
      const a = JSON.parse(lines[0])
      const b = JSON.parse(lines[1])
      expect(a.result.serverInfo.name).toBe('meerkat')
      expect(b.result.tools).toHaveLength(6)
    } finally {
      child.kill()
    }
  }, 10000)
})
