// The MCP tools meerkat_doctor, meerkat_recommend and meerkat_tools must hand the model readable text, not only an exit code.
// Calls the tool handlers through handleMessage (no stdio server) with a fake runCli.
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { doctorText } from './doctor.mjs'
// @ts-expect-error plain .mjs module
import { handleMessage } from './mcp.mjs'

const HERE = resolve('/work/proj')
const REPORT = { ideas: 1, folder: HERE, configFile: null, quickChecks: 4, wouldRun: 3, notRun: [{ id: 'gitleaks', tool: 'gitleaks', tools: ['gitleaks'], install: null, fix: 'install gitleaks and put it on your PATH', reason: 'needs gitleaks' }], fallbacks: [], missingLine: null, packsOff: [], suggested: [], next: [], notes: [] }

function ctxWith(stdout: string) {
  return { version: '9.9.9', cwd: HERE, isDirectory: (p: string) => p.startsWith(resolve('/work')), realpath: (p: string) => p, roots: () => [], runCli: async () => ({ code: 0, stdout, stderr: '', timedOut: false }) }
}
const call = (ctx: unknown, name: string) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }, ctx)

describe('doctor, recommend and tools return text', () => {
  test.each(['meerkat_doctor', 'meerkat_recommend', 'meerkat_tools'])('%s has a non-empty text block and an exit code', async (tool) => {
    const r = await call(ctxWith(JSON.stringify(REPORT)), tool)
    expect(r.result.isError).not.toBe(true)
    expect(r.result.structuredContent.exitCode).toBe(0)
    const text = r.result.content?.[0]?.text
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(20)
  })

  test('the CLI text for the same report names the folder and what is NOT RUN', () => {
    const t = doctorText(REPORT)
    expect(t).toContain(`Folder: ${HERE}`)
    expect(t).toContain('NOT RUN: 1')
  })

  // Needs the handler change in lib/mcpmore.mjs (see the 0.5.6 map report): folderTool should run the command without --json and
  // return the CLI text, or put the report into structuredContent next to exitCode. Until then this stays a todo.
  test.todo('meerkat_doctor text equals what `meerkat doctor` prints (starts with "Meerkat doctor:")')
})
