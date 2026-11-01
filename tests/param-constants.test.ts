// risky-code: `el.innerHTML = icon` inside a local helper is author-written markup only when EVERY call of the helper passes a literal or an ALL_CAPS constant for
// that parameter and the helper is not exported or passed around. Found on Plume (xlsxview.js, the find bar buttons).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const status = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-pc-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  try {
    execFileSync(process.execPath, ['thorough/static.mjs', 'risky-code', '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}
const helper = "const btn = (icon, label, fn) => {\n  const b = el('button')\n  b.innerHTML = icon\n  return b\n}\n"

describe('innerHTML set from a helper parameter', () => {
  test('safe: every call passes a constant or a literal', () => {
    expect(status({ 'a.js': `${helper}btn(ICON.up, 'Up', f)\nbtn(ICON.down, 'Down', g)\nbtn('<b>x</b>', 'X', h)\n` })).toBe(0)
  })
  test('reported: one call passes a variable', () => {
    expect(status({ 'a.js': `${helper}btn(ICON.up, 'Up', f)\nbtn(userHtml, 'Down', g)\n` })).toBe(1)
  })
  test('reported: one call passes a built-up string', () => {
    expect(status({ 'a.js': `${helper}btn(ICON.up, 'Up', f)\nbtn(ICON.up + extra, 'Down', g)\n` })).toBe(1)
  })
  test('reported: the helper is also passed around as a value', () => {
    expect(status({ 'a.js': `${helper}btn(ICON.up, 'Up', f)\nitems.map(btn)\n` })).toBe(1)
  })
  test('reported: the helper is never called in the file (callers unknown)', () => {
    expect(status({ 'a.js': helper })).toBe(1)
  })
  test('reported: the parameter is reassigned before use', () => {
    expect(status({ 'a.js': "const btn = (icon) => {\n  icon = location.hash\n  b.innerHTML = icon\n}\nbtn(ICON.up)\n" })).toBe(1)
  })
})
