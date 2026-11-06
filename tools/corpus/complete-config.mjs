// Complete config files for the clean twins of the planted-defect corpus. A sample about a whole config file (forge.config.js,
// electron-builder.json, tauri.conf.json, Cargo.toml, package.json, a plist) is a fragment; a clean twin that is only the fragment is not a
// project's config, so other rules about that file fire on it and that is a measurement bug, not an alarm. The twin is the COMPLETE clean base
// config with the clean sample merged in: keys for JSON and TOML, the one fuse line for forge.config.js, the key entries for a plist.
//
// completeTwin(file, sampleText, baseName) -> merged text, or null when the file is not one the corpus completes or cannot be merged.
import { baseTree } from './base-project.mjs'

const FUSES = [
  ['RunAsNode', 'runAsNode', false],
  ['EnableNodeOptionsEnvironmentVariable', 'enableNodeOptionsEnvironmentVariable', false],
  ['EnableNodeCliInspectArguments', 'enableNodeCliInspectArguments', false],
  ['GrantFileProtocolExtraPrivileges', 'grantFileProtocolExtraPrivileges', false],
  ['EnableEmbeddedAsarIntegrityValidation', 'embeddedAsarIntegrityValidation', true],
  ['OnlyLoadAppFromAsar', 'onlyLoadAppFromAsar', true],
  ['EnableCookieEncryption', 'enableCookieEncryption', true],
]
const FORGE = `const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

module.exports = {
  packagerConfig: { asar: true, "productName": 'Clip Desk', "copyright": 'Copyright 2026 Example' },
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
${FUSES.map(([p, , v]) => `      [FuseV1Options.${p}]: ${v},`).join('\n')}
    }),
  ],
}
`
const BUILDER = { appId: 'invalid.example.clipdesk', productName: 'Clip Desk', copyright: 'Copyright 2026 Example', asar: true, electronFuses: Object.fromEntries(FUSES.map(([, c, v]) => [c, v])) }
const TAURI = { productName: 'Clip Desk', version: '1.0.0', identifier: 'invalid.example.clipdesk', app: { security: { csp: "default-src 'self'", freezePrototype: true } } }
const ENTITLEMENTS = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>com.apple.security.app-sandbox</key>\n  <true/>\n  <key>com.apple.security.network.client</key>\n  <true/>\n</dict>\n</plist>\n'
const INFO_PLIST = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>CFBundleName</key>\n  <string>Clip Desk</string>\n  <key>CFBundleIdentifier</key>\n  <string>invalid.example.clipdesk</string>\n  <key>NSAppTransportSecurity</key>\n  <dict>\n    <key>NSAllowsArbitraryLoads</key>\n    <false/>\n  </dict>\n</dict>\n</plist>\n'

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x)
const deepMerge = (a, b) => {
  if (!isObj(a) || !isObj(b)) return b
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? deepMerge(a[k], v) : v
  return out
}
const parseLoose = (text) => {
  for (const t of [text, `{${text}}`, `{${text.replace(/,\s*$/, '')}}`]) {
    try {
      const v = JSON.parse(t)
      if (isObj(v)) return v
    } catch {}
  }
  return null
}
const mergeJson = (base, sample) => {
  // A sample that is not JSON even in braces (a value read from process.env, say) is a line of code, not a setting: the twin is the complete base config.
  const s = parseLoose(sample.trim())
  let out = s ? deepMerge(JSON.parse(base), s) : JSON.parse(base)
  // A package.json that names electron-builder carries its build config; a tauri updater carries the key it verifies with.
  if (/electron-builder/.test(JSON.stringify(out)) && !out.build) out = { ...out, build: BUILDER }
  if (out.plugins?.updater && !out.plugins.updater.pubkey) out.plugins.updater.pubkey = 'dW50cnVzdGVk'
  if (out.updater && !out.updater.pubkey) out.updater.pubkey = 'dW50cnVzdGVk'
  return JSON.stringify(out, null, 2) + '\n'
}

// TOML: sections of `key = value` entries (a value may continue on the following lines). The sample's keys replace or add to the base's.
function tomlSections(text) {
  const secs = [{ name: '', entries: [] }]
  for (const line of text.split('\n')) {
    const h = /^\s*(\[\[?[^\]]+\]\]?)\s*$/.exec(line)
    if (h) secs.push({ name: h[1], entries: [] })
    else if (/^\s*[\w."-]+\s*=/.test(line)) secs.at(-1).entries.push({ key: /^\s*([\w."-]+)\s*=/.exec(line)[1], lines: [line] })
    else if (line.trim() && secs.at(-1).entries.length) secs.at(-1).entries.at(-1).lines.push(line)
  }
  return secs
}
function mergeToml(base, sample) {
  const b = tomlSections(base)
  for (const s of tomlSections(sample)) {
    let t = b.find((x) => x.name === s.name)
    if (!t) b.push((t = { name: s.name, entries: [] }))
    for (const e of s.entries) {
      const i = t.entries.findIndex((x) => x.key === e.key)
      if (i >= 0) t.entries[i] = e
      else t.entries.push(e)
    }
  }
  // A workspace root names its resolver (the sample for another rule leaves it out).
  const ws = b.find((x) => x.name === '[workspace]')
  if (ws && !ws.entries.some((e) => e.key === 'resolver')) ws.entries.push({ key: 'resolver', lines: ['resolver = "2"'] })
  return b.filter((x) => x.name || x.entries.length).map((x) => [x.name, ...x.entries.flatMap((e) => e.lines)].filter(Boolean).join('\n')).join('\n\n') + '\n'
}

// forge.config.js: patch the one fuse line the clean sample sets. Only a secure value is the clean line; a sample that sets some other fuse to an
// unsafe value (the "leave this fuse unset" samples write runAsNode: true) is not merged, so the twin does not gain a defect of its own.
function mergeForge(base, sample) {
  let out = base
  const pairs = [...sample.matchAll(/\[FuseV1Options\.(\w+)\]\s*:\s*(true|false)/g)].map((m) => [m[1], m[2]])
  for (const m of sample.matchAll(/(?<![.\w])([a-z]\w+)\s*:\s*(true|false)\b/g)) {
    const f = FUSES.find(([, c]) => c === m[1])
    if (f) pairs.push([f[0], m[2]])
  }
  for (const [p, v] of pairs) {
    const f = FUSES.find(([x]) => x === p)
    if (!f || String(f[2]) !== v) continue
    out = out.replace(new RegExp(`(\\[FuseV1Options\\.${p}\\]\\s*:\\s*)(?:true|false)`), `$1${v}`)
  }
  return out
}

function mergePlist(base, sample) {
  let out = base
  for (const m of sample.matchAll(/<key>([^<]+)<\/key>\s*(<(?:true|false)\/>|<string>[^<]*<\/string>)?/g)) {
    const key = m[1]
    const val = m[2] ?? '<true/>'
    const re = new RegExp(`(<key>${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</key>\\s*)(?:<(?:true|false)/>|<string>[^<]*</string>)`)
    if (!m[2]) continue // a key with no value says nothing about it being granted
    if (re.test(out)) out = out.replace(re, `$1${val}`)
    else out = out.replace(/<\/dict>\s*<\/plist>/, `  <key>${key}</key>\n  ${val}\n</dict>\n</plist>`)
  }
  return out
}

const KINDS = [
  [/(^|\/)forge\.config\.[cm]?js$/, () => FORGE, mergeForge],
  [/(^|\/)electron-builder\.json$/, () => JSON.stringify(BUILDER, null, 2) + '\n', mergeJson],
  [/(^|\/)tauri\.conf\.json$/, () => JSON.stringify(TAURI, null, 2) + '\n', mergeJson],
  [/(^|\/)package\.json$/, (tree) => tree['package.json'], mergeJson],
  [/(^|\/)Cargo\.toml$/, (tree) => tree['Cargo.toml'], mergeToml],
  [/(^|\/)[^/]*entitlements[^/]*\.plist$/, () => ENTITLEMENTS, mergePlist],
  [/(^|\/)Info\.plist$/, () => INFO_PLIST, mergePlist],
]

export function completeTwin(file, sampleText, baseName) {
  const kind = KINDS.find(([re]) => re.test(file))
  if (!kind) return null
  const base = kind[1](baseTree(baseName))
  return base == null ? null : kind[2](base, sampleText.replace(/\r\n/g, '\n'))
}
