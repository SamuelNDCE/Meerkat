// Issue #60: ep-tauri-command-fs-path cleared EVERY parameter when a command canonicalized and checked starts_with anywhere, and
// electron-context-isolation read the Electron range with a plain number match instead of its lowest allowed version.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { CHECK_TABLES } from '../thorough/rules-electron-plus.mjs'
import { evaluate } from '../thorough/rules.mjs'

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-i60-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
const fsPath = (code: string) => {
  const dir = tree({ 'src-tauri/src/a.rs': code })
  const table = CHECK_TABLES['ep-tauri-cross'].filter((r: { id: string }) => r.id === 'ep-tauri-command-fs-path')
  return evaluate(dir, table, { files: ['src-tauri/src/a.rs'] }).found.length
}

describe('ep-tauri-command-fs-path clears only the variable that is checked', () => {
  const guarded = 'let p = base().join(name).canonicalize().unwrap();\n    if !p.starts_with(base()) { return String::new(); }\n'
  test('one guarded parameter and one unguarded parameter: the unguarded one is still reported', () => {
    expect(fsPath(`#[tauri::command]\nfn copy(name: String, dest: String) {\n    ${guarded}    std::fs::copy(&p, &dest).unwrap();\n}\n`)).toBe(1)
  })
  test('the guarded parameter alone stays clear', () => {
    expect(fsPath(`#[tauri::command]\nfn read(name: String) -> String {\n    ${guarded}    std::fs::read_to_string(&p).unwrap()\n}\n`)).toBe(0)
  })
  test('both parameters guarded is clear', () => {
    const both = 'let q = base().join(dest).canonicalize().unwrap();\n    if !q.starts_with(base()) { return; }\n'
    expect(fsPath(`#[tauri::command]\nfn copy(name: String, dest: String) {\n    ${guarded}    ${both}    std::fs::copy(&p, &q).unwrap();\n}\n`)).toBe(0)
  })
})

describe('electron-context-isolation uses the lowest version a range allows', () => {
  const win = 'new BrowserWindow({ webPreferences: { sandbox: true } })\n'
  const run = (range: string) => {
    const dir = tree({ 'package.json': JSON.stringify({ name: 'a', main: 'main.js', devDependencies: { electron: range } }), 'main.js': win })
    try {
      execFileSync(process.execPath, ['thorough/desktop.mjs', 'electron-context-isolation', '--root', dir], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe', encoding: 'utf8' })
      return 0
    } catch (e: any) {
      return e.status ?? -1
    }
  }
  test('an upper-bound-only alternative allows old versions, so the omitted setting is reported', () => {
    expect(run('<9 || ^41')).toBe(1)
    expect(run('<20')).toBe(1)
  })
  test('ranges whose lowest bound is 12 or more stay clear', () => {
    expect(run('>=12 <30')).toBe(0)
    expect(run('^41.0.0')).toBe(0)
    expect(run('12.0.0 - 30.0.0')).toBe(0)
    expect(run('^41 || ^12')).toBe(0)
  })
  test('a range whose lowest bound is below 12 is reported', () => {
    expect(run('^41 || ^9')).toBe(1)
  })
})
