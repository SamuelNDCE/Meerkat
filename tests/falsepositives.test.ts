// Regression tests from the Plume full run (2026-10-31): false positives that were fixed, and false negatives that must stay detected.
// Every case builds a small folder of its own (never a real project) and runs the check script on it.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { applicablePacks, GENERIC_PACKS } from '../lib/init.mjs'
import { idleKillSecondsFor } from '../lib/timeouts.mjs'
import { tool } from '../lib/tool-check.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fp-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  return dir
}

// Runs `node <script> <check> --root <dir>` and returns the exit code and the output.
function run(script: string, check: string, dir: string, attempt = 0): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    // Windows reports 0xC0000142 when a process cannot start because the machine is out of resources (many runs at once): try again.
    if (e.status === 3221225794 && attempt < 3) return run(script, check, dir, attempt + 1)
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

describe('risky-code', () => {
  test('an innerHTML assigned a plain string is not reported, one assigned a variable is', () => {
    const dir = folder({ 'a.js': "el.innerHTML = ''\nel.innerHTML = '<svg viewBox=\"0 0 1 1\"></svg>'\n" })
    expect(run('thorough/static.mjs', 'risky-code', dir).code).toBe(0)
    const bad = folder({ 'a.js': "el.innerHTML = ''\nel.innerHTML = icon\n" })
    const r = run('thorough/static.mjs', 'risky-code', bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('a.js:2')
  })
  test('every hit in a file is reported, not only the first', () => {
    const dir = folder({ 'a.js': 'a.innerHTML = x\nb.innerHTML = y\nc.innerHTML = z\n' })
    const r = run('thorough/static.mjs', 'risky-code', dir)
    expect(r.out).toContain('a.js:1')
    expect(r.out).toContain('a.js:2')
    expect(r.out).toContain('a.js:3')
  })
  test('an interpolated template string is still reported', () => {
    const dir = folder({ 'a.js': 'el.innerHTML = `<b>${name}</b>`\n' })
    expect(run('thorough/static.mjs', 'risky-code', dir).code).toBe(1)
  })
})

describe('env-example', () => {
  test('variables the runtime or packager sets are not reported, a made-up one still is', () => {
    const ok = folder({ 'main.js': 'const a = process.env.APPIMAGE, b = process.env.PORTABLE_EXECUTABLE_FILE, c = process.env.ELECTRON_RUN_AS_NODE, d = process.env.npm_package_version\n' })
    expect(run('thorough/static.mjs', 'env-example', ok).code).toBe(0)
    const bad = folder({ 'main.js': 'const a = process.env.MY_SECRET_THING\n' })
    expect(run('thorough/static.mjs', 'env-example', bad).code).toBe(1)
  })
})

describe('package checks', () => {
  test('package-fields no longer repeats the engines finding that node-engines owns', () => {
    const dir = folder({ 'package.json': JSON.stringify({ name: 'x', version: '1.0.0', license: 'MIT', description: 'd', repository: 'r' }) })
    expect(run('thorough/repo-files.mjs', 'package-fields', dir).code).toBe(0)
    expect(run('thorough/config.mjs', 'node-engines', dir).code).toBe(1)
  })
  test('an Electron app is not a publishable npm package, a plain library still is', () => {
    const app = folder({ 'package.json': JSON.stringify({ name: 'x', version: '1.0.0', main: 'main.cjs', devDependencies: { 'electron-builder': '1.0.0' } }), 'main.cjs': '' })
    expect(run('thorough/packaging.mjs', 'npm-publish-files', app).code).toBe(0)
    const lib = folder({ 'package.json': JSON.stringify({ name: 'x', version: '1.0.0', main: 'index.js' }), 'index.js': '' })
    expect(run('thorough/packaging.mjs', 'npm-publish-files', lib).code).toBe(1)
  })
})

describe('install-scripts', () => {
  const lock = (extra: object) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/thing': { version: '1.0.0', hasInstallScript: true, ...extra } } })
  test('a macOS-only optional dependency (fsevents) is skipped, a required one is reported', () => {
    expect(run('thorough/sec-supply.mjs', 'install-scripts', folder({ 'package-lock.json': lock({ optional: true, os: ['darwin'] }) })).code).toBe(0)
    expect(run('thorough/sec-supply.mjs', 'install-scripts', folder({ 'package-lock.json': lock({}) })).code).toBe(1)
    expect(run('thorough/sec-supply.mjs', 'install-scripts', folder({ 'package-lock.json': lock({ optional: true }) })).code).toBe(1)
  })
})

describe('css', () => {
  test('!important inside print and reduced-motion blocks is not counted, the same amount elsewhere is', () => {
    const many = Array.from({ length: 25 }, (_, i) => `.a${i} { color: red !important }`).join('\n')
    const quiet = folder({ 'a.css': `@media print {\n${many}\n}\n@media (prefers-reduced-motion: reduce) {\n${many}\n}\n` })
    expect(run('thorough/web-plus.mjs', 'css-important-overuse', quiet).code).toBe(0)
    const loud = folder({ 'a.css': `${many}\n` })
    expect(run('thorough/web-plus.mjs', 'css-important-overuse', loud).code).toBe(1)
  })
  test('focus-visible accepts a ring drawn by a parent :has() rule or a separate rule, and still catches a bare outline:none', () => {
    const parent = folder({ 'a.css': '.row:has(.btn:focus-visible) { outline: 2px solid blue }\n.btn:focus-visible { outline: none }\n' })
    expect(run('thorough/a11y.mjs', 'focus-visible', parent).code).toBe(0)
    const sep = folder({ 'a.css': '.btn:focus { outline: none }\n.btn:focus-visible { outline: 2px solid blue }\n' })
    expect(run('thorough/a11y.mjs', 'focus-visible', sep).code).toBe(0)
    const bare = folder({ 'a.css': '.btn:focus { outline: none }\n' })
    expect(run('thorough/a11y.mjs', 'focus-visible', bare).code).toBe(1)
  })
})

describe('readme-install-usage', () => {
  test('a "Keyboard shortcuts" or "Commands" heading counts as a usage section, a README with neither does not', () => {
    const body = 'x'.repeat(250)
    expect(run('thorough/content.mjs', 'readme-install-usage', folder({ 'README.md': `# T\n\n${body}\n\n## Install\n\nnpm i\n\n## Keyboard shortcuts\n\nCtrl+S\n` })).code).toBe(0)
    expect(run('thorough/content.mjs', 'readme-install-usage', folder({ 'README.md': `# T\n\n${body}\n\n## Install\n\nnpm i\n\n## Licence\n\nMIT\n` })).code).toBe(1)
  })
})

describe('unused-files', () => {
  test('files loaded through new URL, new Worker, an optional() loader or named in a README are used; a real orphan is not', () => {
    const dir = folder({
      'src/main.js': "const w = new Worker(new URL('./w.js', import.meta.url))\nconst t = optional('./t.cjs')\n",
      'src/w.js': 'export const w = 1\n',
      'src/t.cjs': 'module.exports = 1\n',
      'tools/server.mjs': 'export const s = 1\n',
      'README.md': 'Run `node tools/server.mjs` to start it.\n',
      'src/orphan.js': 'export const o = 1\n',
    })
    const r = run('thorough/refactor.mjs', 'unused-files', dir)
    expect(r.out).toContain('src/orphan.js')
    expect(r.out).not.toContain('src/w.js')
    expect(r.out).not.toContain('src/t.cjs')
    expect(r.out).not.toContain('tools/server.mjs')
  })
})

describe('packs and not applicable', () => {
  test('an Electron project and a Rust project get their own packs under full without any config', () => {
    const has = (names: string[]) => (p: string) => names.some((n) => p.endsWith(n))
    const electron = applicablePacks('/x', has(['package.json']), () => [])
    for (const p of ['desktop', 'electron-plus', 'web-hardening', 'code-patterns', 'secrets-plus', 'ci-systems', 'infra-plus', 'privacy', 'rust-plus', 'data-science']) expect(electron).toContain(p)
    const rust = applicablePacks('/x', has(['Cargo.toml']), () => [])
    for (const p of ['rust', 'rust-plus']) expect(rust).toContain(p)
    for (const g of GENERIC_PACKS) expect(electron).toContain(g)
  })
  test('shellcheck and hadolint say not applicable (a pass) when the folder has no shell scripts or Dockerfiles', () => {
    expect(tool({ id: 'shellcheck', bin: 'shellcheck', onFiles: 'x', fixture: ['x'], install: 'i', title: 't' }).appliesTo).toEqual(['**/*.sh', '**/*.bash'])
    expect(tool({ id: 'hadolint', bin: 'hadolint', onFiles: 'x', fixture: ['x'], install: 'i', title: 't' }).appliesTo).toContain('**/Dockerfile')
    expect(tool({ id: 'other', bin: 'other', fixture: ['x'], install: 'i', title: 't' }).appliesTo).toBeUndefined()
  })
})

describe('second Plume run (2026-11-01)', () => {
  test('risky-code: innerHTML = ICON.close (an ALL_CAPS constant) is not reported, a variable or a computed key is', () => {
    const ok = folder({ 'a.js': "btn.innerHTML = ICON.close\nbtn.innerHTML = ICONS['x']\n" })
    expect(run('thorough/static.mjs', 'risky-code', ok).code).toBe(0)
    const bad = folder({ 'a.js': 'btn.innerHTML = icon.close\nbtn.innerHTML = ICONS[name]\n' })
    const r = run('thorough/static.mjs', 'risky-code', bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('a.js:1')
    expect(r.out).toContain('a.js:2')
  })
  test('debug-leftovers: a console.log behind process.env or DEBUG is allowed, a bare one is not', () => {
    const ok = folder({ 'src/a.js': "if (QA && process.env.APP_LOG) console.log('x')\nDEBUG && console.log('y')\n" })
    expect(run('thorough/quality.mjs', 'debug-leftovers', ok).code).toBe(0)
    const bad = folder({ 'src/a.js': "console.log('x', process.env.HOME)\n" })
    expect(run('thorough/quality.mjs', 'debug-leftovers', bad).code).toBe(1)
  })
  test('regex-in-loop and dom-query-in-loop ignore test files but still report source files', () => {
    const body = "for (const x of xs) {\n  new RegExp(x)\n  document.querySelector('.row')\n}\n"
    const ok = folder({ 'tests/a.cjs': body })
    expect(run('thorough/health.mjs', 'regex-in-loop', ok).code).toBe(0)
    expect(run('thorough/health.mjs', 'dom-query-in-loop', ok).code).toBe(0)
    const bad = folder({ 'src/a.js': body })
    expect(run('thorough/health.mjs', 'regex-in-loop', bad).code).toBe(1)
    expect(run('thorough/health.mjs', 'dom-query-in-loop', bad).code).toBe(1)
  })
  test('dom-query-in-loop: a lookup keyed by the loop variable differs on every pass and is not reported', () => {
    const dir = folder({ 'src/a.js': 'for (const [k, id] of Object.entries(IDS)) {\n  const n = document.getElementById(id)\n}\n' })
    expect(run('thorough/health.mjs', 'dom-query-in-loop', dir).code).toBe(0)
  })
  test('debug-leftovers: a console.log inside a block guarded by process.env is allowed', () => {
    const ok = folder({ 'src/a.js': "if (QA && process.env.APP_SMOKE) {\n  run()\n  console.log('RESULTS')\n}\n" })
    expect(run('thorough/quality.mjs', 'debug-leftovers', ok).code).toBe(0)
    const bad = folder({ 'src/a.js': "if (ready) {\n  console.log('RESULTS')\n}\n" })
    expect(run('thorough/quality.mjs', 'debug-leftovers', bad).code).toBe(1)
  })
  test('geolocation-and-media-requests: a clipboard read in a function called from a key handler is allowed, a load-time one is not', () => {
    const lead = Array.from({ length: 12 }, (_, i) => `// filler ${i}`).join('\n')
    const ok = folder({
      'src/a.js': `async function pasteIt() {\n  const t = await navigator.clipboard.readText()\n  use(t)\n}\n${lead}\nwindow.addEventListener('keydown', (e) => {\n  if (e.ctrlKey) pasteIt()\n})\n`,
    })
    expect(run('thorough/privacy.mjs', 'geolocation-and-media-requests', ok).code).toBe(0)
    const bad = folder({ 'src/a.js': `async function pasteIt() {\n  const t = await navigator.clipboard.readText()\n}\n${lead}\npasteIt()\n` })
    expect(run('thorough/privacy.mjs', 'geolocation-and-media-requests', bad).code).toBe(1)
  })
  test('meta-seo: the window page of an Electron app is not checked, a site page in docs/ of the same repository still is', () => {
    const pkg = JSON.stringify({ name: 'x', version: '1.0.0', main: 'electron/main.cjs', devDependencies: { electron: '41.0.0' } })
    const app = folder({ 'package.json': pkg, 'index.html': '<html><head><title>Plume</title></head><body></body></html>' })
    expect(run('thorough/static.mjs', 'meta-seo', app).code).toBe(0)
    const site = folder({ 'package.json': pkg, 'docs/index.html': '<html><head><title>Plume</title></head><body></body></html>' })
    expect(run('thorough/static.mjs', 'meta-seo', site).code).toBe(1)
    const web = folder({ 'index.html': '<html><head><title>A page title here</title></head><body></body></html>' })
    expect(run('thorough/static.mjs', 'meta-seo', web).code).toBe(1)
  })
  test('a discovered script that is silent for its whole run gets an idle limit of twice its estimate', () => {
    const c = { id: 'found-tests-x', lane: 'windows', estSeconds: 150, timeoutSeconds: 900 }
    expect(idleKillSecondsFor(c)).toBe(300)
    expect(idleKillSecondsFor({ ...c, estSeconds: 20 })).toBe(180)
    expect(idleKillSecondsFor({ ...c, timeoutSeconds: 240 })).toBe(240)
    expect(idleKillSecondsFor({ ...c, estSeconds: 150 }, { idleKill: { 'found-tests-x': 45 } })).toBe(45)
  })
})

describe('false negatives stay detected', () => {
  test('DevTools toggled with no dev gate, and IPC handlers with no sender check, are both reported', () => {
    const dir = folder({
      'package.json': JSON.stringify({ name: 'x', version: '1.0.0', devDependencies: { electron: '41.0.0' } }),
      'electron/main.cjs': "const { ipcMain } = require('electron')\nipcMain.handle('app:devtools', () => win && win.webContents.toggleDevTools())\nipcMain.handle('file:read', async (_e, p) => fs.readFileSync(p))\n",
    })
    expect(run('thorough/desktop.mjs', 'electron-devtools-prod', dir).code).toBe(1)
    const ipc = run('thorough/electron-plus.mjs', 'ep-ipc-preload', dir)
    expect(ipc.out).toMatch(/FAIL ep-ipc-handler-no-sender-check/)
  })
})
