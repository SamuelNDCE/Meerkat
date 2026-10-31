// The Electron-and-desktop family (thorough/electron-plus.mjs, thorough/rules-electron-plus.mjs, packs/electron-plus):
// every rule proves itself on its own bad and good samples, every check fails on its own fixture, a clean Electron project
// passes for real, a non-Electron folder is NA, a hostile long line finishes quickly, the pack loads, and no file uses an em dash.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'
import { CHECK_TABLES } from './thorough/rules-electron-plus.mjs'
import { evaluate } from './thorough/rules.mjs'
import { selfProve } from './thorough/rules.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/electron-plus.mjs'
const IDS = Object.keys(CHECK_TABLES)

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function runCheck(args: string[], cwd = ROOT): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

function newFolder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-electronplus-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

// A small, realistic and secure Electron app: every rule's good form appears in a real file, and the build config sets fuses,
// signing, notarisation and asar. Used for the "passes for real" test.
const CLEAN = newFolder({
  'package.json': JSON.stringify({
    name: 'clean-notes',
    version: '1.0.0',
    main: 'main.js',
    scripts: { start: 'electron .', dist: 'electron-builder' },
    devDependencies: { electron: '41.0.0', 'electron-builder': '26.0.12' },
    build: {
      appId: 'com.acme.notes',
      productName: 'Notes',
      copyright: 'Copyright 2026 Acme',
      asar: true,
      forceCodeSigning: true,
      mac: { hardenedRuntime: true, notarize: true, entitlements: 'build/entitlements.mac.plist' },
      win: { certificateFile: '${env.WIN_CERT_FILE}', verifyUpdateCodeSignature: true },
      publish: { provider: 'generic', url: 'https://updates.acme.example.com' },
      electronFuses: {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        embeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
        grantFileProtocolExtraPrivileges: false,
      },
    },
  }, null, 2) + '\n',
  'main.js': [
    "const { app, BrowserWindow, ipcMain, shell, protocol } = require('electron')",
    "const path = require('node:path')",
    "const fs = require('node:fs')",
    "protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }])",
    'function createWindow() {',
    '  const win = new BrowserWindow({',
    "    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },",
    '  })',
    "  win.webContents.setWindowOpenHandler(({ url }) => {",
    "    if (url.startsWith('https://docs.acme.example.com/')) shell.openExternal(url)",
    "    return { action: 'deny' }",
    '  })',
    "  win.webContents.on('will-navigate', (event, url) => {",
    "    if (url !== 'app://local/index.html') event.preventDefault()",
    '  })',
    "  win.loadURL('app://local/index.html')",
    '}',
    "protocol.handle('app', (request) => {",
    "  const file = path.join(__dirname, 'renderer', 'index.html')",
    '  return new Response(fs.readFileSync(file))',
    '})',
    "ipcMain.handle('notes:list', (event) => {",
    '  if (!isTrustedFrame(event.senderFrame)) return []',
    '  return loadNotes()',
    '})',
    "app.on('open-url', (event, url) => {",
    '  const link = new URL(url)',
    "  if (link.protocol === 'acme-notes:') openDeepLink(link)",
    '})',
    "app.whenReady().then(createWindow)",
    '',
  ].join('\n'),
  'preload.js': [
    "const { contextBridge, ipcRenderer } = require('electron')",
    'contextBridge.exposeInMainWorld(\'notesApi\', {',
    "  list: () => ipcRenderer.invoke('notes:list'),",
    "  onSaved: (callback) => {",
    "    const listener = (_event, value) => callback(value)",
    "    ipcRenderer.on('notes:saved', listener)",
    "    return () => ipcRenderer.removeListener('notes:saved', listener)",
    '  },',
    '})',
    '',
  ].join('\n'),
  'renderer/index.html': [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:">',
    '  <link rel="stylesheet" href="./app.css">',
    '</head>',
    '<body>',
    '  <div id="app"></div>',
    '  <script src="./app.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n'),
  'build/entitlements.mac.plist': [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0"><dict>',
    '  <key>com.apple.security.cs.allow-jit</key>',
    '  <true/>',
    '  <key>com.apple.security.get-task-allow</key>',
    '  <false/>',
    '</dict></plist>',
    '',
  ].join('\n'),
})

describe('every rule proves itself on its own samples', () => {
  for (const id of IDS) {
    test(`${id} tables: bad sample found, good sample not found`, () => {
      expect(selfProve(CHECK_TABLES[id as keyof typeof CHECK_TABLES])).toEqual([])
    })
  }
  test('every rule id is unique across the family', () => {
    const all = IDS.flatMap((id) => CHECK_TABLES[id as keyof typeof CHECK_TABLES].map((r) => r.id))
    expect(new Set(all).size).toBe(all.length)
  })
  test('the family ships at least one rule per check (no minimum count is enforced)', () => {
    for (const id of IDS) expect(CHECK_TABLES[id as keyof typeof CHECK_TABLES].length).toBeGreaterThan(0)
  })
})

describe('each check fails on its own fixture', () => {
  for (const id of IDS) {
    test(`${id} --fixtures exits 1 and reports found`, () => {
      const r = runCheck([id, '--fixtures'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/found \d+/)
    })
  }
})

describe('a clean Electron project passes for real', () => {
  for (const id of ['ep-window', 'ep-ipc-preload', 'ep-fuses-build', 'ep-content-renderer']) {
    test(`${id} exits 0 and applies (PASS lines, no NA for the whole check)`, () => {
      const r = runCheck([id, '--root', CLEAN])
      expect(r.out).not.toMatch(/not an Electron project/)
      expect(r.out).toMatch(/MEERKAT-SUB PASS/)
      expect(r.code).toBe(0)
    })
  }
  test('ep-tauri-cross is clean on the Electron project (its rules are NA without Tauri files)', () => {
    const r = runCheck(['ep-tauri-cross', '--root', CLEAN])
    expect(r.code).toBe(0)
  })
})

describe('the Electron checks are NA on a folder that is not an Electron project', () => {
  for (const id of ['ep-window', 'ep-ipc-preload', 'ep-fuses-build', 'ep-content-renderer']) {
    test(`${id} says it does not apply on Meerkat itself`, () => {
      const r = runCheck([id])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/not an Electron project/)
    })
  }
})

describe('hostile input stays linear', () => {
  test('every rule scans a 100 KB single line in well under two seconds in total', () => {
    const hostile = 'a'.repeat(100_000) + ' ' + "'\"`".repeat(5000) + ' '.repeat(20000)
    const dir = newFolder({ 'big.js': hostile, 'big.html': hostile, 'big.json': hostile, 'package.json': hostile })
    const started = Date.now()
    for (const id of IDS) {
      evaluate(dir, CHECK_TABLES[id as keyof typeof CHECK_TABLES], { files: ['big.js', 'big.html', 'big.json', 'package.json'] })
    }
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('the electron-plus pack', () => {
  test('loads one check per table with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'electron-plus'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks.map((c) => c.id).sort()).toEqual([...IDS].sort())
  })
})

describe('no em dashes in the new files', () => {
  for (const f of ['thorough/rules-electron-plus.mjs', 'thorough/electron-plus.mjs', 'packs/electron-plus/electron-plus.mjs', 'electronplus.test.ts']) {
    test(f, () => {
      expect(readFileSync(join(ROOT, f), 'utf8')).not.toContain(String.fromCharCode(0x2014))
    })
  }
})
