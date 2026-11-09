// 0.5.3 false alarms: risky-code on a constant innerHTML, js-await-in-loop on a loop that leaves at once, markers inside quotes, the gate and quick presets.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { GATE_DEFAULT_PRESET, PRESETS, QUICK_EXCLUDED_CHECKS, resolvePreset } from '../lib/presets.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function run(script: string, check: string, files: Record<string, string>, tracked = false): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-053-'))
  made.push(dir)
  mkdirSync(dir, { recursive: true })
  for (const [n, body] of Object.entries(files)) writeFileSync(join(dir, n), body)
  if (tracked) {
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'pipe' })
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' })
  }
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

describe('risky-code and a constant innerHTML', () => {
  const risky = (body: string) => run('thorough/static.mjs', 'risky-code', { 'a.js': body })
  test('a constant icon assigned inside a one-line helper is quiet', () => {
    expect(risky("const icon = '<svg></svg>'\nfunction paint(btn) { btn.innerHTML = icon }\n").code).toBe(0)
  })
  test('a string literal is quiet', () => {
    expect(risky("el.innerHTML = '<svg></svg>'\n").code).toBe(0)
  })
  test('a variable taken from the request is still a finding', () => {
    expect(risky('const icon = req.query.icon\nfunction paint(btn) { btn.innerHTML = icon }\n').code).toBe(1)
  })
  test('a constant that is reassigned from input is still a finding', () => {
    expect(risky("let icon = '<i></i>'\nicon = req.body.x\nel.innerHTML = icon\n").code).toBe(1)
  })
})

describe('js-await-in-loop and a loop that leaves at once', () => {
  const lang = (body: string) => run('thorough/lang.mjs', 'js-await-in-loop', { 'a.js': body })
  test('await then break in the body is quiet', () => {
    expect(lang('export async function f(ids) {\n  for (const id of ids) {\n    await g(id)\n    break\n  }\n}\n').code).toBe(0)
  })
  test('await then return in the body is quiet', () => {
    expect(lang('export async function f(ids) {\n  for (const id of ids) {\n    await g(id)\n    return id\n  }\n}\n').code).toBe(0)
  })
  test('an await in a loop with no exit is still flagged', () => {
    expect(lang('export async function f(ids) {\n  for (const id of ids) {\n    await g(id)\n  }\n}\n').code).toBe(1)
  })
  test('a break that only happens under an if does not excuse the loop', () => {
    expect(lang('export async function f(ids) {\n  for (const id of ids) {\n    await g(id)\n    if (id.last) break\n  }\n}\n').code).toBe(1)
  })
})

describe('markers ignores text that talks about the marker', () => {
  const marks = (name: string, body: string) => run('thorough/hygiene.mjs', 'markers', { [name]: body }, true)
  test('a real FIXME comment is still found', () => {
    expect(marks('a.js', '// FIXME: broken\n').code).toBe(1)
  })
  test('a quoted marker inside a comment is quiet', () => {
    expect(marks('a.js', '// Leave a "FIXME" note or a `XXX` note here to mark it\n').code).toBe(0)
  })
  test('a marker inside a string literal is quiet', () => {
    expect(marks('a.js', "const m = 'FIXME'\nconst n = \"XXX\"\n").code).toBe(0)
  })
  test('a markdown heading that names the marker in backticks is quiet', () => {
    expect(marks('a.md', '# The `FIXME` check\n').code).toBe(0)
  })
  test('an apostrophe does not hide a real marker', () => {
    expect(marks('a.js', "// don't leave FIXME here, it's bad\n").code).toBe(1)
  })
})

describe('preset defaults', () => {
  test('the gate default preset is bugs', () => {
    expect(GATE_DEFAULT_PRESET).toBe('bugs')
    expect(resolvePreset(GATE_DEFAULT_PRESET).preset.excludeChecks).toContain('markdownlint')
  })
  test('quick and fast leave out the documentation and style-only checks, full does not', () => {
    for (const n of ['quick', 'fast']) {
      const p = resolvePreset(n).preset
      for (const id of QUICK_EXCLUDED_CHECKS) expect(p.excludeChecks).toContain(id)
    }
    expect((PRESETS as any).full.excludeChecks).toBeUndefined()
  })
})
