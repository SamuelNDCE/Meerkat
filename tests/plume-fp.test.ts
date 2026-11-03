// False alarms found by a full scan of the Plume app, each fixed as a narrow rule: the safe shape stays quiet (or drops to info) and the unsafe look-alike is still
// reported. Checks: electron-devtools-prod, install-scripts, risky-code (innerHTML), js-unhandled-promise.
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

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-plumefp-'))
  made.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return dir
}
function run(script: string, check: string, files: Record<string, string>): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script, check, '--root', folder(files)], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('electron-devtools-prod: a user-invoked toggle is info, a forced open still fails', () => {
  const pkg = { 'package.json': '{ "name": "x", "devDependencies": { "electron": "^45.0.0" } }\n' }
  const dev = (src: string) => run('thorough/desktop.mjs', 'electron-devtools-prod', { ...pkg, 'main.js': `const { ipcMain } = require('electron')\n${src}` })
  test('ipc handler that toggles DevTools: passes, reported as info', () => {
    const r = dev("ipcMain.handle('app:devtools', () => win && win.webContents.toggleDevTools())\n")
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/MEERKAT-FINDING info electron-devtools-prod-deliberate main\.js:2/)
  })
  test('a toggle in a before-input-event key handler is info too', () => {
    const r = dev("win.webContents.on('before-input-event', (e, input) => {\n  if (input.key === 'F12') win.webContents.toggleDevTools()\n})\n")
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/MEERKAT-FINDING info/)
  })
  test('openDevTools called as the window is built still fails', () => {
    expect(dev('win.webContents.openDevTools()\n').code).toBe(1)
    expect(dev("ipcMain.handle('x', () => 1)\nwin.webContents.openDevTools()\n").code).toBe(1)
  })
  test('a toggle that is not inside a user handler still fails', () => {
    expect(dev('function start(win) {\n  win.webContents.toggleDevTools()\n}\n').code).toBe(1)
  })
})

describe('install-scripts: a dev-only lockfile package is info, a runtime one fails', () => {
  const lock = (extra: Record<string, unknown>) =>
    JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' }, 'node_modules/winstaller': { version: '5.4.0', hasInstallScript: true, ...extra } } })
  test('dev: true passes and is still reported as info', () => {
    const r = run('thorough/sec-supply.mjs', 'install-scripts', { 'package-lock.json': lock({ dev: true }) })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/MEERKAT-FINDING info install-script-dev package-lock\.json:0 winstaller 5\.4\.0/)
  })
  test('a runtime dependency (no dev flag) keeps failing', () => {
    const r = run('thorough/sec-supply.mjs', 'install-scripts', { 'package-lock.json': lock({}) })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/winstaller 5\.4\.0 runs an install script/)
  })
  test('a project own postinstall still fails', () => {
    expect(run('thorough/sec-supply.mjs', 'install-scripts', { 'package.json': JSON.stringify({ name: 'x', scripts: { postinstall: 'node setup.js' } }) }).code).toBe(1)
  })
})

describe('risky-code: innerHTML from a local builder that reads the code', () => {
  const risky = (src: string) => run('thorough/static.mjs', 'risky-code', { 'a.js': src }).code
  const paths = "const P = {\n  save: 'M1 1h2',\n  open: 'M2 2h3',\n}\n"
  const builder = (inner: string) => `${paths}const iconSvg = (name) =>\n  \`<svg viewBox="0 0 24 24"><path d="${inner}"/></svg>\`\n`
  test('a template of table lookups is author-written markup', () => {
    expect(risky(`${builder('${P[name]}')}function icon(name) {\n  const s = document.createElement('span')\n  s.innerHTML = iconSvg(name)\n  return s\n}\n`)).toBe(0)
  })
  test('a choice between two literals made by comparing the name is fine too', () => {
    const src = "const P = { a: 'M1' }\nconst iconSvg = (name) => `<svg${name === 'a' ? ' fill=\"none\"' : ''}><path d=\"${P[name]}\"/></svg>`\nel.innerHTML = iconSvg(kind)\n"
    expect(risky(src)).toBe(0)
  })
  test('a template that puts the raw argument in is still reported', () => {
    expect(risky(`${paths}const iconSvg = (name) => \`<svg><title>\${name}</title></svg>\`\nel.innerHTML = iconSvg(userName)\n`)).toBe(1)
  })
  test('a lookup in a table that is not a plain string table is still reported', () => {
    expect(risky("const P = { a: userText() }\nconst iconSvg = (name) => `<svg>${P[name]}</svg>`\nel.innerHTML = iconSvg(k)\n")).toBe(1)
  })
  test('a builder that is not declared in the file is still reported', () => {
    expect(risky('el.innerHTML = iconSvg(name)\n')).toBe(1)
  })
})

describe('risky-code: innerHTML from a renderer that escapes with a local escaper is always reported', () => {
  const risky = (src: string) => run('thorough/static.mjs', 'risky-code', { 'a.js': src }).code
  const esc = "const esc = (s) => String(s).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[c])\n"
  test('even the careful shapes are reported: reading JavaScript with patterns kept finding bypasses', () => {
    expect(risky(`${esc}function inline(s) {\n  return '<b>' + esc(s) + '</b>'\n}\nfunction renderMd(md) {\n  return inline(md)\n}\nstage.innerHTML = renderMd(slide)\n`)).toBe(1)
    expect(risky(`${esc}function renderMd(md) {\n  return '<p>' + esc(md) + '</p>'\n}\nstage.innerHTML = renderMd(slide)\n`)).toBe(1)
    expect(risky(`${esc}function renderMd(md) {\n  return '<p>' + esc(md) + '</p>'\n}\nel.innerHTML = renderMd(slide)\n`)).toBe(1)
  })
  test('the unsafe look-alikes are reported too', () => {
    expect(risky(`${esc}function renderMd(md) {\n  return '<p>' + md + '</p>'\n}\nstage.innerHTML = renderMd(slide)\n`)).toBe(1)
    expect(risky("function renderMd(md) {\n  return '<p>' + md + '</p>'\n}\nstage.innerHTML = renderMd(slide)\n")).toBe(1)
    expect(risky(`${esc}function renderMd(md) {\n  const t = esc(title)\n  return '<p>' + t + md + '</p>'\n}\nstage.innerHTML = renderMd(slide)\n`)).toBe(1)
  })
})

describe('js-unhandled-promise: handled async calls and chains', () => {
  const lang = (files: Record<string, string>) => run('thorough/lang.mjs', 'js-unhandled-promise', files).code
  test('an async function whose every await is inside a try/catch cannot reject', () => {
    expect(lang({ 'a.js': 'async function load() {\n  try {\n    const r = await fetchIt()\n    use(r)\n  } catch {}\n}\nload()\n' })).toBe(0)
  })
  test('an await outside the try keeps the call reported', () => {
    expect(lang({ 'a.js': 'async function load() {\n  const r = await fetchIt()\n  try {\n    await use(r)\n  } catch {}\n}\nload()\n' })).toBe(1)
  })
  test('a catch that throws again keeps the call reported', () => {
    expect(lang({ 'a.js': 'async function load() {\n  try {\n    await fetchIt()\n  } catch (e) {\n    throw e\n  }\n}\nload()\n' })).toBe(1)
  })
  test('an async function with no try at all is still reported', () => {
    expect(lang({ 'a.js': 'const refresh = async () => {\n  state.tree = await api.tree()\n}\nrefresh()\n' })).toBe(1)
  })
  test('then on a promise that was built with .catch is handled', () => {
    expect(lang({ 'a.js': 'const known = api.check ? api.check().catch(() => false) : Promise.resolve(false)\nknown.then((ok) => {\n  mark(ok)\n})\n' })).toBe(0)
  })
  test('then on a promise built without .catch is still reported', () => {
    expect(lang({ 'a.js': 'const known = api.check()\nknown.then((ok) => {\n  mark(ok)\n})\n' })).toBe(1)
  })
})
