// Round 5c: false alarms found by auditing a scan of a real project. Every fix has both sides: the false-alarm shape reports nothing,
// and a genuine defect of the same rule still reports.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { EP_FUSES_BUILD } from '../thorough/rules-electron-plus.mjs'
import { evaluate } from '../thorough/rules.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-r5c-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

function run(script: string, check: string, root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, check, '--root', root], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

// Narrowing used here: an explicit file-NAME convention (insecure_code*.rs, vulnerable_samples*.rs, bad_examples*.rs) plus code shape (only text inside a
// Rust string literal is sample data). No file or folder is skipped as a whole.
describe('security pattern rules: insecure sample text in a rule-fixture .rs file', () => {
  const SAMPLES = [
    ['cors-wildcard', "app.use(cors({ origin: '*', credentials: true }));"],
    ['sql-concat', 'db.query("SELECT * FROM users WHERE id = " + id);'],
    ['jwt-weak', "const payload = jwt.verify(token, secret, { algorithms: ['none'] });"],
    ['regex-dos', 'const re = /^(a+)+$/;'],
    ['open-redirect-pattern', "app.get('/go', (req, res) => res.redirect(req.query.next));"],
  ] as const

  for (const [id, snippet] of SAMPLES) {
    const asString = `pub const SAMPLES: &[(&str, &str)] = &[("js", r#"${snippet}"#)];\n`
    test(`${id}: the snippet held as a string in guard/insecure_code.rs is not a finding`, () => {
      const r = run('thorough/sec-code.mjs', id, folderWith({ 'src/guard/insecure_code.rs': asString }))
      expect(r.code, r.out).toBe(0)
    })
    test(`${id}: the same snippet as code in a normal js file still reports`, () => {
      const r = run('thorough/sec-code.mjs', id, folderWith({ 'src/server.js': `${snippet}\n` }))
      expect(r.code, r.out).toBe(1)
    })
  }

  test('cookie-flags: a PHP setcookie sample string in insecure_code_classes.rs is not a finding', () => {
    const body = 'pub const S: &[&str] = &[r#"setcookie(\'auth\', $token, 0, \'/\', \'\', false, false);"#];\n'
    expect(run('thorough/sec-code.mjs', 'cookie-flags', folderWith({ 'src/guard/insecure_code_classes.rs': body })).code).toBe(0)
  })

  test('a real insecure call written as CODE (not a string) inside an insecure_code*.rs file still reports', () => {
    const body = 'fn handler() {\n    let c = Cookie::new("s", token);\n}\n'
    const r = run('thorough/sec-code.mjs', 'cookie-flags', folderWith({ 'src/guard/insecure_code.rs': body }))
    expect(r.code, r.out).toBe(1)
  })

  test('a string passed to a call in a normally named .rs file still reports (a string-only table line is skipped everywhere, a call argument is not)', () => {
    const body = 'fn q() {\n    send(r#"res.cookie(\'s\', t, { secure: false });"#);\n}\n'
    const r = run('thorough/sec-code.mjs', 'cookie-flags', folderWith({ 'src/rules.rs': body }))
    expect(r.code, r.out).toBe(1)
  })
})

describe('sql-destructive-migrations', () => {
  const DROP_IN_COMMENT = '/*\n * ROLLBACK:\n *   drop table if exists public.money_sweep_settings;\n */\ncreate table public.t (id int);\n'
  test('a DROP listed inside a block-comment ROLLBACK note is not a finding', () => {
    const r = run('thorough/api.mjs', 'sql-destructive-migrations', folderWith({ 'migrations/20261007_a.sql': DROP_IN_COMMENT }))
    expect(r.code, r.out).toBe(0)
  })
  test('a real DROP TABLE statement in a migration still reports', () => {
    const r = run('thorough/api.mjs', 'sql-destructive-migrations', folderWith({ 'migrations/20261007_a.sql': `${DROP_IN_COMMENT}drop table public.users;\n` }))
    expect(r.code, r.out).toBe(1)
  })
  const GUARDED = "do $$ begin\n  if coalesce(current_setting('nv.confirm_undo_auto_topup', true), '') <> 'yes' then\n    raise exception 'set nv.confirm_undo_auto_topup first';\n  end if;\nend $$;\ndrop table if exists public.auto_topup_charges;\n"
  test('an undo_* script that refuses to run without a confirm setting is not a finding', () => {
    const r = run('thorough/api.mjs', 'sql-destructive-migrations', folderWith({ 'migrations/undo_20261015_auto_topup.sql': GUARDED }))
    expect(r.code, r.out).toBe(0)
  })
  test('an undo_* script with no guard still reports', () => {
    const r = run('thorough/api.mjs', 'sql-destructive-migrations', folderWith({ 'migrations/undo_20261015_auto_topup.sql': 'drop table if exists public.auto_topup_charges;\n' }))
    expect(r.code, r.out).toBe(1)
  })
  test('the same guarded text in a forward (non-undo) migration still reports', () => {
    const r = run('thorough/api.mjs', 'sql-destructive-migrations', folderWith({ 'migrations/20261015_auto_topup.sql': GUARDED }))
    expect(r.code, r.out).toBe(1)
  })
})

describe('Electron build rules apply only to a real Electron app', () => {
  const ids = (files: Record<string, string>) => new Set(evaluate(folderWith(files), EP_FUSES_BUILD).found.map((f: { rule: string }) => f.rule))
  const NOT_ELECTRON = ['ep-fuses-not-configured', 'ep-builder-product-name-missing', 'ep-builder-copyright-missing']

  test('a VS Code extension package.json with a build script reports none of the three', () => {
    const got = ids({ 'apps/vscode/package.json': JSON.stringify({ name: 'ext', engines: { vscode: '^1.90.0' }, scripts: { build: 'tsc' }, devDependencies: { '@types/vscode': '^1.90.0' } }, null, 2) })
    for (const r of NOT_ELECTRON) expect(got.has(r), r).toBe(false)
  })
  test('a Tauri app package.json with a "build" key reports none of the three', () => {
    const got = ids({ 'apps/web/package.json': JSON.stringify({ name: 'web', scripts: { build: 'vite build', tauri: 'tauri' }, build: { target: 'es2022' }, devDependencies: { '@tauri-apps/cli': '2.0.0' } }, null, 2) })
    for (const r of NOT_ELECTRON) expect(got.has(r), r).toBe(false)
  })
  test('a real Electron app package.json with electron-builder config still reports all three', () => {
    const got = ids({ 'package.json': JSON.stringify({ name: 'app', main: 'main.js', devDependencies: { electron: '41.0.0', 'electron-builder': '25.0.0' }, build: { appId: 'com.acme.notes' } }, null, 2) })
    for (const r of NOT_ELECTRON) expect(got.has(r), r).toBe(true)
  })
})

describe('review fixes: the narrowing must not hide real defects', () => {
  test('insecure_code.rs: real code with insecure strings in a normal function still reports', () => {
    const cors = 'fn h(resp: &mut Resp) {\n    resp.header("Access-Control-Allow-Origin", "*");\n    resp.header("Access-Control-Allow-Credentials", "true");\n}\n'
    expect(run('thorough/sec-code.mjs', 'cors-wildcard', folderWith({ 'src/guard/insecure_code.rs': cors })).code).toBe(1)
    const sql = 'fn q(id: &str) -> String {\n    format!("SELECT * FROM u WHERE id={}", id)\n}\n'
    expect(run('thorough/sec-code.mjs', 'sql-concat', folderWith({ 'src/guard/insecure_code.rs': sql })).code).toBe(1)
  })
  test('insecure_code.rs: a data table is still blanked, and a quote char literal does not shift the pairing', () => {
    const body = "fn f() -> char { '\"' }\nconst BAD: &[(&str, &str)] = &[(\"js\", \"res.cookie('s', t, { secure: false });\")];\n"
    expect(run('thorough/sec-code.mjs', 'cookie-flags', folderWith({ 'src/guard/insecure_code.rs': body })).code).toBe(0)
    const real = "fn f() -> char { '\"' }\nfn g() { let c = Cookie::new(\"s\", t); }\n"
    expect(run('thorough/sec-code.mjs', 'cookie-flags', folderWith({ 'src/guard/insecure_code.rs': real })).code).toBe(1)
  })
  test('undo script: a guard that only appears in a comment does not excuse the DROP', () => {
    const sql = "-- current_setting('x.confirm') raise exception\ndrop table users;\n"
    expect(run('thorough/api.mjs', 'sql-destructive-migrations', folderWith({ 'migrations/undo_1_x.sql': sql })).code).toBe(1)
  })
  test('undo script: a guard placed AFTER the DROP does not excuse it', () => {
    const sql = "drop table users;\nselect current_setting('x.confirm', true);\ndo $$ begin raise exception 'no'; end $$;\n"
    expect(run('thorough/api.mjs', 'sql-destructive-migrations', folderWith({ 'migrations/undo_1_x.sql': sql })).code).toBe(1)
  })
  test("a '/*' inside a string does not hide a DROP between two strings", () => {
    const sql = "select '/*'; drop table users; select '*/';\n"
    expect(run('thorough/api.mjs', 'sql-destructive-migrations', folderWith({ 'migrations/20261007_a.sql': sql })).code).toBe(1)
  })
  test('monorepo: electron declared in the workspace root makes the app package an Electron app', () => {
    const files = {
      'package.json': JSON.stringify({ name: 'root', private: true, workspaces: ['apps/*'], devDependencies: { electron: '41.0.0' } }, null, 2),
      'apps/desk/package.json': JSON.stringify({ name: 'desk', build: { appId: 'com.acme.desk' } }, null, 2),
    }
    const got = new Set(evaluate(folderWith(files), EP_FUSES_BUILD).found.map((f: { rule: string }) => f.rule))
    expect(got.has('ep-builder-product-name-missing')).toBe(true)
    const vite = { 'package.json': JSON.stringify({ name: 'v', devDependencies: { 'electron-vite': '2.0.0' }, build: { appId: 'a.b.c' } }, null, 2) }
    expect(new Set(evaluate(folderWith(vite), EP_FUSES_BUILD).found.map((f: { rule: string }) => f.rule)).has('ep-fuses-not-configured')).toBe(true)
  })
})

describe('rules whose finding is the literal value', () => {
  test('a hardcoded IP or URL credential in an insecure_code*.rs string table is still read raw', () => {
    const body = 'pub const S: &[&str] = &["connect to 45.33.12.9 now"];\n'
    expect(run('thorough/sec-code.mjs', 'hardcoded-ip', folderWith({ 'src/guard/insecure_code.rs': body })).code).toBe(1)
  })
})
