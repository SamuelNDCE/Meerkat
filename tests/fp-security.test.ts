// False alarms found in the NeuralVault audits (2026-11-02) for the SECURITY and Electron/Rust rules. Every test checks both sides:
// the audited false shape no longer reports, and the genuine defect of the same rule still does.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { RS } from '../thorough/rules-code-patterns.mjs'
import { CHECK_TABLES as EP } from '../thorough/rules-electron-plus.mjs'
import { DOCKER_RULES } from '../thorough/rules-infra-plus.mjs'
import { SAFETY } from '../thorough/rules-rust-plus.mjs'
import { evaluate } from '../thorough/rules.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fpsec-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
// Number of findings one rule of a table gives on a small folder.
const count = (table: any[], id: string, files: Record<string, string>) => {
  const dir = tree(files)
  return evaluate(dir, table.filter((r) => r.id === id), { files: Object.keys(files) }).found.length
}
// Exit code of `node thorough/<script> <check> --root <dir>`: 0 pass, 1 findings.
const cli = (script: string, check: string, files: Record<string, string>) => {
  const dir = tree(files)
  try {
    execFileSync(process.execPath, [`thorough/${script}`, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}
const EPK = [...EP['ep-window'], ...EP['ep-ipc-preload'], ...EP['ep-content-renderer']]

describe('ep-window-open-variable', () => {
  const handler = "win.webContents.setWindowOpenHandler(({ url }) => {\n  openExternalWithConsent(url)\n  return { action: 'deny' }\n})\n"
  test('window.open of a variable is fine when the main process denies every window and routes to a consent dialog', () => {
    expect(count(EPK, 'ep-window-open-variable', { 'main.js': handler, 'src/page.js': 'function go(url) { window.open(url) }\n' })).toBe(0)
  })
  test('without such a handler, or with one that allows windows, it is still reported', () => {
    expect(count(EPK, 'ep-window-open-variable', { 'src/page.js': 'function go(url) { window.open(url) }\n' })).toBe(1)
    expect(count(EPK, 'ep-window-open-variable', { 'main.js': "win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }))\n", 'src/page.js': 'window.open(url)\n' })).toBe(1)
  })
})

describe('ep-execute-js and ep-load-url', () => {
  test('a module-level constant script or address is fixed', () => {
    expect(count(EPK, 'ep-execute-js-variable', { 'main.js': 'const SNAPSHOT = `(() => document.title)()`\nconst snap = (win) => win.webContents.executeJavaScript(SNAPSHOT)\n' })).toBe(0)
    expect(count(EPK, 'ep-load-url-variable', { 'main.js': "const DEV_SERVER = 'http://localhost:5273'\nawait win.loadURL(DEV_SERVER)\n" })).toBe(0)
  })
  test('a parameter, or a template with a hole, is still reported', () => {
    expect(count(EPK, 'ep-execute-js-variable', { 'main.js': 'function run(js) {\n  return win.webContents.executeJavaScript(js)\n}\n' })).toBe(1)
    expect(count(EPK, 'ep-execute-js-variable', { 'main.js': 'const CODE = `window.user = ${input}`\nwin.webContents.executeJavaScript(CODE)\n' })).toBe(1)
    expect(count(EPK, 'ep-load-url-variable', { 'main.js': 'function open(target) {\n  win.loadURL(target)\n}\n' })).toBe(1)
  })
  test('holes wrapped in JSON.stringify (script) or encodeURIComponent (data: page) are escaped', () => {
    expect(count(EPK, 'ep-execute-js-concat', { 'main.js': "win.webContents.executeJavaScript(`localStorage.setItem('page', ${JSON.stringify(page)})`)\n" })).toBe(0)
    expect(count(EPK, 'ep-load-url-concat', { 'main.js': 'void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)\n' })).toBe(0)
  })
  test('a raw hole, or a web address with an encoded hole, is still reported', () => {
    expect(count(EPK, 'ep-execute-js-concat', { 'main.js': 'win.webContents.executeJavaScript(`window.user = ${input}`)\n' })).toBe(1)
    expect(count(EPK, 'ep-execute-js-concat', { 'main.js': 'win.webContents.executeJavaScript(`window.a = ${JSON.stringify(a)}; window.b = ${b}`)\n' })).toBe(1)
    expect(count(EPK, 'ep-load-url-concat', { 'main.js': 'win.loadURL(`data:text/html,${html}`)\n' })).toBe(1)
    expect(count(EPK, 'ep-load-url-concat', { 'main.js': 'win.loadURL(`https://app.example.com/?q=${encodeURIComponent(q)}`)\n' })).toBe(1)
  })
})

describe('ep-permission-check-true', () => {
  const filler = Array.from({ length: 25 }, (_, i) => `const x${i} = ${i}\n`).join('')
  test('a return true in another function of a file that also sets a handler is not the handler', () => {
    expect(count(EPK, 'ep-permission-check-true', { 'main.js': `ses.setPermissionCheckHandler((wc, p) => p === 'clipboard-read')\n${filler}function confirmDiscard() {\n  if (win.isDestroyed()) return true\n}\n` })).toBe(0)
  })
  test('a handler that answers yes is still reported', () => {
    expect(count(EPK, 'ep-permission-check-true', { 'main.js': 'ses.setPermissionCheckHandler(() => true)\n' })).toBe(1)
    expect(count(EPK, 'ep-permission-check-true', { 'main.js': 'ses.setPermissionCheckHandler((wc, p) => {\n  return true\n})\n' })).toBe(1)
  })
})

describe('ep-ipc-stack-sent', () => {
  test('a helper that returns a stack for the main process is not an IPC reply', () => {
    expect(count(EPK, 'ep-ipc-stack-sent', { 'main.js': 'function describeError(e) {\n  return e.stack\n}\n' })).toBe(0)
  })
  test('a stack sent to the page, or returned from an ipc handler, is still reported', () => {
    expect(count(EPK, 'ep-ipc-stack-sent', { 'main.js': "event.reply('read-error', err.stack)\n" })).toBe(1)
    expect(count(EPK, 'ep-ipc-stack-sent', { 'main.js': "ipcMain.handle('read', async () => {\n  try { return read() } catch (err) {\n    return err.stack\n  }\n})\n" })).toBe(1)
  })
})

describe('ep-ipc-listen-channel-variable', () => {
  test('a channel checked against an allowlist just above is fine', () => {
    expect(count(EPK, 'ep-ipc-listen-channel-variable', { 'preload.js': "const ALLOWED = ['a', 'b']\nfunction on(channel, cb) {\n  if (!ALLOWED.includes(channel)) throw new Error('blocked')\n  ipcRenderer.on(channel, cb)\n}\n" })).toBe(0)
  })
  test('an unchecked channel is still reported', () => {
    expect(count(EPK, 'ep-ipc-listen-channel-variable', { 'preload.js': 'function on(channel, cb) {\n  ipcRenderer.on(channel, cb)\n}\n' })).toBe(1)
  })
})

describe('rs-secret-logged', () => {
  test('a redaction count, a timing note and test code are not logging a secret', () => {
    expect(count(RS, 'rs-secret-logged', { 'src/lib.rs': 'fn f(n: usize) {\n    eprintln!("redacted {} secrets", n);\n}\n' })).toBe(0)
    expect(count(RS, 'rs-secret-logged', { 'src/lib.rs': 'fn f(ms: u64) {\n    eprintln!("first token in {} ms", ms);\n}\n' })).toBe(0)
    expect(count(RS, 'rs-secret-logged', { 'src/lib.rs': '#[test]\n#[ignore]\nfn measure() {\n    println!("token {}", token);\n}\n' })).toBe(0)
    expect(count(RS, 'rs-secret-logged', { 'src/lib.rs': '#[cfg(test)]\nmod tests {\n    fn t() {\n        println!("secret {}", secret);\n    }\n}\n' })).toBe(0)
  })
  test('a secret value in the arguments, or captured in the format string, is still reported', () => {
    expect(count(RS, 'rs-secret-logged', { 'src/lib.rs': 'fn f() {\n    println!("token {}", token);\n}\n' })).toBe(1)
    expect(count(RS, 'rs-secret-logged', { 'src/lib.rs': 'fn f() {\n    info!("login with {token}");\n}\n' })).toBe(1)
    expect(count(RS, 'rs-secret-logged', { 'src/lib.rs': 'fn f() {\n    debug!("auth", password = password);\n}\n' })).toBe(1)
  })
})

describe('rsafe-env-set-var', () => {
  test('set_var in a #[test] fn, or in a file its parent declares #[cfg(test)], is test code', () => {
    expect(count(SAFETY, 'rsafe-env-set-var', { 'src/lib.rs': '#[test]\n#[ignore]\nfn t() {\n    std::env::set_var("A", "b");\n}\n' })).toBe(0)
    expect(count(SAFETY, 'rsafe-env-set-var', { 'src/lib.rs': '#[cfg(test)]\nmod env_guard;\n', 'src/env_guard.rs': 'pub fn set() {\n    std::env::set_var("A", "b");\n}\n' })).toBe(0)
  })
  test('set_var in library code is still reported', () => {
    expect(count(SAFETY, 'rsafe-env-set-var', { 'src/lib.rs': 'pub fn init() {\n    std::env::set_var("A", "b");\n}\n' })).toBe(1)
    expect(count(SAFETY, 'rsafe-env-set-var', { 'src/lib.rs': 'mod env_guard;\n', 'src/env_guard.rs': 'pub fn set() {\n    std::env::set_var("A", "b");\n}\n' })).toBe(1)
  })
})

describe('rsafe-vec-set-len-no-capacity', () => {
  test('File::set_len and test code are not Vec::set_len', () => {
    expect(count(SAFETY, 'rsafe-vec-set-len-no-capacity', { 'src/lib.rs': 'fn grow(p: &Path) {\n    let f = std::fs::File::create(p).unwrap();\n    f.set_len(1024).unwrap();\n}\n' })).toBe(0)
    expect(count(SAFETY, 'rsafe-vec-set-len-no-capacity', { 'src/lib.rs': '#[cfg(test)]\nmod tests {\n    fn t(v: &mut Vec<u8>) {\n        unsafe { v.set_len(4) };\n    }\n}\n' })).toBe(0)
  })
  test('Vec::set_len in library code is still reported', () => {
    expect(count(SAFETY, 'rsafe-vec-set-len-no-capacity', { 'src/lib.rs': 'pub fn f(v: &mut Vec<u8>, n: usize) {\n    unsafe { v.set_len(n) };\n}\n' })).toBe(1)
  })
})

describe('rust-unwrap-overuse', () => {
  const many = (indent: string) => Array.from({ length: 45 }, (_, i) => `${indent}let v${i} = "1".parse::<u32>().unwrap();\n`).join('')
  test('unwraps inside a #[cfg(test)] module (with other attributes) or a test-only file are not counted', () => {
    expect(cli('lang.mjs', 'rust-unwrap-overuse', { 'src/lib.rs': `pub fn run() {}\n#[cfg(test)]\n#[allow(clippy::unwrap_used)]\nmod tests {\n    fn t() {\n${many('        ')}    }\n}\n` })).toBe(0)
    expect(cli('lang.mjs', 'rust-unwrap-overuse', { 'src/lib.rs': '#[cfg(test)]\npub(crate) mod fake;\n', 'src/fake.rs': `pub fn f() {\n${many('    ')}}\n` })).toBe(0)
  })
  test('unwraps in library code are still counted', () => {
    expect(cli('lang.mjs', 'rust-unwrap-overuse', { 'src/lib.rs': `pub fn run() {\n${many('    ')}}\n` })).toBe(1)
    expect(cli('lang.mjs', 'rust-unwrap-overuse', { 'src/lib.rs': 'pub mod fake;\n', 'src/fake.rs': `pub fn f() {\n${many('    ')}}\n` })).toBe(1)
  })
})

describe('js-prototype-pollution', () => {
  const merge = (guard: string) => `export function deepMerge(map, src) {\n  for (const key in src) {\n    const value = src[key]\n    ${guard}\n  }\n}\n`
  test('only a boolean (typeof-checked) value is assigned: nothing to pollute', () => {
    expect(cli('lang.mjs', 'js-prototype-pollution', { 'a.js': merge("if (typeof value === 'boolean') map[key] = value") })).toBe(0)
  })
  test('an unchecked or object value is still reported', () => {
    expect(cli('lang.mjs', 'js-prototype-pollution', { 'a.js': merge('map[key] = value') })).toBe(1)
    expect(cli('lang.mjs', 'js-prototype-pollution', { 'a.js': merge("if (typeof value === 'object') map[key] = value") })).toBe(1)
  })
  test('the same code in a test file is not shipped, but in a source file it is reported', () => {
    expect(cli('lang.mjs', 'js-prototype-pollution', { 'a.test.js': merge('map[key] = value') })).toBe(0)
    expect(cli('lang.mjs', 'js-prototype-pollution', { 'a.js': merge('map[key] = value') })).toBe(1)
  })
})

describe('docker-no-user', () => {
  test('a builder stage needs no USER when the final stage has one', () => {
    expect(count(DOCKER_RULES, 'docker-no-user', { Dockerfile: 'FROM node:20 AS build\nRUN npm ci\nFROM node:20\nUSER node\nCMD ["node", "a.js"]\n' })).toBe(0)
  })
  test('a final stage with no USER, or a single stage with none, is still reported', () => {
    expect(count(DOCKER_RULES, 'docker-no-user', { Dockerfile: 'FROM node:20 AS build\nUSER build\nFROM node:20\nCMD ["node", "a.js"]\n' })).toBe(1)
    expect(count(DOCKER_RULES, 'docker-no-user', { Dockerfile: 'FROM node:20\nCMD ["node", "a.js"]\n' })).toBe(1)
  })
})

describe('electron-updater-https', () => {
  const E = { 'package.json': '{"name":"a","main":"main.js","devDependencies":{"electron":"41.0.0"}}' }
  test('an Authenticode timestamp server over http is not an update feed', () => {
    expect(cli('desktop.mjs', 'electron-updater-https', { ...E, 'main.js': "const { autoUpdater } = require('electron-updater')\nconst TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com'\n" })).toBe(0)
  })
  test('an update feed over plain http is still reported', () => {
    expect(cli('desktop.mjs', 'electron-updater-https', { ...E, 'main.js': "const { autoUpdater } = require('electron-updater')\nautoUpdater.setFeedURL({ provider: 'generic', url: 'http://updates.example.com' })\n" })).toBe(1)
  })
})

describe('workflow-security', () => {
  const wf = (comment: string, on: string, extra = '') => ({ '.github/workflows/ci.yml': `name: ci\n${comment}on: ${on}\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n${extra}` })
  test('pull_request_target named only in a comment is not a trigger', () => {
    expect(cli('static.mjs', 'workflow-security', wf('# never use pull_request_target with github.head_ref here\n', 'push'))).toBe(0)
  })
  test('a real pull_request_target that checks out the pull request is still reported', () => {
    expect(cli('static.mjs', 'workflow-security', wf('', 'pull_request_target', "        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n"))).toBe(1)
  })
})

describe('git-history-secrets', () => {
  const repo = (file: string, line: string) => {
    const dir = tree({ [file]: `${line}\n` })
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' })
    g('init', '-q')
    g('add', '.')
    g('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'add')
    try {
      execFileSync(process.execPath, ['thorough/sec-supply.mjs', 'git-history-secrets', '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
      return 0
    } catch (e: any) {
      return e.status ?? -1
    }
  }
  const soft = 'api_key = "Zq8rT2vLm9XpW4kJ7bNc"'
  test('a changelog sentence is prose, not a secret', () => {
    expect(repo('CHANGELOG.md', `- Rotated the ${soft} format`)).toBe(0)
  })
  test('the same value in source, or a known key format in a changelog, is still reported', () => {
    expect(repo('config.js', `const ${soft}`)).toBe(1)
    expect(repo('CHANGELOG.md', '- leaked AKIAJ7QXN4MZ5R2WDLPB by mistake')).toBe(1)
  })
})

describe('robots-sitemap', () => {
  const page = '<!doctype html>\n<html><body>Hi</body></html>\n'
  test('the renderer shell of an Electron app in a sub folder is not a public site', () => {
    expect(cli('web-plus.mjs', 'robots-sitemap', { 'apps/desktop/package.json': '{"name":"d","devDependencies":{"electron":"41.0.0"}}', 'apps/desktop/index.html': page })).toBe(0)
  })
  test('a website with no robots.txt is still reported', () => {
    expect(cli('web-plus.mjs', 'robots-sitemap', { 'site/package.json': '{"name":"s","dependencies":{"vite":"5.0.0"}}', 'site/index.html': page })).toBe(1)
    expect(cli('web-plus.mjs', 'robots-sitemap', { 'site/index.html': page })).toBe(1)
  })
})

describe('pii-in-logs', () => {
  test('a word in a comment is not logged', () => {
    expect(cli('privacy.mjs', 'pii-in-logs', { 'src/app.js': "console.log('done') // token count\n" })).toBe(0)
    expect(cli('privacy.mjs', 'pii-in-logs', { 'src/app.js': '// console.log(userToken)\n' })).toBe(0)
  })
  test('a secret value in the call is still reported', () => {
    expect(cli('privacy.mjs', 'pii-in-logs', { 'src/app.js': 'console.log(userToken)\n' })).toBe(1)
    expect(cli('privacy.mjs', 'pii-in-logs', { 'src/app.js': 'console.log(userToken) // debug\n' })).toBe(1)
  })
})
