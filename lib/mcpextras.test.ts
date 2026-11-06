// MCP resources and prompts: read-only, no new tool, no explanations, secrets left out.
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { handleMessage, TOOLS } from './mcp.mjs'
// @ts-expect-error plain .mjs module
import { PROMPTS, RESOURCES, RESOURCE_TEMPLATES } from './mcpextras.mjs'

const doc = {
  run: { id: '20260101-000000-x' },
  counts: { total: 2, new: 1, known: 1, fixed: 0 },
  findings: [
    { id: 'aaaa', severity: 'high', rule: 'no-eval', check: 'risky', suite: 'code', file: 'src/a.js', line: 3, status: 'new', message: 'eval call', evidence: 'eval(x)', explanation: 'WHY TEXT', fix: 'FIX TEXT', rawOutput: ['RAW'] },
    { id: 'bbbb', severity: 'low', rule: null, check: 'lint', suite: 'code', file: null, line: null, status: 'known', message: `key ${'AKIA' + 'IOSFODNN7EXAMPLE'} in file` },
  ],
}

function ctx(over: Record<string, unknown> = {}) {
  return {
    version: '9.9.9',
    latestFindings: () => ({ ok: true, dir: '/logs/run1', doc }),
    showLast: () => ({ ok: true, text: '# Meerkat run: quick' }),
    showWhy: (id: string, lines: number) => (id === 'build' ? { ok: true, text: `log ${id} ${lines}` } : { ok: false, text: 'no log' }),
    ...over,
  }
}
const rpc = (c: unknown, method: string, params?: unknown) => handleMessage({ jsonrpc: '2.0', id: 1, method, params }, c)

describe('capabilities and tools', () => {
  test('initialize advertises resources and prompts, and there are still six tools', async () => {
    const r = await rpc(ctx(), 'initialize', { protocolVersion: '2025-11-25' })
    expect(r.result.capabilities).toEqual({ tools: {}, resources: {}, prompts: {} })
    expect(TOOLS).toHaveLength(6)
  })
})

describe('resources', () => {
  test('resources/list and templates/list', async () => {
    const l = await rpc(ctx(), 'resources/list')
    expect(l.result.resources.map((x: { uri: string }) => x.uri)).toEqual(['meerkat://run/latest/findings', 'meerkat://run/latest/report'])
    expect(l.result.resources).toEqual(RESOURCES)
    const t = await rpc(ctx(), 'resources/templates/list')
    expect(t.result.resourceTemplates).toEqual(RESOURCE_TEMPLATES)
  })

  test('findings: evidence, rule and place only; no explanation, fix or raw output; a secret is left out', async () => {
    const r = await rpc(ctx(), 'resources/read', { uri: 'meerkat://run/latest/findings' })
    const c = r.result.contents[0]
    expect(c.uri).toBe('meerkat://run/latest/findings')
    expect(c.mimeType).toBe('application/json')
    const body = JSON.parse(c.text)
    expect(body.counts.total).toBe(2)
    expect(body.findings[0]).toEqual({ id: 'aaaa', severity: 'high', rule: 'no-eval', check: 'risky', suite: 'code', file: 'src/a.js', line: 3, status: 'new', message: 'eval call', evidence: 'eval(x)' })
    expect(c.text).not.toMatch(/WHY TEXT|FIX TEXT|RAW|AKIAIOSFODNN7/)
    expect(body.findings[1].message).toBe('(left out: it looks like it contains a secret)')
  })

  test('report and a check log', async () => {
    const r = await rpc(ctx(), 'resources/read', { uri: 'meerkat://run/latest/report' })
    expect(r.result.contents[0]).toEqual({ uri: 'meerkat://run/latest/report', mimeType: 'text/markdown', text: '# Meerkat run: quick' })
    const l = await rpc(ctx(), 'resources/read', { uri: 'meerkat://run/latest/log/build' })
    expect(l.result.contents[0].text).toBe('log build 80')
  })

  test('not found: -32002 for an unknown uri, a bad check name, a missing log, and no run saved', async () => {
    for (const uri of ['meerkat://nope', 'meerkat://run/latest/log/../x', 'meerkat://run/latest/log/Bad Name', 'meerkat://run/latest/log/missing']) {
      const r = await rpc(ctx(), 'resources/read', { uri })
      expect(r.error.code).toBe(-32002)
    }
    const none = await rpc(ctx({ latestFindings: () => ({ ok: false, text: 'No run has been saved yet.' }) }), 'resources/read', { uri: 'meerkat://run/latest/findings' })
    expect(none.error.code).toBe(-32002)
    const noUri = await rpc(ctx(), 'resources/read', {})
    expect(noUri.error.code).toBe(-32602)
  })
})

describe('prompts', () => {
  test('prompts/list names the three jobs', async () => {
    const r = await rpc(ctx(), 'prompts/list')
    expect(r.result.prompts.map((p: { name: string }) => p.name)).toEqual(['triage_newest_run', 'check_one_fix', 'scan_diff'])
    expect(r.result.prompts).toEqual(PROMPTS)
  })

  test('check_one_fix closes the loop with only set to that one check', async () => {
    const r = await rpc(ctx(), 'prompts/get', { name: 'check_one_fix', arguments: { check: 'build', folder: 'proj' } })
    const text = r.result.messages[0].content.text
    expect(r.result.messages[0].role).toBe('user')
    expect(text).toContain('meerkat_run with only set to ["build"]')
    expect(text).toContain('folder "proj"')
    expect(text).toContain('meerkat://run/latest/findings')
  })

  test('triage and scan_diff reference the resource and the rule/evidence/example format', async () => {
    for (const name of ['triage_newest_run', 'scan_diff']) {
      const r = await rpc(ctx(), 'prompts/get', { name })
      const text = r.result.messages[0].content.text
      expect(text).toContain('meerkat://run/latest/findings')
      expect(text).toContain('bad example and a short good example')
    }
  })

  test('bad input is -32602', async () => {
    for (const p of [{ name: 'nope' }, { name: 'check_one_fix' }, { name: 'check_one_fix', arguments: { check: 'Bad; rm' } }, { name: 'scan_diff', arguments: { folder: 'a\nb' } }, { name: 'scan_diff', arguments: [] }]) {
      const r = await rpc(ctx(), 'prompts/get', p)
      expect(r.error.code).toBe(-32602)
    }
  })

  test('no text of any prompt or resource description holds an em dash', () => {
    expect(JSON.stringify([PROMPTS, RESOURCES, RESOURCE_TEMPLATES])).not.toContain('—')
  })
})
