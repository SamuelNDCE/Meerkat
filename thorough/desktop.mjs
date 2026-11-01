// Desktop shell checks: Electron, Tauri, Capacitor, Cordova and Android manifests. They read the code and config as plain text,
// so no tool has to be installed. A check passes with "not an Electron app" (or similar) when the repo does not use that framework.
// Run through the desktop pack, or by hand:
//   node thorough/desktop.mjs <check> [--root <dir>]      node thorough/desktop.mjs <check> --fixtures   (must exit 1)
// A finding you accept goes in .meerkat-desktop-allow as "<check-id> <path>" (the whole file) or "<check-id> <path>:<line>", one per line, # for comments.
import { finish, isTestFile, main, readText, trackedFiles, withFixture } from './kit.mjs'

const CODE = /\.(m?[jt]sx?|cjs|cts|mts)$/i
const PAGE = /\.(m?[jt]sx?|cjs|cts|mts|html?)$/i
const UPDATE_FILES = /\.(m?[jt]sx?|cjs|cts|mts|json|ya?ml)$/i
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?|out|release|coverage|docs?|examples?|tests?|__tests__)\/|\.min\.(m?js|css)$|\.(test|spec)\.[a-z]+$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|^thorough\/desktop\.mjs$/i
const COMMENT = /^\s*(\/\/|\/\*|\*|<!--|#)/
// Detection must over-match, not under-match (a missed Electron app would make every Electron rule pass vacuously): any import or require of
// electron counts, in any form (multi-line imports, destructuring, re-exports), except a mention that sits inside a string on the same line.
const ELECTRON_IMPORT = /require\(\s*['"]electron['"]\s*\)|\bfrom\s+['"]electron['"]|\bimport\s*\(\s*['"]electron['"]|\bimport\s+['"]electron['"]/g
const mentionsElectronImport = (text) => {
  for (const m of text.matchAll(ELECTRON_IMPORT)) {
    const before = text.slice(text.lastIndexOf('\n', m.index) + 1, m.index)
    if ((before.match(/['"`]/g) ?? []).length % 2 === 0) return true
  }
  return false
}
const ALLOW_WORDS = /allow|whitelist|allowlist|\.includes\(|\.has\(|protocol|isSafe|isAllowed/i
const DEV_GATE = /isDev|isDevelopment|isPackaged|NODE_ENV|development|VITE_DEV|DEV_URL|\bQA\b|__DEV__|import\.meta\.env\.DEV/i
const IPC_GUARD = /assert|grant|allow|whitelist|valid|sanitiz|normaliz|isOwnPage|safe|check|ensure|need\(|isAbsolute/i
const IPC_HANDLER = /ipcMain\.(?:handle|on)\s*\(\s*[^,\n]+,\s*(?:async\s*)?(?:function\s*\w*\s*)?\(\s*\w+\s*,\s*(\w+)/g
const BARE_EXPOSED = /\bipcRenderer\b(?!\s*\.\s*(?:invoke|send|on|once|removeListener|removeAllListeners|sendSync|sendTo|sendToHost)\b)|(?<=[:,{]\s*)\brequire\b|(?<=[:,{]\s*)\bprocess\b(?!\s*\.\s*(?:platform|arch|versions?)\b)|\.\.\.\s*(?:require|process)\b|\brequire\s*\(\s*(?:['"`](?:node:)?(?:child_process|fs|fs\/promises|os|net|http|https|vm|worker_threads|cluster|dgram|tls)['"`]|[^'"`\s)])|\bprocess\s*\.\s*(?:env|exit|kill|binding|mainModule|dlopen|abort|chdir|execPath)\b/
// require and process only count where they are handed over as a value (`fs: require('fs')`, `{ process }`). Calling require inside an
// exposed function (`pathForFile: (f) => require('electron').webUtils.getPathForFile(f)`) exposes nothing.
// The identifier p is the path or command (the first argument) of a file, shell or child process call inside the same handler.
// Later arguments (the data written to a file, for example) do not count.
const sinkFor = (p) => new RegExp(`\\b(?:fs|fsp|promises|child_process)\\.\\w+\\s*\\([^,\\n]*\\b${p}\\b|\\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\\s*\\([^,\\n]*\\b${p}\\b|\\bshell\\.\\w+\\s*\\([^,\\n]*\\b${p}\\b`)

const allowSet = (root) => new Set(readText(root, '.meerkat-desktop-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const allowed = (allow, id, x, line) => allow.has(`${id} ${x}`) || allow.has(`${id} ${x}:${line}`)
const tracked = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !isTestFile(x))
const lineOf = (t, i) => t.slice(0, i).split('\n').length
// True when the file defines name as a plain string constant (no interpolation), so a call that passes it is passing a fixed value.
const constString = (t, name) => new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(['"\`])[^'"\`$\\\\]*\\1`).test(t)
const lineText = (t, i) => t.slice(t.lastIndexOf('\n', i - 1) + 1, t.indexOf('\n', i) < 0 ? t.length : t.indexOf('\n', i))
// Lines (not comment-only) where re matches. re must not carry the g flag.
const lineHits = (t, re) => t.split('\n').flatMap((text, i) => (!COMMENT.test(text) && re.test(text) ? [{ line: i + 1 }] : []))
// A scan that works on one file at a time: fn(text) returns [{ line, why }].
const perFile = (fn) => (texts) => texts.flatMap(({ x, t }) => fn(t).map((r) => ({ x, ...r })))
// Every line matching re gets the same message.
const lines = (re, why) => perFile((t) => lineHits(t, re).map((h) => ({ line: h.line, why })))
const both = (...fns) => (texts) => fns.flatMap((f) => f(texts))
// The text from the opening bracket at open to its close (or max characters if it never closes).
const block = (t, open, max = 2000) => {
  let depth = 0
  for (let i = open; i < Math.min(t.length, open + max); i++) {
    if (t[i] === '(' || t[i] === '{') depth++
    else if ((t[i] === ')' || t[i] === '}') && --depth === 0) return t.slice(open, i + 1)
  }
  return t.slice(open, open + max)
}

const electronApp = (root) => {
  for (const x of tracked(root, /(^|\/)package\.json$/i)) {
    try {
      const j = JSON.parse(readText(root, x))
      if (j.dependencies?.electron || j.devDependencies?.electron || j.peerDependencies?.electron || j.optionalDependencies?.electron) return true
    } catch {
      // not a readable manifest: skip it
    }
  }
  // Source that only MENTIONS electron (sample projects, tests, docs) does not make the repo an Electron app.
  const sample = /(^|\/)(tools|tests?|__tests__|fixtures?|docs|examples?)\/|\.(test|spec)\.[a-z]+$/i
  return tracked(root, CODE).some((x) => !sample.test(x) && mentionsElectronImport(readText(root, x)))
}

const APPS = {
  electron: { note: 'an Electron app', has: electronApp },
  tauri: { note: 'a Tauri app', has: (root) => tracked(root, /(^|\/)tauri\.conf\.json$/i).length > 0 },
  mobile: { note: 'a Capacitor, Cordova or Android app', has: (root) => tracked(root, /(^|\/)(capacitor\.config\.[a-z]+|config\.xml|AndroidManifest\.xml)$/i).length > 0 },
}

// One rule: app names the framework (checks pass vacuously without it), pick chooses the files, scan(texts) returns [{ x, line, why }].
function rule(id, { app, pick = CODE, ok, scan, fixture }) {
  const run = (root) => {
    if (app && !APPS[app].has(root)) return finish(id, [], `not ${APPS[app].note}, so there is nothing to check`)
    const allow = allowSet(root)
    const texts = tracked(root, pick).map((x) => ({ x, t: readText(root, x) }))
    const f = []
    for (const { x, line = 0, why } of scan(texts)) {
      if (!allowed(allow, id, x, line)) f.push(`${line ? `${x}:${line}` : x} ${why}`)
    }
    return finish(id, f, ok)
  }
  return { run, fixture: () => withFixture(fixture, run) }
}

const E = { 'package.json': '{\n  "name": "fixture",\n  "devDependencies": { "electron": "^45.0.0" }\n}\n' }

main({
  'electron-node-integration': rule('electron-node-integration', {
    app: 'electron',
    ok: 'no window turns on Node.js for web pages',
    scan: lines(/\bnodeIntegration(?:InWorker|InSubFrames)?\s*:\s*true\b/, 'turns on Node.js for web pages, so any script the page loads can reach the computer (set nodeIntegration to false)'),
    fixture: { ...E, 'main.js': "new BrowserWindow({ webPreferences: { nodeIntegration: true } })\n" },
  }),
  'electron-context-isolation': rule('electron-context-isolation', {
    app: 'electron',
    ok: 'every window that sets webPreferences keeps contextIsolation on',
    scan: perFile((t) => [...t.matchAll(/\bwebPreferences\s*:\s*\{/g)].flatMap((m) => {
      if (COMMENT.test(lineText(t, m.index))) return []
      const line = lineOf(t, m.index)
      const iso = /\bcontextIsolation\s*:\s*(\w+)/.exec(block(t, m.index + m[0].length - 1))
      if (!iso) return [{ line, why: 'webPreferences does not set contextIsolation (set it to true, so page code cannot reach the preload scope)' }]
      return iso[1] === 'true' ? [] : [{ line, why: `sets contextIsolation to ${iso[1]} (it must be true)` }]
    })),
    fixture: { ...E, 'main.js': "new BrowserWindow({ webPreferences: { contextIsolation: false } })\n" },
  }),
  'electron-web-security': rule('electron-web-security', {
    app: 'electron',
    ok: 'no window switches off the web security protections',
    scan: lines(/\bwebSecurity\s*:\s*false\b|\ballowRunningInsecureContent\s*:\s*true\b/, 'switches off a browser security protection (webSecurity or allowRunningInsecureContent), so remote content can read data it should not'),
    fixture: { ...E, 'main.js': "new BrowserWindow({ webPreferences: { webSecurity: false } })\n" },
  }),
  'electron-remote-module': rule('electron-remote-module', {
    app: 'electron',
    ok: 'the remote module is not used',
    scan: lines(/\benableRemoteModule\s*:\s*true\b|require\(\s*['"]@electron\/remote['"]\s*\)|from\s+['"]@electron\/remote['"]/, 'uses the remote module, which lets page code reach main-process objects (use a narrow ipc API instead)'),
    fixture: { ...E, 'main.js': "const remote = require('@electron/remote')\n" },
  }),
  'electron-open-external': rule('electron-open-external', {
    app: 'electron',
    ok: 'every link opened with shell.openExternal is a fixed string or passes an allow check',
    scan: perFile((t) => {
      const L = t.split('\n')
      const out = []
      L.forEach((text, i) => {
        const at = text.indexOf('shell.openExternal(')
        if (at < 0 || COMMENT.test(text)) return
        const arg = text.slice(at + 'shell.openExternal('.length)
        if (/^\s*(['"`])[^'"`$\\]*\1\s*[,)]/.test(arg)) return
        const name = /^\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(arg)?.[1]
        if (name && constString(t, name)) return
        const near = L.slice(Math.max(0, i - 10), i + 11).join('\n')
        if (!ALLOW_WORDS.test(near)) out.push({ line: i + 1, why: 'opens a link taken from a value that is not a fixed string, with no allow check within 10 lines' })
      })
      return out
    }),
    fixture: { ...E, 'main.js': 'shell.openExternal(url)\n' },
  }),
  'electron-csp-header': rule('electron-csp-header', {
    app: 'electron',
    pick: PAGE,
    ok: 'the local page has a Content-Security-Policy',
    scan: (texts) => {
      const loads = texts.flatMap(({ x, t }) => lineHits(t, /\.loadFile\s*\(|loadURL\(\s*['"]file:/).map((h) => ({ x, line: h.line })))
      if (!loads.length || texts.some(({ t }) => /content-security-policy/i.test(t))) return []
      return [{ ...loads[0], why: 'loads a local page, but no Content-Security-Policy is set (add a CSP meta tag or a response header)' }]
    },
    fixture: { ...E, 'main.js': "const w = new BrowserWindow({})\nw.loadFile('index.html')\n" },
  }),
  'electron-ipc-validation': rule('electron-ipc-validation', {
    app: 'electron',
    ok: 'no ipc handler passes the renderer argument to a file, shell or child process call unchecked',
    scan: perFile((t) => {
      const out = []
      for (const m of t.matchAll(IPC_HANDLER)) {
        if (COMMENT.test(lineText(t, m.index))) continue
        const p = m[1]
        const call = block(t, m.index + m[0].indexOf('('))
        if (sinkFor(p).test(call) && !IPC_GUARD.test(call)) out.push({ line: lineOf(t, m.index), why: `passes the renderer argument "${p}" to a file, shell or child process call with no check on it` })
      }
      return out
    }),
    fixture: { ...E, 'main.js': "ipcMain.handle('read', async (_e, p) => fs.readFileSync(p, 'utf8'))\n" },
  }),
  'electron-preload-exposure': rule('electron-preload-exposure', {
    app: 'electron',
    ok: 'contextBridge exposes only named functions, not ipcRenderer, require or process',
    scan: perFile((t) => [...t.matchAll(/\bcontextBridge\.exposeInMainWorld\s*\(/g)].flatMap((m) => (
      BARE_EXPOSED.test(block(t, m.index + m[0].length - 1))
        ? [{ line: lineOf(t, m.index), why: 'exposes ipcRenderer, require or process to the page (expose named functions only)' }]
        : []
    ))),
    fixture: { ...E, 'preload.js': "contextBridge.exposeInMainWorld('api', { ipc: ipcRenderer })\n" },
  }),
  'electron-navigation-guards': rule('electron-navigation-guards', {
    app: 'electron',
    ok: 'every app that creates windows guards navigation',
    scan: (texts) => {
      const made = texts.flatMap(({ x, t }) => lineHits(t, /new\s+BrowserWindow\s*\(/).map((h) => ({ x, line: h.line })))
      if (!made.length || texts.some(({ t }) => /will-navigate|setWindowOpenHandler/.test(t))) return []
      return [{ ...made[0], why: 'creates a window with no will-navigate or setWindowOpenHandler guard, so the window can be sent to any address' }]
    },
    fixture: { ...E, 'main.js': 'const w = new BrowserWindow({})\n' },
  }),
  'electron-updater-https': rule('electron-updater-https', {
    app: 'electron',
    pick: UPDATE_FILES,
    ok: 'app updates are fetched over https',
    scan: perFile((t) => (
      /autoUpdater|electron-updater|setFeedURL|feedURL|updateURL|\bpublish\b/.test(t)
        ? lineHits(t, /['"`]http:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/).map((h) => ({ line: h.line, why: 'fetches app updates over plain http://, so the update can be swapped on the network (use https://)' }))
        : []
    )),
    fixture: { ...E, 'main.js': "const { autoUpdater } = require('electron-updater')\nautoUpdater.setFeedURL({ provider: 'generic', url: 'http://updates.example.com' })\n" },
  }),
  'electron-devtools-prod': rule('electron-devtools-prod', {
    app: 'electron',
    ok: 'DevTools open only behind a dev-only condition',
    scan: perFile((t) => {
      const L = t.split('\n')
      return lineHits(t, /\.(?:openDevTools|toggleDevTools)\s*\(/)
        .filter((h) => !DEV_GATE.test(L.slice(Math.max(0, h.line - 7), h.line).join('\n')))
        .map((h) => ({ line: h.line, why: 'opens DevTools with no dev-only condition, so a shipped build can be inspected (gate it on app.isPackaged or a dev flag)' }))
    }),
    fixture: { ...E, 'main.js': 'win.webContents.openDevTools()\n' },
  }),
  'tauri-allowlist': rule('tauri-allowlist', {
    app: 'tauri',
    pick: /(^|\/)tauri\.conf\.json$/i,
    ok: 'the Tauri allowlist grants no more than it needs',
    scan: perFile((t) => {
      const L = t.split('\n')
      const above = (i, n, word) => L.slice(Math.max(0, i - n), i + 1).some((s) => s.includes(word))
      const out = []
      L.forEach((s, i) => {
        if (/"all"\s*:\s*true\b/.test(s) && above(i, 20, '"allowlist"')) out.push({ line: i + 1, why: 'turns on every Tauri API (allowlist "all" is true)' })
        if (/"open"\s*:\s*true\b/.test(s) && above(i, 20, '"shell"')) out.push({ line: i + 1, why: 'lets the page open files and links with the system (shell "open" is true)' })
        if (/"\*\*"/.test(s) && above(i, 6, '"scope"')) out.push({ line: i + 1, why: 'gives file access to every path on disk (fs scope "**")' })
      })
      return out
    }),
    fixture: { 'src-tauri/tauri.conf.json': '{\n  "tauri": {\n    "allowlist": {\n      "all": true\n    }\n  }\n}\n' },
  }),
  'capacitor-cordova-cleartext': rule('capacitor-cordova-cleartext', {
    app: 'mobile',
    pick: /(^|\/)(AndroidManifest\.xml|network_security_config\.xml|capacitor\.config\.(m?[jt]s|json|cjs))$/i,
    ok: 'no mobile shell allows plain http traffic',
    scan: lines(/usesCleartextTraffic\s*=\s*"true"|cleartextTrafficPermitted\s*=\s*"true"|\bcleartext\s*:\s*true\b/, 'allows plain http (cleartext) traffic, so requests can be read or changed on the network (use https)'),
    fixture: { 'capacitor.config.ts': "const config = { appId: 'app.fixture', server: { cleartext: true } }\nexport default config\n" },
  }),
  'android-manifest-flags': rule('android-manifest-flags', {
    app: 'mobile',
    pick: /(^|\/)AndroidManifest\.xml$/i,
    ok: 'the Android manifest is not debuggable and does not allow backups',
    scan: both(
      lines(/android:debuggable\s*=\s*"true"/, 'is debuggable, so anyone with adb can attach a debugger and read app data (set android:debuggable to false for release)'),
      lines(/android:allowBackup\s*=\s*"true"/, 'allows app data to be backed up and copied off the device (set android:allowBackup to false unless you need it)'),
    ),
    fixture: { 'app/src/main/AndroidManifest.xml': '<manifest>\n  <application android:debuggable="true" android:allowBackup="true">\n  </application>\n</manifest>\n' },
  }),
})
