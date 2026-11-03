// Rule tables for the client-framework checks (thorough/client-frameworks.mjs): React, React Native / Android and Next.js. Each table is
// one check (cf-react, cf-mobile, cf-next) and each rule is one sub-check. Rules are narrow on purpose: they match the dangerous shape
// (an exported Android component with no permission, a secret-named NEXT_PUBLIC_ variable, a server action that mutates data and never
// looks at a session) and not the safe twin of it. Regexes are linear: bounded quantifiers only, no nested open spans.
// Known limits (a line rule cannot see everything): a call split over several lines, a value passed through a helper, and an auth check
// done in a middleware file are not followed. Accept a finding in .meerkat-clientframeworks-allow as "<rule-id> <path>" or "<rule-id> *".

const JS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']
const COMMENT = /^\s*(\/\/|\/\*|\*)/

// ---------- cf-react ----------

// A hook (use + Capital) called as a function: not a definition (`function useX(`) and not a member call (`obj.useX(`).
const HOOK_CALL = /(?<![\w$.])use[A-Z][A-Za-z0-9]{0,40}\s*\(/
const HOOK_AFTER_COND = /\b(if|while)\s*\([^)]{0,200}\)\s*\{?[^}]{0,200}(?<![\w$.])use[A-Z][A-Za-z0-9]{0,40}\s*\(|(&&|\?)\s*(?<![\w$.])use[A-Z][A-Za-z0-9]{0,40}\s*\(/

// Walks up from the hook line through the enclosing blocks until the function body that holds it. True when a block opened by
// if / else / for / while / switch / case / try / catch sits between the hook and that function (hooks may not be called there).
function hookInBlock(lines, index) {
  let depth = 0
  for (let j = index - 1; j >= 0 && index - j <= 60; j--) {
    const l = lines[j]
    for (let k = l.length - 1; k >= 0; k--) {
      if (l[k] === '}') depth++
      else if (l[k] === '{') depth--
    }
    if (depth >= 0) continue
    // l opens a block that encloses the hook line.
    if (/^\s*(\}\s*)?(else\b|if\b|for\b|while\b|switch\b|case\b|try\b|catch\b)/.test(l) || /\b(if|for|while)\s*\(.{0,200}\)\s*\{\s*$/.test(l)) return true
    if (/\bfunction\b|=>/.test(l)) return false
    depth = 0
  }
  return false
}

export const CF_REACT = [
  { id: 'react-hooks-conditional', title: 'A React hook is called inside a condition or loop, which breaks the rules of hooks', ext: JS, severity: 'medium', sample: 'Panel.jsx', skipLine: COMMENT,
    test: (line, ctx) => HOOK_CALL.test(line) && !/\bfunction\s+use[A-Z]/.test(line) && /from\s+['"]react['"]/.test(ctx.text) && (HOOK_AFTER_COND.test(line) || hookInBlock(ctx.lines, ctx.index)),
    bad: "import { useState } from 'react'\n\nexport function Panel({ open }) {\n  if (open) { const [rows, setRows] = useState([]) }\n  return null\n}\n",
    good: "import { useState } from 'react'\n\nexport function Panel({ open }) {\n  const [rows, setRows] = useState([])\n  if (open) { rows.length }\n  return null\n}\n" },
  { id: 'react-js-href', title: 'A link in JSX has a javascript: address as its href, which runs script on click and defeats a strict CSP', ext: JS, severity: 'medium', sample: 'Menu.jsx', skipLine: COMMENT,
    re: /\bhref\s*=\s*(\{\s*)?["'`]\s*javascript:/i,
    bad: 'export function Menu({ openSettings }) {\n  return <a href="javascript:openSettings()">Settings</a>\n}\n',
    good: 'export function Menu({ openSettings }) {\n  return <button onClick={openSettings}>Settings</button>\n}\n' },
]

// ---------- cf-mobile ----------

const COMPONENT = /<(activity-alias|activity|receiver|provider|service)\b/

// The manifest element that holds an android:exported="true" line, as text: from its opening tag to its end (bounded to 40 lines).
function manifestElement(lines, index) {
  let start = index
  while (start >= 0 && index - start < 12 && !COMPONENT.test(lines[start])) start--
  if (start < 0 || !COMPONENT.test(lines[start])) return null
  const text = lines.slice(start, start + 40).join('\n')
  const tag = COMPONENT.exec(text)[1]
  const open = new RegExp(`<${tag}\\b[^>]{0,2000}>`).exec(text)
  if (!open) return text
  if (open[0].endsWith('/>')) return open[0]
  const close = text.indexOf(`</${tag}>`)
  return close < 0 ? text : text.slice(0, close)
}

export const CF_MOBILE = [
  { id: 'rn-android-exported', title: 'An exported Android component has no permission, so any app on the phone can start it or send it intents', files: /(^|\/)AndroidManifest\.xml$/, severity: 'high', sample: 'AndroidManifest.xml',
    test: (line, ctx) => {
      if (!/android:exported\s*=\s*["']true["']/.test(line)) return false
      const el = manifestElement(ctx.lines, ctx.index)
      if (!el || /android:permission\s*=/.test(el)) return false
      // The launcher screen and a browsable deep-link entry are exported on purpose.
      return !/android\.intent\.action\.MAIN|android\.intent\.category\.(LAUNCHER|BROWSABLE)/.test(el)
    },
    bad: '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application>\n    <receiver android:name=".SyncReceiver" android:exported="true" />\n  </application>\n</manifest>\n',
    good: '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application>\n    <receiver android:name=".SyncReceiver" android:exported="false" />\n    <activity android:name=".MainActivity" android:exported="true">\n      <intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>\n    </activity>\n    <service android:name=".Push" android:exported="true" android:permission="com.google.android.c2dm.permission.SEND" />\n  </application>\n</manifest>\n' },
  { id: 'rn-async-storage-secret', title: 'A token, password or secret is saved in AsyncStorage, which is plain unencrypted storage', ext: JS, severity: 'medium', sample: 'storage.js', skipLine: COMMENT,
    re: /\bAsyncStorage\.(setItem|mergeItem|multiSet)\(\s*\[?\s*\[?\s*['"`][^'"`\n]{0,60}(token|passw|secret|jwt|credential|api[-_ ]?key)[^'"`\n]{0,60}['"`]/i,
    bad: "import AsyncStorage from '@react-native-async-storage/async-storage'\nexport async function saveToken(token) {\n  await AsyncStorage.setItem('accessToken', token)\n}\n",
    good: "import AsyncStorage from '@react-native-async-storage/async-storage'\nexport async function remember() {\n  await Keychain.setGenericPassword('session', 'x')\n  await AsyncStorage.setItem('rememberMe', 'true')\n}\n" },
  { id: 'rn-linking-open', title: 'Linking.openURL opens an address taken from a route param or deep link without checking it first', ext: JS, severity: 'medium', sample: 'open.js', skipLine: COMMENT,
    re: /\bLinking\.openURL\(\s*(await\s+)?(props\.)?(route\.params|navigation\.getParam|[A-Za-z_$][\w$]{0,30}\.params|event\.url|initialUrl)\b/,
    unless: (line, ctx) => /\b(startsWith|includes|ALLOWED|allowlist|allowList|isAllowed|isSafe|canOpenURL|new URL)\b/.test(line) || ctx.lines.slice(Math.max(0, ctx.index - 3), ctx.index).some((l) => /\b(startsWith|ALLOWED|allowlist|allowList|isAllowed|isSafe|new URL)\b/.test(l)),
    bad: "import { Linking } from 'react-native'\nexport function openLink(route) {\n  Linking.openURL(route.params.url)\n}\n",
    good: "import { Linking } from 'react-native'\nexport function openLink(route) {\n  if (route.params.url.startsWith('https://shopfront.dev/')) Linking.openURL(route.params.url)\n}\n" },
  { id: 'rn-webview-origin-any', title: 'A React Native WebView accepts every origin (originWhitelist of *), so file:, intent: and any other scheme may load', ext: JS, severity: 'medium', sample: 'Help.js', skipLine: COMMENT,
    re: /\boriginWhitelist\s*=\s*\{\s*\[\s*['"]\*['"]/,
    bad: "import { WebView } from 'react-native-webview'\nexport const Help = ({ route }) => <WebView originWhitelist={['*']} source={{ uri: route.params.uri }} />\n",
    good: "import { WebView } from 'react-native-webview'\nexport const Help = () => <WebView originWhitelist={['https://help.shopfront.dev']} source={{ uri: 'https://help.shopfront.dev' }} />\n" },
]

// ---------- cf-next ----------

const USE_SERVER = /(^|\n)\s*['"]use server['"]|\{\s*\n?\s*['"]use server['"]/
// A server-side session or role check anywhere in the file.
const AUTH_WORD = /\b(auth|getSession|getServerSession|getUser|currentUser|requireUser|requireAuth|requireAdmin|verifySession|verifyToken|checkAuth|checkSession|validateRequest|cookies)\s*\(|\bsession\b|\bisAdmin\b|\bforbidden\b|\bunauthori[sz]ed\b/i
const MUTATION = /\b(?:db|prisma|knex|supabase|mongoose|sequelize|orm|collection)\b[\w.()'"[\]-]{0,60}?\.(?:delete|deleteMany|update|updateMany|create|createMany|insert|insertOne|destroy|remove|upsert|drop)\s*\(|\.(?:query|execute|run)\(\s*[`'"]\s*(?:DELETE\s+FROM|UPDATE\s+\w|INSERT\s+INTO|DROP\s)/i
const FS_CALL = /\b(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|unlinkSync|rm|rmSync|readdir|copyFile|rename|appendFile)\s*\(/
const FORM_INPUT = /\bformData\.get\(|\bsearchParams\b|\bparams\.\w|\bbody\.\w|\binput\.\w/
const PATH_GUARD = /\bbasename\s*\(|\.startsWith\(|\.includes\(\s*['"]\.\.['"]|\bisAbsolute\(|\bpath\.relative\(|\bnormalize\(/

export const CF_NEXT = [
  { id: 'next-public-secret-env', title: 'A NEXT_PUBLIC_ variable is named like a secret (secret, password, private key, access token), and Next.js copies it into the browser bundle',
    files: /\.(m?[jt]sx?)$|(^|\/)\.env(\.[\w.-]+)?$/, notIn: /(^|\/)\.env\.(example|sample|template)$/i, severity: 'high', sample: 'client.js', skipLine: COMMENT,
    re: /\bNEXT_PUBLIC_[A-Z0-9_]{0,40}(SECRET|PASSWORD|PASSWD|PASSPHRASE|PRIVATE|CREDENTIAL|SERVICE_ROLE|DB_PASS|(ADMIN|AUTH|ACCESS|API|BEARER|SESSION)_TOKEN)[A-Z0-9_]{0,40}/,
    bad: "'use client'\nexport const adminSecret = process.env.NEXT_PUBLIC_ADMIN_SECRET\n",
    good: "'use client'\nexport const adminFlag = process.env.NEXT_PUBLIC_ADMIN_ENABLED === '1'\nexport const base = process.env.NEXT_PUBLIC_API_URL\nexport const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY\n" },
  { id: 'next-action-no-auth', title: 'A server action changes data (delete, update, create) in a file that never checks a session or role, so anyone who can post to it can run it', ext: JS, severity: 'high', sample: 'delete-user.js', skipLine: COMMENT,
    test: (line, ctx) => MUTATION.test(line) && USE_SERVER.test(ctx.text) && !AUTH_WORD.test(ctx.text),
    bad: "import { db } from '../db'\n\nexport async function deleteUser(formData) {\n  'use server'\n  await db.users.delete({ id: formData.get('id') })\n}\n",
    good: "import { db } from '../db'\n\nexport async function deleteUser(formData) {\n  'use server'\n  const session = await auth()\n  if (!session?.user?.isAdmin) throw new Error('forbidden')\n  await db.users.delete({ id: formData.get('id') })\n}\n" },
  { id: 'next-action-path-traversal', title: 'A server action builds a file path from form or request input without path.basename or a check that it stays inside the folder', ext: JS, severity: 'high', sample: 'download.js', skipLine: COMMENT,
    test: (line, ctx) => {
      if (!FS_CALL.test(line) || !USE_SERVER.test(ctx.text) || /\bbasename\s*\(/.test(line)) return false
      if (FORM_INPUT.test(line)) return true
      // A value built from the form earlier in the file (and not cut down with basename) and used in this call.
      for (const m of ctx.text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]{0,30})\s*=([^\n;]{0,200}(?:formData\.get\(|searchParams\.get\())/g)) {
        if (!/\bbasename\s*\(/.test(m[2]) && new RegExp(`(^|[^\\w$.])${m[1].replace(/\$/g, '\\$')}([^\\w$]|$)`).test(line)) return true
      }
      return false
    },
    unless: (line, ctx) => ctx.lines.slice(Math.max(0, ctx.index - 8), ctx.index + 1).some((l) => PATH_GUARD.test(l)),
    bad: "import fs from 'node:fs/promises'\nimport path from 'node:path'\n\nexport async function download(formData) {\n  'use server'\n  return fs.readFile(path.join('uploads', formData.get('name')))\n}\n",
    good: "import fs from 'node:fs/promises'\nimport path from 'node:path'\n\nexport async function download(formData) {\n  'use server'\n  return fs.readFile(path.join('uploads', path.basename(String(formData.get('name')))))\n}\n" },
]

export const CHECK_TABLES = {
  'cf-react': CF_REACT,
  'cf-mobile': CF_MOBILE,
  'cf-next': CF_NEXT,
}
