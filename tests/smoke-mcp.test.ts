// SMOKE: starts the real MCP server (bin/meerkat-mcp.mjs) over stdio on a copy of tests/fixtures/smoke-app and calls every tool it lists once with valid arguments.
// The tool list comes from the server's own tools/list, and its length is compared with the server's own registry (TOOLS in lib/mcp.mjs), so a new tool
// is covered automatically and fails "every tool has an example" until an example is added to ARGS below.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { TOOLS } from '../lib/mcp.mjs'
// @ts-expect-error plain .mjs module
import { hasStack, makeSandbox, startMcp } from './smoke-helpers.mjs'

type Tool = { name: string; description?: string; inputSchema?: { required?: string[] } }
let sb: ReturnType<typeof makeSandbox>
let mcp: ReturnType<typeof startMcp>
let listed: Tool[] = []
let findingId = ''

// Valid arguments for each tool, run in this order (meerkat_run first, because many tools read the run it leaves behind).
// A function gets the sandbox and the id of one finding of that run. `skip` names a tool that is listed but not called here, and why.
const ARGS: Record<string, { args?: (ctx: { app: string; id: string }) => Record<string, unknown>; skip?: string; failedCheckIsError?: boolean }> = {
  // The fixture has no LICENSE file, so this check fails and leaves a finding for the tools below. A failed check comes back as an error RESULT by design (see the tool description), not as a JSON-RPC error.
  meerkat_run: { args: () => ({ only: ['license'] }), failedCheckIsError: true },
  meerkat_list: { args: () => ({}) },
  meerkat_presets: {},
  meerkat_last: {},
  meerkat_why: { args: () => ({ check: 'license' }) },
  meerkat_findings: { args: () => ({ limit: 5 }) },
  meerkat_finding: { args: ({ id }) => ({ id }) },
  meerkat_prompt: { args: ({ app }) => ({ folder: app }) },
  meerkat_run_list: { args: ({ app }) => ({ folder: app, limit: 5 }) },
  meerkat_check_list: { args: ({ app }) => ({ folder: app }) },
  meerkat_version: {},
  meerkat_trend: {},
  meerkat_suggest: {},
  meerkat_pr_comment: {},
  meerkat_map: {},
  meerkat_blast: { args: () => ({ target: 'src/math.js#add' }) },
  meerkat_brief: { args: () => ({ target: 'src/math.js#add' }) },
  meerkat_gate: { args: () => ({ staged: true }) },
  meerkat_smoke: { args: () => ({ timeout: 20 }) },
  meerkat_tests: {},
  meerkat_summary: {},
  meerkat_first_failure: {},
  meerkat_doctor: {},
  meerkat_discover: {},
  meerkat_recommend: {},
  meerkat_tools: {},
  meerkat_describe: {},
  meerkat_hook_status: {},
  meerkat_hook: { args: ({ app }) => ({ folder: app, action: 'install' }) },
  meerkat_baseline: { args: ({ app }) => ({ folder: app }) },
  meerkat_dismiss: { args: ({ app, id }) => ({ folder: app, id, reason: 'smoke test: not a problem' }) },
  meerkat_dismissals: { args: () => ({ stats: true }) },
  meerkat_undismiss: { args: ({ app, id }) => ({ folder: app, id }) },
  // Last of the run-reading tools: a self-test becomes the newest run and has no findings.json, so finding / dismiss / undismiss would have nothing to read after it.
  meerkat_self_test: { args: () => ({ only: ['license'] }) },
  meerkat_redtest: { skip: 'it runs Meerkat\'s own test files with vitest (minutes), which is a loop inside a test run; its error path is in red-failures.test.ts' },
}
const textOf = (r: { result?: { content?: { type: string; text: string }[] } }) => (r.result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

beforeAll(async () => {
  sb = makeSandbox({ label: 'mcp' })
  mcp = startMcp(sb)
}, 60000)
afterAll(async () => {
  await mcp?.close()
  sb?.cleanup()
})

describe('MCP server smoke', () => {
  test('initialize answers with the server name and version', async () => {
    const r = await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } })
    expect(r.error).toBeUndefined()
    expect(r.result.serverInfo.name).toBe('meerkat')
    expect(r.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/)
    mcp.notify('notifications/initialized')
  })

  test('tools/list lists exactly the tools the server registers', async () => {
    const r = await mcp.call('tools/list', {})
    expect(r.error).toBeUndefined()
    listed = r.result.tools
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.map((t) => t.name).sort()).toEqual(TOOLS.map((t: Tool) => t.name).sort())
    expect(new Set(listed.map((t) => t.name)).size).toBe(listed.length)
    for (const t of listed) {
      expect(t.description, `${t.name} has no description`).toBeTruthy()
      expect(t.inputSchema, `${t.name} has no input schema`).toBeTruthy()
    }
  })

  test('every tool has an example in this test', () => {
    const missing = listed.map((t) => t.name).filter((n) => !ARGS[n])
    expect(missing, `add an entry to ARGS in tests/smoke-mcp.test.ts for: ${missing.join(', ')}`).toEqual([])
  })

  test('the other protocol lists answer: resources, prompts, ping', async () => {
    for (const method of ['resources/list', 'prompts/list', 'ping']) {
      const r = await mcp.call(method, {})
      expect(r.error, `${method}: ${JSON.stringify(r.error)}`).toBeUndefined()
      expect(r.result).toBeTruthy()
    }
  })

  const names = Object.keys(ARGS)
  for (const name of names) {
    test(`tools/call ${name}`, async () => {
      const ex = ARGS[name]
      if (ex.skip) return // the reason is written in ARGS
      if (!listed.some((t) => t.name === name)) throw new Error(`${name} is in ARGS but the server does not list it: remove it from ARGS`)
      if (name === 'meerkat_finding') {
        // The id of one finding of the run above (meerkat_findings text carries it).
        const f = await mcp.call('tools/call', { name: 'meerkat_findings', arguments: { limit: 1 } })
        findingId = JSON.stringify(f.result).match(/\b[0-9a-f]{16}\b/)?.[0] ?? ''
      }
      const r = await mcp.call('tools/call', { name, arguments: ex.args ? ex.args({ app: sb.app, id: findingId }) : {} }, { timeoutMs: 150000 })
      expect(r.error, `${name} returned a JSON-RPC error: ${JSON.stringify(r.error)}`).toBeUndefined()
      expect(r.result, `${name} returned no result`).toBeTruthy()
      const text = textOf(r)
      expect(text.trim().length, `${name} returned no content text`).toBeGreaterThan(0)
      if (!ex.failedCheckIsError) expect(r.result.isError === true, `${name} reported an error: ${text.slice(0, 300)}`).toBe(false)
      else expect(text).toMatch(/license/i)
      expect(hasStack(text), `a stack trace in ${name}`).toBe(false)
    }, 160000)
  }

  test('the server ends cleanly when its input ends', async () => {
    const code = await mcp.close()
    expect(code).toBe(0)
    expect(hasStack(mcp.stderr())).toBe(false)
  })
})
