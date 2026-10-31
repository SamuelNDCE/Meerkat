// The desktop pack: security checks for Electron, Tauri, Capacitor, Cordova and Android shells. Each check passes with "not an Electron app"
// (or similar) when the repo does not use that framework. Turn it on with { "packs": ["desktop"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const DS = `${MK}/thorough/desktop.mjs`
const make = (id, title) => ({
  id,
  group: 'security',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  run: { cmd: 'node', args: [DS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [DS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('electron-node-integration', 'Electron: no window turns on Node.js for web pages'),
  make('electron-context-isolation', 'Electron: every window with webPreferences keeps contextIsolation on'),
  make('electron-web-security', 'Electron: no window switches off webSecurity or allows insecure content'),
  make('electron-remote-module', 'Electron: the remote module is not enabled or used'),
  make('electron-open-external', 'Electron: shell.openExternal gets a fixed string or passes an allow check'),
  make('electron-csp-header', 'Electron: a local page is sent with a Content-Security-Policy'),
  make('electron-ipc-validation', 'Electron: ipc handlers do not pass renderer input to files or processes unchecked'),
  make('electron-preload-exposure', 'Electron: contextBridge exposes named functions, not ipcRenderer or require'),
  make('electron-navigation-guards', 'Electron: apps that create windows guard navigation and new windows'),
  make('electron-updater-https', 'Electron: app updates are fetched over https'),
  make('electron-devtools-prod', 'Electron: DevTools open only behind a dev-only condition'),
  make('tauri-allowlist', 'Tauri: the allowlist grants no all-APIs, open-anything shell or whole-disk fs scope'),
  make('capacitor-cordova-cleartext', 'Capacitor or Cordova: no mobile shell allows plain http traffic'),
  make('android-manifest-flags', 'Android: the manifest is not debuggable and does not allow backups'),
]
