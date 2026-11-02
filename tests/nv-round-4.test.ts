// False alarms found on the NeuralVault scan of 2026-11-02 and fixed in round 4. Each test checks both sides: the false alarm is gone and the real defect is still reported.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { CHECK_TABLES } from '../thorough/rules-electron-plus.mjs'
import { evaluate } from '../thorough/rules.mjs'
import { links } from '../lib/builtin.mjs'

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-round4-'))
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

describe('ep-tauri-command-fs-path', () => {
  test('a path that comes from the page into std::fs is reported', () => {
    expect(fsPath('#[tauri::command]\nfn read(path: String) -> String {\n    std::fs::read_to_string(&path).unwrap()\n}\n')).toBe(1)
  })
  test('a helper in the same file that is not a command is not reported', () => {
    expect(fsPath('#[tauri::command]\nfn ping() {}\nfn load(path: &Path) -> String {\n    std::fs::read_to_string(path).unwrap()\n}\n')).toBe(0)
  })
  test('a command that builds its own path is not reported', () => {
    expect(fsPath('#[tauri::command]\nfn read(name: String) -> String {\n    let path = base().join(name);\n    std::fs::read_to_string(&path).unwrap()\n}\n')).toBe(0)
  })
  test('a unit test in the same file is not reported', () => {
    expect(fsPath('#[tauri::command]\nfn ping() {}\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn t() {\n        let path = tmp();\n        std::fs::read_to_string(&path).unwrap();\n    }\n}\n')).toBe(0)
  })
})

describe('electron-context-isolation', () => {
  const run = (win: string) => {
    const dir = tree({ 'package.json': '{"name":"a","main":"main.js","devDependencies":{"electron":"41.0.0"}}', 'main.js': win })
    try {
      execFileSync(process.execPath, ['thorough/desktop.mjs', 'electron-context-isolation', '--root', dir], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe', encoding: 'utf8' })
      return 0
    } catch (e: any) {
      return e.status ?? -1
    }
  }
  test('leaving the setting out passes (Electron 12 and later default to true)', () => {
    expect(run("new BrowserWindow({ webPreferences: { ...secureWebPreferences(__dirname), backgroundThrottling: false } })\n")).toBe(0)
  })
  test('an explicit false still fails', () => {
    expect(run('new BrowserWindow({ webPreferences: { contextIsolation: false } })\n')).toBe(1)
  })
})

describe('local links', () => {
  test('owner/repo and git@ shorthand in a notices file is not a link to a file', () => {
    const dir = tree({ 'THIRD-PARTY-NOTICES.md': '- [a 1.0](owner/repo)\n- [b](git@github.com:o/b)\n', 'README.md': '[x](docs/missing.md)\n[y](git@github.com:o/b)\n' })
    const r = links({ root: dir, files: ['THIRD-PARTY-NOTICES.md', 'README.md'] })
    expect(r.findings.length).toBe(1)
    expect(r.findings[0]).toContain('README.md:1')
  })
})

describe('pii-patterns-in-source', () => {
  const pii = (src: string) => {
    const dir = tree({ 'a.js': src })
    try {
      execFileSync(process.execPath, ['thorough/privacy.mjs', 'pii-patterns-in-source', '--root', dir], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe', encoding: 'utf8' })
      return 0
    } catch (e: any) {
      return e.status ?? -1
    }
  }
  test('user:password@host in a web address is not an email address', () => {
    expect(pii("const u = 'postgres://admin:Sup3rS3cretPw@db.acme.io/app'\n")).toBe(0)
    expect(pii("// see https://evil.example/x@registry.npmjs.org\n")).toBe(0)
  })
  test('a real-looking email address is still reported', () => {
    expect(pii("const owner = 'maria.lopez@gmail.com'\n")).toBe(1)
  })
})
