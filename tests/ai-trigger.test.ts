// AI trigger work: skill descriptions name concrete triggers, `meerkat ai hooks` prints (and never writes) a hooks snippet,
// MCP tool text tells clients to run long checks in the background, and every run result opens with a one-line headline.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { hooksSnippet } from '../lib/aihooks.mjs'
// @ts-expect-error plain .mjs module
import { emptyRunText, headline, topPlaces } from '../lib/aisummary.mjs'
// @ts-expect-error plain .mjs module
import { handleMessage, TOOLS } from '../lib/mcp.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function frontmatter(file: string) {
  const s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const m = s.match(/^---\nname: (.+)\ndescription: \|-\n((?:  .*\n)+)---\n/)
  return m ? { name: m[1].trim(), description: m[2].replace(/^  /gm, '') } : null
}

describe('skill triggers', () => {
  const dirs = readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  test('there are skills to check', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(9)
  })
  for (const dir of dirs) {
    test(`${dir}: name matches the folder and the description names a trigger`, () => {
      const fm = frontmatter(join(root, 'skills', dir, 'SKILL.md'))
      expect(fm, 'frontmatter must be name + a "description: |-" block').not.toBeNull()
      expect(fm!.name).toBe(dir)
      expect(fm!.description).toMatch(/\b(use when|about to|you are about to|before you)\b/i)
    })
  }
})

describe('meerkat ai hooks', () => {
  test('the snippet has PreToolUse on git commit and git push, and Stop, each with a timeout in seconds', () => {
    const h = hooksSnippet().hooks
    const rules = h.PreToolUse.map((g: { hooks: { if: string }[] }) => g.hooks[0].if)
    expect(rules).toEqual(['Bash(git commit *)', 'Bash(git push *)'])
    for (const g of h.PreToolUse) {
      expect(g.matcher).toBe('Bash')
      expect(g.hooks[0]).toMatchObject({ type: 'command', timeout: expect.any(Number) })
      expect(g.hooks[0].command).toContain('meerkat gate --staged')
    }
    expect(h.Stop[0].matcher).toBeUndefined()
    expect(h.Stop[0].hooks[0]).toMatchObject({ type: 'command', timeout: expect.any(Number) })
    expect(h.Stop[0].hooks[0].command).not.toContain('exit 2')
  })

  test('the command prints JSON on stdout and writes no settings file', () => {
    const r = spawnSync(process.execPath, [join(root, 'bin', 'meerkat.mjs'), 'ai', 'hooks'], { cwd: root, encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).hooks.Stop).toBeTruthy()
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false)
  })
})

describe('MCP background guidance', () => {
  for (const name of ['meerkat_run', 'meerkat_gate']) {
    test(`${name} tells the client to run in the background, poll, and not sleep`, () => {
      const d = TOOLS.find((t: { name: string }) => t.name === name).description as string
      expect(d).toMatch(/minutes/)
      expect(d).toMatch(/background/)
      expect(d).toMatch(/meerkat_last/)
      expect(d).toMatch(/not wait with sleep/)
    })
  }
})

describe('run result headline', () => {
  test('first line shape: status, counts, top three file:line', () => {
    const top = [{ file: 'a.js', line: 3 }, { file: 'b.js', line: 9 }, { file: 'c.js' }, { file: 'd.js', line: 1 }]
    const line = headline({ failed: 2, warned: 1, passed: 5, top })
    expect(line).toBe('Meerkat FAIL: 2 failed, 1 warned, 5 passed. Top: a.js:3, b.js:9, c.js')
    expect(headline({ failed: 0, warned: 0, passed: 4 })).toBe('Meerkat PASS: 0 failed, 0 warned, 4 passed.')
    expect(topPlaces(top)).toHaveLength(3)
  })

  const base = { version: '9.9.9', cwd: root, now: () => Date.now(), presets: { quick: { tier: 'fast', groups: [] } }, userPresets: () => ({}), isDirectory: () => true, realpath: (p: string) => p, roots: () => [], latestRunDir: () => '/logs/run1', showLast: () => ({ ok: true, text: '' }), showWhy: () => ({ ok: true, text: '' }) }
  const call = (ctx: unknown, name: string) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }, ctx)
  const summary = (counts: { pass: number; fail: number; notRun: number }, results: unknown[]) => JSON.stringify({ summary: 'MEERKAT quick', counts, startedAt: new Date().toISOString(), results })

  test('meerkat_run text starts with the headline line', async () => {
    const ctx = { ...base, runMeerkat: async () => ({ code: 1, stdout: '', stderr: '', timedOut: false }), readFile: () => summary({ pass: 1, fail: 1, notRun: 0 }, [{ id: 'lint', status: 'PASS', ms: 1 }, { id: 'build', status: 'FAIL', ms: 5, detail: 'exit 1' }]), findingsSummary: () => ({ top: [{ file: 'x.js', line: 7 }] }) }
    const r = await call(ctx, 'meerkat_run')
    const text = r.result.content[0].text as string
    expect(text.split('\n')[0]).toContain('Meerkat FAIL: 1 failed, 0 warned, 1 passed. Top: x.js:7') // the status line comes first (mcp parity)
    expect(r.result.structuredContent.headline).toBe('Meerkat FAIL: 1 failed, 0 warned, 1 passed. Top: x.js:7')
  })
})

describe('never return nothing', () => {
  test('emptyRunText names the preset and the reason', () => {
    const t = emptyRunText({ preset: 'quick', reason: 'no check matched' })
    expect(t).toContain('"quick"')
    expect(t).toContain('no check matched')
    expect(t.length).toBeGreaterThan(40)
  })

  test('a run with zero checks returns an explicit message, not an empty result', async () => {
    const ctx = {
      version: '9.9.9', cwd: root, now: () => Date.now(), presets: { quick: { tier: 'fast', groups: [] } }, userPresets: () => ({}), isDirectory: () => true, realpath: (p: string) => p, roots: () => [], latestRunDir: () => '/logs/run1', showLast: () => ({ ok: true, text: '' }), showWhy: () => ({ ok: true, text: '' }),
      runMeerkat: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
      readFile: () => JSON.stringify({ summary: 'MEERKAT quick: 0 passed', counts: { pass: 0, fail: 0, notRun: 0 }, startedAt: new Date().toISOString(), results: [] }),
    }
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'meerkat_run', arguments: { preset: 'quick' } } }, ctx)
    const text = r.result.content[0].text as string
    expect(text).toContain('ran no checks')
    expect(text).toContain('"quick"')
    expect(r.result.structuredContent.empty).toBe(true)
  })
})
