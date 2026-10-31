// The electron-plus pack: deeper Electron and desktop-framework checks than the desktop pack. Five checks, one per rule table
// in thorough/rules-electron-plus.mjs: window options (ep-window), IPC and preload exposure (ep-ipc-preload), fuses and build
// config (ep-fuses-build), renderer content and CSP (ep-content-renderer), and Tauri, NW.js, Neutralino, Cordova, Capacitor and
// Android WebView settings (ep-tauri-cross). Each check prints one sub-check per rule (docs/suites.md). Turn it on with
// { "packs": ["electron-plus"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'
import { CHECK_TABLES } from '../../thorough/rules-electron-plus.mjs'

const EP = `${MK}/thorough/electron-plus.mjs`
const TITLES = {
  'ep-window': 'Electron windows: sandbox, experimental features, navigation, permissions, certificates and command-line switches',
  'ep-ipc-preload': 'Electron IPC and preload: sender checks, exposed Node objects, channel names and listeners',
  'ep-fuses-build': 'Electron fuses and build config: package-time fuses, asar, signing, notarisation, entitlements and publish settings',
  'ep-content-renderer': 'Electron page content: Content-Security-Policy, remote scripts, webview, eval and raw HTML',
  'ep-tauri-cross': 'Tauri, NW.js, Neutralino, Cordova, Capacitor and Android WebView: scopes, capabilities and command settings',
}

// Subs: the number of rules in each table (computed, never written as a snapshot).
const check = (id) => ({
  id,
  group: 'security',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title: TITLES[id],
  estSeconds: 2,
  suite: 'desktop-apps',
  subs: CHECK_TABLES[id].length,
  needs: ['node'],
  run: { cmd: 'node', args: [EP, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [EP, id, '--fixtures'], cwd: 'repo', expectFail: true, expectMatch: 'found' },
})

export default Object.keys(CHECK_TABLES).map(check)
