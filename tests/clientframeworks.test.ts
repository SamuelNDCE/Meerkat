// The client-framework family (thorough/client-frameworks.mjs, thorough/rules-client-frameworks.mjs, packs/client-frameworks): every rule
// proves itself on its own bad and good samples, every check fails on its own fixture, and each rule is tested on both sides with
// extra planted shapes (must be found) and their safe twins (must not be found). Also: a hostile long line stays fast, the pack loads,
// and no file uses an em dash.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'
import { CHECK_TABLES } from '../thorough/rules-client-frameworks.mjs'
import { evaluate, selfProve } from '../thorough/rules.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/client-frameworks.mjs'
const IDS = Object.keys(CHECK_TABLES) as (keyof typeof CHECK_TABLES)[]

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function newFolder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-clientfw-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

function runCheck(args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

// The rule ids that fire when one file is scanned with a check's table.
function fired(check: keyof typeof CHECK_TABLES, file: string, text: string): string[] {
  const dir = newFolder({ [file]: text })
  return [...new Set(evaluate(dir, CHECK_TABLES[check], { files: [file] }).found.map((f) => f.rule))]
}

const MANIFEST = (inner: string) => `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application>\n${inner}\n  </application>\n</manifest>\n`
const ACTION = (imports: string, body: string) => `${imports}\n\nexport async function run(formData) {\n  'use server'\n${body}\n}\n`

// [rule, check, file, planted text (must fire the rule), safe twin (must not fire it)]
const CASES: [string, keyof typeof CHECK_TABLES, string, string, string][] = [
  ['react-hooks-conditional', 'cf-react', 'src/Panel.jsx', "import { useState } from 'react'\nexport function Panel({ open }) {\n  if (open) { const [rows, setRows] = useState([]) }\n  return null\n}\n", "import { useState } from 'react'\nexport function Panel({ open }) {\n  const [rows, setRows] = useState([])\n  if (open) { rows.push(1) }\n  return null\n}\n"],
  ['react-hooks-conditional', 'cf-react', 'src/Loop.jsx', "import { useEffect } from 'react'\nexport function Loop({ items }) {\n  for (const item of items) {\n    useEffect(() => {}, [item])\n  }\n  return null\n}\n", "import { useEffect } from 'react'\nexport function Loop({ items }) {\n  useEffect(() => { items.forEach((i) => i) }, [items])\n  return null\n}\n"],
  ['react-hooks-conditional', 'cf-react', 'src/Early.jsx', "import { useMemo } from 'react'\nexport function Early({ ok }) {\n  const v = ok && useMemo(() => 1, [])\n  return v\n}\n", "import { useMemo } from 'react'\nexport function Early({ ok }) {\n  const v = useMemo(() => (ok ? 1 : 0), [ok])\n  return v\n}\n"],
  ['react-hooks-conditional', 'cf-react', 'src/useThing.js', "import { useState } from 'react'\nexport function useThing(on) {\n  if (on) {\n    return useState(0)\n  }\n  return null\n}\n", "import { useState } from 'react'\nexport function useThing() {\n  return useState(0)\n}\nexport function useOther() {\n  const x = () => {\n    return 1\n  }\n  return useState(x())\n}\n"],
  ['react-js-href', 'cf-react', 'src/Menu.jsx', 'export const Menu = () => <a href="javascript:openSettings()">Settings</a>\n', 'export const Menu = ({ openSettings }) => <button onClick={openSettings}>Settings</button>\n'],
  ['react-js-href', 'cf-react', 'src/Banner.jsx', "export const Banner = ({ cta }) => <a href={'javascript:' + cta.action}>{cta.label}</a>\n", 'export const Banner = ({ cta }) => <a href={cta.url}>{cta.label}</a>\n'],
  ['react-js-href', 'cf-react', 'src/Tpl.tsx', 'export const Cta = ({ a }: { a: string }) => <a href={`javascript:${a}`}>Go</a>\n', 'export const Cta = () => <a href="/go">javascript: is mentioned in the text</a>\n'],
  ['rn-android-exported', 'cf-mobile', 'android/app/src/promo/AndroidManifest.xml', MANIFEST('    <activity android:name=".PaymentActivity" android:exported="true" />'), MANIFEST('    <activity android:name=".PaymentActivity" android:exported="false" />')],
  ['rn-android-exported', 'cf-mobile', 'android/app/src/partner/AndroidManifest.xml', MANIFEST('    <receiver android:name=".SyncReceiver" android:exported="true" />'), MANIFEST('    <receiver android:name=".SyncReceiver" android:exported="true" android:permission="dev.shopfront.permission.SYNC" />')],
  ['rn-android-exported', 'cf-mobile', 'android/app/src/share/AndroidManifest.xml', MANIFEST('    <provider android:name=".FilesProvider" android:authorities="dev.shopfront.files" android:exported="true" />'), MANIFEST('    <provider android:name=".FilesProvider" android:authorities="dev.shopfront.files" android:exported="false" />')],
  ['rn-android-exported', 'cf-mobile', 'android/app/src/main/AndroidManifest.xml', MANIFEST('    <service\n      android:name=".SyncService"\n      android:exported="true">\n      <intent-filter><action android:name="dev.shopfront.SYNC" /></intent-filter>\n    </service>'), MANIFEST('    <activity android:name=".MainActivity" android:exported="true">\n      <intent-filter>\n        <action android:name="android.intent.action.MAIN" />\n        <category android:name="android.intent.category.LAUNCHER" />\n      </intent-filter>\n    </activity>\n    <activity android:name=".Link" android:exported="true">\n      <intent-filter><category android:name="android.intent.category.BROWSABLE" /></intent-filter>\n    </activity>')],
  ['rn-async-storage-secret', 'cf-mobile', 'src/auth/storage.js', "import AsyncStorage from '@react-native-async-storage/async-storage'\nexport const save = (t) => AsyncStorage.setItem('accessToken', t)\n", "import AsyncStorage from '@react-native-async-storage/async-storage'\nexport const save = (t) => Keychain.setGenericPassword('session', t)\n"],
  ['rn-async-storage-secret', 'cf-mobile', 'src/auth/remember.js', "import AsyncStorage from '@react-native-async-storage/async-storage'\nexport const r = (p) => AsyncStorage.setItem('password', p)\n", "import AsyncStorage from '@react-native-async-storage/async-storage'\nexport const r = () => AsyncStorage.setItem('rememberMe', 'true')\n"],
  ['rn-async-storage-secret', 'cf-mobile', 'src/auth/auth.ts', "import AsyncStorage from '@react-native-async-storage/async-storage'\nexport const s = (t: string) => AsyncStorage.setItem('refresh_token', t)\n", "import AsyncStorage from '@react-native-async-storage/async-storage'\nexport const s = () => AsyncStorage.setItem('theme', 'dark')\nexport const g = () => AsyncStorage.getItem('accessToken')\n"],
  ['rn-linking-open', 'cf-mobile', 'src/links/open.js', "import { Linking } from 'react-native'\nexport const o = (route) => Linking.openURL(route.params.url)\n", "import { Linking } from 'react-native'\nexport const o = (route) => {\n  if (route.params.url.startsWith('https://shopfront.dev/')) Linking.openURL(route.params.url)\n}\n"],
  ['rn-linking-open', 'cf-mobile', 'src/links/fixed.js', "import { Linking } from 'react-native'\nexport const o = ({ route }) => Linking.openURL(route.params.link)\n", "import { Linking } from 'react-native'\nexport const o = () => Linking.openURL('https://shopfront.dev/help')\n"],
  ['rn-webview-origin-any', 'cf-mobile', 'src/screens/Help.js', "import { WebView } from 'react-native-webview'\nexport const H = ({ route }) => <WebView originWhitelist={['*']} source={{ uri: route.params.uri }} />\n", "import { WebView } from 'react-native-webview'\nexport const H = () => <WebView originWhitelist={['https://help.shopfront.dev']} source={{ uri: 'https://help.shopfront.dev' }} />\n"],
  ['next-public-secret-env', 'cf-next', 'app/lib/admin-client.js', "'use client'\nexport const s = process.env.NEXT_PUBLIC_ADMIN_SECRET\n", "'use client'\nexport const s = process.env.NEXT_PUBLIC_ADMIN_ENABLED === '1'\n"],
  ['next-public-secret-env', 'cf-next', 'app/lib/api-client.js', "'use client'\nexport const t = process.env.NEXT_PUBLIC_PRIVATE_API_TOKEN\n", "'use client'\nexport const t = process.env.NEXT_PUBLIC_API_URL\n"],
  ['next-public-secret-env', 'cf-next', 'app/lib/db-client.js', "'use client'\nexport const p = process.env.NEXT_PUBLIC_DB_PASSWORD\n", "'use client'\nexport const p = process.env.NEXT_PUBLIC_DB_HOST_LABEL\nexport const k = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY\n"],
  ['next-public-secret-env', 'cf-next', '.env.production', 'NEXT_PUBLIC_API_URL=https://api.shopfront.dev\nNEXT_PUBLIC_STRIPE_SECRET=abc\n', 'NEXT_PUBLIC_API_URL=https://api.shopfront.dev\nSTRIPE_SECRET=abc\n'],
  ['next-action-no-auth', 'cf-next', 'app/actions/delete-user.js', ACTION("import { db } from '../db'", "  await db.users.delete({ id: formData.get('id') })"), ACTION("import { db } from '../db'", "  const session = await auth()\n  if (!session?.user?.isAdmin) throw new Error('forbidden')\n  await db.users.delete({ id: formData.get('id') })")],
  ['next-action-no-auth', 'cf-next', 'app/actions/rename.js', ACTION("import { prisma } from '../prisma'", "  await prisma.project.update({ where: { id: formData.get('id') }, data: { name: formData.get('name') } })"), ACTION("import { prisma } from '../prisma'\nimport { getServerSession } from 'next-auth'", "  if (!(await getServerSession())) throw new Error('no')\n  await prisma.project.update({ where: { id: formData.get('id') }, data: { name: formData.get('name') } })")],
  ['next-action-no-auth', 'cf-next', 'app/actions/search.js', ACTION("import { db } from '../db'", "  await db.users.delete({ id: 1 })"), ACTION("import { db } from '../db'", "  return db.query('SELECT * FROM products WHERE name = $1', [formData.get('name')])")],
  ['next-action-path-traversal', 'cf-next', 'app/actions/download.js', ACTION("import fs from 'node:fs/promises'\nimport path from 'node:path'", "  return fs.readFile(path.join('uploads', formData.get('name')))"), ACTION("import fs from 'node:fs/promises'\nimport path from 'node:path'", "  return fs.readFile(path.join('uploads', path.basename(String(formData.get('name')))))")],
  ['next-action-path-traversal', 'cf-next', 'app/actions/save.js', ACTION("import fs from 'node:fs/promises'", "  const name = String(formData.get('name'))\n  await fs.writeFile(`uploads/${name}`, 'x')"), ACTION("import fs from 'node:fs/promises'", "  const name = 'report.txt'\n  await fs.writeFile(`uploads/${name}`, 'x')")],
  ['next-action-path-traversal', 'cf-next', 'app/actions/read.js', ACTION("import fs from 'node:fs/promises'\nimport path from 'node:path'", "  const target = path.resolve('uploads', formData.get('f'))\n  return fs.readFile(target)"), ACTION("import fs from 'node:fs/promises'\nimport path from 'node:path'", "  const target = path.resolve('uploads', String(formData.get('f')))\n  if (!target.startsWith(path.resolve('uploads'))) throw new Error('bad path')\n  return fs.readFile(target)")],
]

describe('every rule proves itself on its own samples', () => {
  for (const id of IDS) {
    test(`${id} table: bad sample found, good sample not found`, () => {
      expect(selfProve(CHECK_TABLES[id])).toEqual([])
    })
  }
  test('rule ids are unique across the family and each check has rules', () => {
    const all = IDS.flatMap((id) => CHECK_TABLES[id].map((r: { id: string }) => r.id))
    expect(new Set(all).size).toBe(all.length)
    for (const id of IDS) expect(CHECK_TABLES[id].length).toBeGreaterThan(0)
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

describe('both sides: planted shapes are found, their safe twins are not', () => {
  for (const [rule, check, file, bad, good] of CASES) {
    test(`${rule} in ${file}`, () => {
      expect(fired(check, file, bad)).toContain(rule)
      expect(fired(check, file, good)).not.toContain(rule)
    })
  }
  test('every rule has at least one both-sides case', () => {
    const covered = new Set(CASES.map((c) => c[0]))
    for (const id of IDS) for (const r of CHECK_TABLES[id]) expect(covered.has(r.id), `${r.id} has a case`).toBe(true)
  })
})

describe('a clean project passes for real', () => {
  const clean: Record<string, string> = {}
  for (const c of CASES) clean[c[2]] = c[4]
  // One file per path: several cases share a path with different safe text, the last one wins, which is still a clean file.
  const dir = newFolder(clean)
  for (const id of IDS) {
    test(`${id} exits 0 on the safe twins together`, () => {
      const r = runCheck([id, '--root', dir])
      expect(r.out).toMatch(/MEERKAT-SUB PASS/)
      expect(r.code).toBe(0)
    })
  }
})

describe('hostile input stays linear', () => {
  test('every rule scans a 100 KB single line quickly', () => {
    const hostile = `${'a'.repeat(100_000)} ${"'\"`".repeat(5000)}${' '.repeat(20000)}`
    const names = ['big.js', 'big.jsx', 'AndroidManifest.xml', '.env']
    const dir = newFolder(Object.fromEntries(names.map((n) => [n, `import x from 'react'\n'use server'\n${hostile}`])))
    const started = Date.now()
    for (const id of IDS) evaluate(dir, CHECK_TABLES[id], { files: names })
    expect(Date.now() - started).toBeLessThan(3000)
  })
})

describe('the client-frameworks pack', () => {
  test('loads three checks with their sub-check counts and a self test', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'client-frameworks'))
    expect(checks.map((c: { id: string }) => c.id).sort()).toEqual([...IDS].sort())
    for (const c of checks as any[]) {
      expect(c.subs).toBe(CHECK_TABLES[c.id as keyof typeof CHECK_TABLES].length)
      expect(c.selfTest.expectFail).toBe(true)
    }
  })
  test('no file of the family uses an em dash', () => {
    for (const f of [SCRIPT, 'thorough/rules-client-frameworks.mjs', 'packs/client-frameworks/client-frameworks.mjs', 'tests/clientframeworks.test.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8')).not.toContain(String.fromCharCode(8212))
    }
  })
})
