// (e) An Electron app with nodeIntegration true. Electron is declared and locked but never installed.
import { baseline, json, readme } from './kit.mjs'

const pkg = json({ name: 'clip-desk', version: '1.0.0', private: true, license: 'MIT', main: 'main.js', engines: { node: '>=20' }, repository: { type: 'git', url: 'https://example.invalid/clip-desk.git' }, scripts: { start: 'electron .', test: 'node --test tests/' }, devDependencies: { electron: '33.2.0' } })
const lock = json({ name: 'clip-desk', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'clip-desk', version: '1.0.0', license: 'MIT', engines: { node: '>=20' }, devDependencies: { electron: '33.2.0' } }, 'node_modules/electron': { version: '33.2.0', resolved: 'https://registry.npmjs.org/electron/-/electron-33.2.0.tgz', integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', dev: true, license: 'MIT' } } })

const main = (webPrefs) => `const { app, BrowserWindow, shell, ipcMain, session } = require('electron')
const path = require('node:path')

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
${webPrefs}
    },
  })
  win.loadFile('index.html')
  win.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = ['https://example.invalid/']
    if (allowed.some((prefix) => url.startsWith(prefix))) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
}

ipcMain.handle('clip:read', (event, id) => {
  if (!event.senderFrame || !event.senderFrame.url.startsWith('file://')) throw new Error('untrusted sender')
  if (typeof id !== 'string' || id.length > 64) throw new Error('bad id')
  return { id }
})

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'"] } })
  })
  createWindow()
}).catch((err) => {
  console.error(err)
  app.exit(1)
})
`

const SAFE = "      nodeIntegration: false,\n      contextIsolation: true,\n      sandbox: true,\n      webSecurity: true,\n      preload: path.join(__dirname, 'preload.js'),"
const UNSAFE = "      nodeIntegration: true,\n      contextIsolation: true,\n      sandbox: true,\n      webSecurity: true,\n      preload: path.join(__dirname, 'preload.js'),"

const clean = {
  'package.json': pkg,
  'package-lock.json': lock,
  ...baseline({ test: 'npm test', ignore: 'node_modules/\ndist/\n' }),
  'README.md': readme('clip-desk', 'A small clipboard history desktop app.', 'npm ci', 'npm start', 'npm test'),
  'main.js': main(SAFE),
  'preload.js': `const { contextBridge, ipcRenderer } = require('electron')\n\ncontextBridge.exposeInMainWorld('clips', { read: (id) => ipcRenderer.invoke('clip:read', String(id)) })\n`,
  'index.html': '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />\n    <title>Clip Desk</title>\n  </head>\n  <body>\n    <main><h1>Clip Desk</h1></main>\n  </body>\n</html>\n',
  'tests/main.test.js': "import test from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('ids are short strings', () => {\n  assert.ok('abc'.length < 64)\n})\n",
}

const defective = { ...clean, 'main.js': main(UNSAFE) }

export default {
  name: 'clip-desk',
  clean,
  defective,
  defects: [{ check: 'electron-node-integration', file: 'main.js', severity: 'high' }],
}
