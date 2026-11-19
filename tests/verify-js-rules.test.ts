// Verify false positives from Neural Vault (docs/issues.md sections 11, 12 and 13): each rule is narrowed by scope, with a false-positive
// fixture that must be quiet and a real-case fixture that must still be found.
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

// Writes the files into a fresh git folder (tracked, staged), runs one check, and returns its exit code and output.
function scan(script: string, check: string, files: Record<string, string>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-vjr-'))
  made.push(dir)
  for (const [n, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, n)), { recursive: true })
    writeFileSync(join(dir, n), body)
  }
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'pipe' })
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' })
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}
// How many findings one sub-rule printed.
const hits = (out: string, rule: string) => out.split('\n').filter((l) => l.startsWith(`MEERKAT-FINDING `) && l.split(' ')[2] === rule).length

const PKG = { 'package.json': '{ "name": "app", "devDependencies": { "electron": "41.0.0" } }\n' }
const ep = (check: string, files: Record<string, string>) => scan('thorough/electron-plus.mjs', check, { ...PKG, ...files })

describe('1. ep-ipc-handler-no-sender-check and a wrapper that checks the sender', () => {
  const rule = 'ep-ipc-handler-no-sender-check'
  const wrapper = [
    "import { ipcMain } from 'electron'",
    "import { assertTrustedFrame } from './trust'",
    'export function handleTrusted(channel, fn) {',
    '  ipcMain.handle(channel, async (event, ...args) => {',
    '    assertTrustedFrame(event)',
    '    return fn(event, ...args)',
    '  })',
    '}',
    'export function onTrusted(channel, fn) {',
    '  ipcMain.on(channel, (event, ...args) => {',
    '    assertTrustedFrame(event)',
    '    fn(event, ...args)',
    '  })',
    '}',
    '',
  ].join('\n')
  test('a registration through the wrapper, and the wrapper itself, are quiet', () => {
    const r = ep('ep-ipc-preload', {
      'electron/trusted.cts': wrapper,
      'electron/ipc.cts': "import { handleTrusted, onTrusted } from './trusted'\nhandleTrusted('a:b', async () => 1)\nonTrusted('c:d', () => {})\n",
    })
    expect(hits(r.out, rule)).toBe(0)
  })
  test('a raw ipcMain.handle with no check is still found', () => {
    const r = ep('ep-ipc-preload', {
      'electron/trusted.cts': wrapper,
      'electron/ipc.cts': "import { ipcMain } from 'electron'\nipcMain.handle('raw', async () => 'pong')\n",
    })
    expect(hits(r.out, rule)).toBe(1)
  })
})

describe('2. ep-ipc-remove-all-listeners and a re-registration', () => {
  const rule = 'ep-ipc-remove-all-listeners'
  test('a removal followed by the same channel registered again is quiet', () => {
    const r = ep('ep-ipc-preload', {
      'electron/ipc.cts': "import { ipcMain } from 'electron'\nexport function registerLog() {\n  ipcMain.removeAllListeners('nv:log')\n  ipcMain.on('nv:log', (_e, m) => { void m })\n}\n",
    })
    expect(hits(r.out, rule)).toBe(0)
  })
  test('a bare removeAllListeners is still found', () => {
    const r = ep('ep-ipc-preload', { 'electron/ipc.cts': "import { ipcMain } from 'electron'\nexport function reset() {\n  ipcMain.removeAllListeners('save')\n}\n" })
    expect(hits(r.out, rule)).toBe(1)
  })
  test('a removal of one channel is not excused by re-registering another channel', () => {
    const r = ep('ep-ipc-preload', {
      'electron/ipc.cts': "import { ipcMain } from 'electron'\nexport function reset() {\n  ipcMain.removeAllListeners('save')\n  ipcMain.on('other', () => {})\n}\n",
    })
    expect(hits(r.out, rule)).toBe(1)
  })
})

describe('3. ep-permission-grant-all matches only a setPermissionRequestHandler call', () => {
  const rule = 'ep-permission-grant-all'
  const devServer = 'function devServerReachable() {\n  return new Promise((resolve) => {\n    probe((ok) => resolve(true))\n  })\n}\n'
  test('resolve(true) in another function of a file that sets a careful handler is quiet', () => {
    const r = ep('ep-window', {
      'electron/main.cts': `${devServer}ses.setPermissionRequestHandler((wc, permission, callback) => {\n  callback(permission === 'notifications')\n})\n`,
    })
    expect(hits(r.out, rule)).toBe(0)
  })
  test('a real handler that grants everything is still found', () => {
    const r = ep('ep-window', {
      'electron/main.cts': `${devServer}ses.setPermissionRequestHandler((wc, permission, callback) => {\n  log(permission)\n  callback(true)\n})\n`,
    })
    expect(hits(r.out, rule)).toBe(1)
  })
})

describe('4. electron-open-external looks at the enclosing function', () => {
  const open = (body: string) => scan('thorough/desktop.mjs', 'electron-open-external', { ...PKG, 'main.js': body })
  const filler = Array.from({ length: 14 }, (_, i) => `  const step${i} = ${i}`).join('\n')
  test('an allow check more than 10 lines above, in the same function, is quiet', () => {
    const r = open(`export function openLink(url) {\n  if (!ALLOWED_PROTOCOLS.includes(new URL(url).protocol)) return\n${filler}\n  shell.openExternal(url)\n}\n`)
    expect(r.code).toBe(0)
  })
  test('a consent dialog more than 10 lines above, in the same function, is quiet', () => {
    const r = open(`export async function openLink(url) {\n  const choice = await dialog.showMessageBox({ message: 'Open this link?' })\n  if (choice.response !== 0) return\n${filler}\n  shell.openExternal(url)\n}\n`)
    expect(r.code).toBe(0)
  })
  test('an unguarded open of a variable URL is still found', () => {
    const r = open(`export function openLink(url) {\n${filler}\n  shell.openExternal(url)\n}\n`)
    expect(r.code).toBe(1)
  })
  test('a guard in a different function does not count', () => {
    const r = open(`function check(url) {\n  return ALLOWED_PROTOCOLS.includes(new URL(url).protocol)\n}\n${filler}\nexport function openLink(url) {\n${filler}\n  shell.openExternal(url)\n}\n`)
    expect(r.code).toBe(1)
  })
})

describe('5. js-prototype-pollution and a copy from process.env', () => {
  const lang = (body: string) => scan('thorough/lang.mjs', 'js-prototype-pollution', { 'a.js': body })
  test('a copy of process.env string values into a fresh object is quiet', () => {
    const r = lang('export function copyEnv() {\n  const out = {}\n  for (const key of Object.keys(process.env)) {\n    const v = process.env[key]\n    if (typeof v === "string") out[key] = v\n  }\n  return out\n}\n')
    expect(r.code).toBe(0)
  })
  test('entries of process.env are quiet too', () => {
    const r = lang('export function copyEnv() {\n  const out = {}\n  for (const [k, v] of Object.entries(process.env)) {\n    out[k] = v\n  }\n  return out\n}\n')
    expect(r.code).toBe(0)
  })
  test('a copy of a parsed JSON body with no key check is still found', () => {
    const r = lang('export function merge(target, req) {\n  const body = JSON.parse(req.text)\n  for (const key of Object.keys(body)) {\n    target[key] = body[key]\n  }\n}\n')
    expect(r.code).toBe(1)
  })
})

describe('6. js-unhandled-promise and a function that catches inside, or an event registration', () => {
  const lang = (files: Record<string, string>) => scan('thorough/lang.mjs', 'js-unhandled-promise', files)
  test('a call to an async function with a typed signature that catches inside is quiet', () => {
    const r = lang({
      'a.ts': 'export async function startSidecar(): Promise<void> {\n  try {\n    await sidecar.start()\n  } catch (err) {\n    logError(String(err))\n  }\n}\n',
      'b.ts': "import { startSidecar } from './a'\nexport function boot() {\n  startSidecar()\n}\n",
    })
    expect(r.code).toBe(0)
  })
  test('a child.once exit registration is quiet even when the project has an async function of that name', () => {
    const r = lang({
      'a.ts': 'export async function once(x: number): Promise<void> {\n  await go(x)\n}\n',
      'b.ts': "export function watch(child: any) {\n  child.once('exit', () => {\n    cleanup()\n  })\n}\n",
    })
    expect(r.code).toBe(0)
  })
  test('an async call with no await and no catch is still found', () => {
    const r = lang({
      'a.ts': 'export async function save(id: string): Promise<void> {\n  await db.put(id)\n}\n',
      'b.ts': "import { save } from './a'\nexport function run() {\n  save('x')\n}\n",
    })
    expect(r.code).toBe(1)
  })
})

describe('7. pii-patterns-in-source and public service identities', () => {
  const pii = (body: string) => scan('thorough/privacy.mjs', 'pii-patterns-in-source', { 'src/a.ts': body })
  test("Google's public holiday calendar id is quiet", () => {
    expect(pii("export const HOLIDAYS = 'en.uk#holiday@group.v.calendar.google.com'\n").code).toBe(0)
  })
  test('a package registry identity is quiet', () => {
    expect(pii("export const REGISTRY_OWNER = 'support-bot@registry.npmjs.org'\n").code).toBe(0)
  })
  test('a personal email address is still found', () => {
    expect(pii("export const OWNER = 'jane.smith@gmail.com'\n").code).toBe(1)
  })
  test('a lookalike domain is still found', () => {
    expect(pii("export const OWNER = 'jane.smith@npmjs.org.evil.io'\n").code).toBe(1)
  })
})

describe('8. html-structure skips tests/fixtures/', () => {
  const bad = '<html><body><h1>a</h1><h1>b</h1></body></html>'
  test('a saved third-party page under tests/fixtures is quiet', () => {
    expect(scan('thorough/static.mjs', 'html-structure', { 'packages/core/tests/fixtures/saved.html': bad }).code).toBe(0)
  })
  test('the same html outside fixtures is still found', () => {
    expect(scan('thorough/static.mjs', 'html-structure', { 'packages/core/public/page.html': bad }).code).toBe(1)
  })
})

describe('9. dataset-license-note and provenance inside the data file', () => {
  const budgets = { '.meerkat-budgets.json': JSON.stringify({ data: { requireDatasetNotes: true } }) }
  const ds = (files: Record<string, string>) => scan('thorough/data-science.mjs', 'dataset-license-note', { ...budgets, ...files })
  test('a data file with a source, a checked date and a licence key is quiet', () => {
    const body = JSON.stringify({ source: 'https://example.org/list', checked: '2026-11-01', license: 'CC-BY-4.0', items: [1, 2, 3] })
    expect(ds({ 'data/list.json': body }).code).toBe(0)
  })
  test('a data file with none of them is still found', () => {
    expect(ds({ 'data/list.json': JSON.stringify({ items: [1, 2, 3] }) }).code).toBe(1)
  })
  test('one provenance file does not excuse a second data file without it', () => {
    const ok = JSON.stringify({ source: 'https://example.org/list', license: 'MIT', items: [] })
    expect(ds({ 'data/list.json': ok, 'data/other.json': JSON.stringify({ items: [1] }) }).code).toBe(1)
  })
})

describe('10. rasync-blocking-fs and a marked background job', () => {
  const rule = 'rasync-blocking-fs'
  const rp = (files: Record<string, string>) => scan('thorough/rust-plus.mjs', 'rp-async', { 'Cargo.toml': '[package]\nname = "x"\nversion = "0.1.0"\n', ...files })
  test('a file marked as a background job that runs once per tick is quiet', () => {
    const r = rp({ 'src/jobs/tick.rs': '// Background job, runs once per tick on its own thread, so a blocking read here is fine.\nasync fn load() -> String {\n    std::fs::read_to_string("a.txt").unwrap()\n}\n' })
    expect(hits(r.out, rule)).toBe(0)
  })
  test('a blocking read in a request handler is still found', () => {
    const r = rp({ 'src/handler.rs': 'async fn handle() -> String {\n    std::fs::read_to_string("a.txt").unwrap()\n}\n' })
    expect(hits(r.out, rule)).toBe(1)
  })
})

describe('11. ep-window and dev-only harness scripts', () => {
  const call = 'export function go(win, code) {\n  win.webContents.executeJavaScript(code)\n}\n'
  const rule = 'ep-execute-js-variable'
  test('verify-*.cts, shoot-*.cts and files under dev/ are quiet', () => {
    const r = ep('ep-window', { 'electron/verify-code-mode.cts': call, 'electron/shoot-home.cts': call, 'electron/dev/harness.cts': call })
    expect(hits(r.out, rule)).toBe(0)
  })
  test('the same call in a shipped file is still found', () => {
    const r = ep('ep-window', { 'electron/main.cts': call })
    expect(hits(r.out, rule)).toBe(1)
  })
  test('the same call in a file that only has verify in its folder name is still found', () => {
    const r = ep('ep-window', { 'electron/verify/main.cts': call })
    expect(hits(r.out, rule)).toBe(1)
  })
})
