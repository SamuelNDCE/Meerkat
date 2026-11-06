// Regression tests for the false positives and self-test weaknesses found in the NeuralVault run (2026-11). Each case builds a small folder of its own.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { isPlaceholderValue } from '../thorough/kit.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function folder(files: Record<string, string>, git = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fd-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  if (git) {
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' })
    g('init', '-q')
    g('config', 'user.email', 'a@b.c')
    g('config', 'user.name', 't')
    g('config', 'core.autocrlf', 'false')
    g('add', '-f', '.')
    g('commit', '-q', '-m', 'Add the backup PUBLIC key')
  }
  return dir
}

function run(script: string, check: string | null, dir: string | null, extra: string[] = []): { code: number; out: string } {
  const args = [join(ROOT, script), ...(check ? [check] : []), ...(dir ? ['--root', dir] : []), ...extra]
  try {
    const out = execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') }
  }
}

describe('A: risky-code and comments', () => {
  const jsx = (body: string) => `export function C() {\n  return (\n    <div>\n      <p>Don't panic</p>\n${body}\n    </div>\n  )\n}\n`
  test('dangerouslySetInnerHTML named in a JSX comment is not reported, even when JSX text holds an apostrophe', () => {
    const dir = folder({ 'ChatPage.tsx': jsx('      {/* we avoid dangerouslySetInnerHTML here */}\n      {/*\n        dangerouslySetInnerHTML is not used\n      */}\n      <p>It\'s "fine"</p>') })
    expect(run('thorough/static.mjs', 'risky-code', dir).code).toBe(0)
  })
  test('JS and TS line and block comments are skipped, a real use next to a JSX apostrophe is still reported', () => {
    const ok = folder({ 'a.ts': '// dangerouslySetInnerHTML\n/* dangerouslySetInnerHTML */\nconst x = 1\n', 'b.jsx': "// don't use dangerouslySetInnerHTML\nconst y = 2\n" })
    expect(run('thorough/static.mjs', 'risky-code', ok).code).toBe(0)
    const bad = folder({ 'ChatPage.tsx': jsx('      <div dangerouslySetInnerHTML={{ __html: html }} />') })
    expect(run('thorough/static.mjs', 'risky-code', bad).code).toBe(1)
  })
})

describe('B: placeholder values are not secrets', () => {
  test('isPlaceholderValue: words, filler, and a random value that is NOT a placeholder', () => {
    for (const v of ['server-key-for-test', 'changeme', 'my_example_key', 'dummy-token', 'fake_secret_1', 'placeholder', 'xxxxxxxx', 'aaaaaaaaaa', 'your-api-key']) expect(isPlaceholderValue(v), v).toBe(true)
    for (const v of ['q8Zr2LmX9vT4kP0w', 'Zx9fQ2mLp8Rt4VbN7cHd', 'latest9fK2mQzR8wT', 'contestK4p9Xz2Lm7']) expect(isPlaceholderValue(v), v).toBe(false)
  })
  test('git-history-secrets: a placeholder under a secret name passes, a real-looking value still fails', () => {
    const ok = folder({ 'cfg.js': 'const apiKey = "server-key-for-test"\nconst secret = "changeme"\n' }, true)
    expect(run('thorough/sec-supply.mjs', 'git-history-secrets', ok).code).toBe(0)
    const bad = folder({ 'cfg.js': 'const apiKey = "Zx9fQ2mLp8Rt4VbN7cHd"\n' }, true)
    expect(run('thorough/sec-supply.mjs', 'git-history-secrets', bad).code).toBe(1)
  })
  test('secret-scan: a long placeholder value passes, a long random one still fails', () => {
    const ok = folder({ 'cfg.js': 'const apiKey = "Zx9fQ2mLp8Rt4VbN7cHd-for-test"\n' })
    expect(run('thorough/secret-scan.mjs', null, ok).code).toBe(0)
    const bad = folder({ 'cfg.js': 'const apiKey = "Zx9fQ2mLp8Rt4VbN7cHdKj3Ws5Ye"\n' })
    expect(run('thorough/secret-scan.mjs', null, bad).code).toBe(1)
  })
})

describe('C: weak-crypto-modes and ids', () => {
  test('Math.random as the fallback for crypto.randomUUID (an id) is not reported; a token still is', () => {
    const ok = folder({ 'chat-attachments.ts': "export function newAttachmentId(): string {\n  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {\n    return crypto.randomUUID()\n  }\n  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`\n}\n" })
    expect(run('thorough/sec-code.mjs', 'weak-crypto-modes', ok).code).toBe(0)
    const bad = folder({ 'a.ts': 'const apiToken = Math.random().toString(36)\nconst resetCode = Math.random().toString(36)\nconst sessionId = Math.random().toString(36)\n' })
    const r = run('thorough/sec-code.mjs', 'weak-crypto-modes', bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('a.ts:1')
    expect(r.out).toContain('a.ts:2')
    expect(r.out).toContain('a.ts:3')
  })
})

describe('E: markers', () => {
  test('an error code like (NV-XXX-000) in a comment or a string is not a marker; a real FIXME or XXX note is', () => {
    const ok = folder({ 'AccountSignIn.tsx': '// Show the error code (NV-XXX-000) to the user.\nconst msg = "NV-XXX-000" // see docs\nconst s = "FIXME"\n' })
    expect(run('thorough/hygiene.mjs', 'markers', ok).code).toBe(0)
    const bad = folder({ 'a.js': '// FIXME: remove this\nconst a = 1 // XXX temporary\n' })
    const r = run('thorough/hygiene.mjs', 'markers', bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('a.js:1')
    expect(r.out).toContain('a.js:2')
  })
})

describe('F: public keys and certificates are not private keys', () => {
  const pub = '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEabc\n-----END PUBLIC KEY-----\n'
  const cert = '-----BEGIN CERTIFICATE-----\nMIIBabc\n-----END CERTIFICATE-----\n'
  const priv = '-----BEGIN PRIVATE KEY-----\nMIIBabc\n-----END PRIVATE KEY-----\n'
  test('sensitive-files: BEGIN PUBLIC KEY and BEGIN CERTIFICATE pass, BEGIN PRIVATE KEY fails', () => {
    const ok = folder({ 'scripts/backup/backup-public-key.pem': pub, 'ca.pem': cert }, true)
    expect(run('thorough/hygiene.mjs', 'sensitive-files', ok).code).toBe(0)
    const bad = folder({ 'scripts/backup/backup.pem': priv }, true)
    expect(run('thorough/hygiene.mjs', 'sensitive-files', bad).code).toBe(1)
  })
  test('env-files-in-history: a commit that adds a public key or certificate is not reported, one that adds a private key is', () => {
    const ok = folder({ 'backup-public-key.pem': pub, 'ca.pem': cert }, true)
    expect(run('thorough/sec-supply.mjs', 'env-files-in-history', ok).code).toBe(0)
    const bad = folder({ 'backup.pem': priv }, true)
    expect(run('thorough/sec-supply.mjs', 'env-files-in-history', bad).code).toBe(1)
  })
})

describe('G: js-spawn-shell', () => {
  test('spawnSync("cf", args, { shell: true }) with args a fixed array of literals is not reported; a variable inside it, or a changed array, is', () => {
    const ok = folder({ 'ok.js': "const args = ['deploy', '--json']\nspawnSync('cf', args, { shell: true })\n" })
    expect(run('thorough/code-patterns.mjs', 'cp-js', ok).out).not.toContain('FAIL js-spawn-shell')
    const bad = folder({ 'a.js': "const args = ['deploy', process.argv[2]]\nspawnSync('cf', args, { shell: true })\n", 'b.js': "const args = ['deploy']\nargs.push(user)\nspawnSync('cf', args, { shell: true })\n", 'c.js': "spawnSync('cf', [name], { shell: true })\n" })
    const r = run('thorough/code-patterns.mjs', 'cp-js', bad)
    expect(r.out).toContain('a.js:2')
    expect(r.out).toContain('b.js:3')
    expect(r.out).toContain('c.js:1')
  })
})

describe('H: sql-concat and quoted identifiers', () => {
  const helper = "const qIdent = (s) => '\"' + String(s).replace(/\"/g, '\"\"') + '\"'\n"
  test('table and column names passed through qIdent are not reported', () => {
    const ok = folder({ 'ok.js': helper + 'export function a(db, table, cols) {\n  db.query(`SELECT ${cols.map(qIdent).join(", ")} FROM ${qIdent(table)} WHERE id = $1`, [1])\n  db.query("SELECT * FROM " + qIdent(table) + " WHERE id = ?", [1])\n}\n' })
    expect(run('thorough/sec-code.mjs', 'sql-concat', ok).code).toBe(0)
  })
  test('a value concatenated into the SQL next to a qIdent name is still reported', () => {
    const bad = folder({ 'bad.js': helper + 'export function a(db, table, id) {\n  db.query(`SELECT * FROM ${qIdent(table)} WHERE id = ${id}`)\n  db.query("SELECT * FROM " + qIdent(table) + " WHERE id = " + id)\n}\n' })
    const r = run('thorough/sec-code.mjs', 'sql-concat', bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('bad.js:3')
    expect(r.out).toContain('bad.js:4')
  })
})

describe('I: open-redirect-pattern', () => {
  const route = (line: string) => `import { NextResponse } from 'next/server'\nexport async function GET(request: Request) {\n  const { searchParams, origin } = new URL(request.url)\n${line}\n}\n`
  test('a target that came through safeNext() (an allow-list) is not reported, even inside new URL(next, origin)', () => {
    const ok = folder({ 'app/auth/callback/route.ts': route("  const next = safeNext(searchParams.get('next'))\n  return NextResponse.redirect(new URL(next, origin))") })
    expect(run('thorough/sec-code.mjs', 'open-redirect-pattern', ok).code).toBe(0)
  })
  test('new URL(x, origin) can leave the origin when x is an absolute address, so a raw request value in it is still reported', () => {
    const bad = folder({ 'app/auth/callback/route.ts': route("  const next = searchParams.get('next')\n  return NextResponse.redirect(new URL(next, origin))") })
    expect(run('thorough/sec-code.mjs', 'open-redirect-pattern', bad).code).toBe(1)
  })
})

describe('J: self-tests prove detection', () => {
  test('secret-scan --fixtures names the planted rules, even from a folder that is not a git repository', () => {
    const dir = folder({ 'x.txt': 'x' })
    const r = run('thorough/secret-scan.mjs', null, null, ['--fixtures'])
    expect(r.code).toBe(1)
    expect(r.out).toContain('planted secrets found by rule')
    expect(r.out).not.toContain('not a git repository')
    void dir
  })
  test('npm-audit --fixtures plants a high-severity advisory: it exits 1 when found, or 75 NOT RUN when npm cannot run; never 0', () => {
    const r = run('thorough/npm-audit.mjs', null, null, ['--fixtures'])
    expect([1, 75]).toContain(r.code)
    if (r.code === 1) expect(r.out).toContain('planted high-severity vulnerability')
    else expect(r.out).toContain('NOT RUN')
  }, 90_000)
})

describe('K: wh-publish-root', () => {
  test('source maps in a cache folder are not counted, and the failing line names the folder it counted', () => {
    const dir = folder({ 'dist/app.js': 'x', 'build/a.js.map': '{}', '.next/cache/build/b.js.map': '{}', '.cache/build/c.js.map': '{}' })
    const r = run('thorough/web-hardening.mjs', 'wh-publish-root', dir)
    expect(r.out).toContain('sourcemap-in-publish 1 found in build/ (1)')
    expect(r.out).not.toContain('.next/cache')
  })
})

describe('L: ui-static', () => {
  const page = '<html lang="en"><head></head><body><p>hi</p></body></html>'
  test('HTML email templates (emails/) are not asked for a title or viewport; a normal page still is', () => {
    const ok = folder({ 'emails/welcome.html': page })
    expect(run('thorough/hygiene.mjs', 'ui-static', ok).code).toBe(0)
    const bad = folder({ 'web/index.html': page })
    expect(run('thorough/hygiene.mjs', 'ui-static', bad).code).toBe(1)
  })
  test('hygiene.uiStaticSkip globs in .meerkat-budgets.json skip a path (gen-og-card.html)', () => {
    const files = { 'tools/gen-og-card.html': page }
    expect(run('thorough/hygiene.mjs', 'ui-static', folder(files)).code).toBe(1)
    const skipped = folder({ ...files, '.meerkat-budgets.json': JSON.stringify({ hygiene: { uiStaticSkip: ['tools/gen-og-card.html'] } }) })
    expect(run('thorough/hygiene.mjs', 'ui-static', skipped).code).toBe(0)
  })
})
