// The desktop checks (thorough/desktop.mjs): each check must fail on its own fixture with a "found N" line, pass on a clean
// Electron, Tauri and Android folder (for real, not vacuously), pass vacuously on Meerkat's own repo, honour the allow file,
// and the desktop pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/desktop.mjs'
const ALL = [
  'electron-node-integration',
  'electron-context-isolation',
  'electron-web-security',
  'electron-remote-module',
  'electron-open-external',
  'electron-csp-header',
  'electron-ipc-validation',
  'electron-preload-exposure',
  'electron-navigation-guards',
  'electron-updater-https',
  'electron-devtools-prod',
  'tauri-allowlist',
  'capacitor-cordova-cleartext',
  'android-manifest-flags',
]

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code and output (0 clean, 1 findings, anything else is a crash).
function runCheck(args: string[], cwd = ROOT): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

function newFolder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-desktop-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

// One small app with the safe setting in every shape the checks look at: an Electron app, a Tauri config and an Android manifest.
const CLEAN = newFolder({
  'package.json': '{\n  "name": "clean",\n  "version": "1.0.0",\n  "devDependencies": { "electron": "^45.0.0" }\n}\n',
  'main.js': [
    "const { app, BrowserWindow, ipcMain, shell } = require('electron')",
    "const fs = require('node:fs')",
    "const allowed = new Set(['https:', 'mailto:'])",
    'const need = (p) => {',
    "  if (!p.startsWith('/safe')) throw new Error('denied')",
    '  return p',
    '}',
    'const openSafe = (url) => {',
    '  if (allowed.has(new URL(url).protocol)) shell.openExternal(url)',
    '}',
    "ipcMain.handle('read', async (_e, p) => fs.readFileSync(need(p), 'utf8'))",
    'function createWindow() {',
    "  const win = new BrowserWindow({ webPreferences: { preload: 'preload.js', contextIsolation: true, nodeIntegration: false, sandbox: true } })",
    '  win.webContents.setWindowOpenHandler(({ url }) => {',
    '    openSafe(url)',
    "    return { action: 'deny' }",
    '  })',
    "  win.webContents.on('will-navigate', (e, url) => {",
    "    if (url !== 'app://local') e.preventDefault()",
    '  })',
    '  win.webContents.session.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: { ...d.responseHeaders, \'Content-Security-Policy\': ["default-src \'self\'"] } }))',
    "  win.loadFile('index.html')",
    '}',
    'app.whenReady().then(createWindow)',
    '',
  ].join('\n'),
  'preload.js': [
    "const { contextBridge, ipcRenderer } = require('electron')",
    "contextBridge.exposeInMainWorld('api', { read: (p) => ipcRenderer.invoke('read', p) })",
    '',
  ].join('\n'),
  'index.html': '<!doctype html>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">\n',
  'src-tauri/tauri.conf.json': '{\n  "tauri": {\n    "allowlist": {\n      "all": false,\n      "shell": { "open": false },\n      "fs": { "scope": ["$APPDATA/*"] }\n    }\n  }\n}\n',
  'capacitor.config.ts': "const config = { appId: 'app.clean', appName: 'clean', webDir: 'dist', server: { cleartext: false } }\nexport default config\n",
  'app/src/main/AndroidManifest.xml': '<manifest>\n  <application android:allowBackup="false" android:debuggable="false">\n  </application>\n</manifest>\n',
})

describe('desktop checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem with a found line`, () => {
      const r = runCheck([check, '--fixtures'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/found \d+/)
    })
  }
})

describe('desktop checks pass on a clean desktop app, for real', () => {
  for (const check of ALL) {
    test(`${check} is clean and actually applies`, () => {
      const r = runCheck([check, '--root', CLEAN])
      expect(r.code).toBe(0)
      expect(r.out).not.toMatch(/: not (an?|a) /)
    })
  }
})

describe('desktop checks pass vacuously on Meerkat itself, which is not a desktop app', () => {
  for (const check of ALL) {
    test(`${check} says it does not apply`, () => {
      const r = runCheck([check])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/: not (an?|a) /)
    })
  }
})

describe('the desktop allow file', () => {
  test('an accepted finding passes when it is listed as "<id> <path>:<line>"', () => {
    const dir = newFolder({
      'package.json': '{ "devDependencies": { "electron": "^45.0.0" } }\n',
      'main.js': "new BrowserWindow({ webPreferences: { nodeIntegration: true } })\n",
      '.meerkat-desktop-allow': '# accepted for a demo\nelectron-node-integration main.js:1\n',
    })
    expect(runCheck(['electron-node-integration', '--root', dir]).code).toBe(0)
  })
})

describe('the desktop pack', () => {
  test('loads 14 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'desktop'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(14)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
