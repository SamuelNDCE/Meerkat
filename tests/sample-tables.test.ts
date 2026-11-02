// A detector's own source holds sample vulnerable code in string tables. The code-pattern checks leave a line alone when everything on it that is not punctuation is a
// string literal; a line with real code stays reported, and the secret check never uses this skip because there the string itself is the problem.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { stringOnlyLines } from '../thorough/kit.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const status = (check: string, files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-st-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  try {
    execFileSync(process.execPath, ['thorough/sec-code.mjs', check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

describe('stringOnlyLines', () => {
  const t = ['fn samples() -> Vec<(&str, &str)> {', '    vec![', '        ("js", r##"db.query("SELECT 1 " + id);"##),', '        ("go", "x := 1"),', '    ]', '}', 'let q = format!("a") + user_input;'].join('\n')
  const is = stringOnlyLines('a.rs', t)
  test('a tuple of strings is data, even with quotes and calls inside the strings', () => {
    expect(is(3)).toBe(true)
    expect(is(4)).toBe(true)
  })
  test('code is not', () => {
    expect(is(1)).toBe(false)
    expect(is(7)).toBe(false)
  })
  test('the inside of a multi-line raw string is data', () => {
    const m = stringOnlyLines('a.rs', ['let s = [', '    r#"res.cookie(\'a\', t,', '       { httpOnly: false })"#,', '];'].join('\n'))
    expect(m(2)).toBe(true)
    expect(m(3)).toBe(true)
  })
  test('other file kinds are never data', () => {
    expect(stringOnlyLines('a.md', '"x"')(1)).toBe(false)
  })
})

describe('sec-code pattern checks and sample tables', () => {
  const bad = 'res.cookie("session", token, { httpOnly: false })'
  test('a cookie pattern inside a Rust sample table is not reported', () => {
    expect(status('cookie-flags', { 'src/samples.rs': `pub const S: &[(&str, &str)] = &[\n    ("js", r#"${bad};"#),\n];\n` })).toBe(0)
  })
  test('the same call as real code in a JavaScript file is', () => {
    expect(status('cookie-flags', { 'src/app.js': `${bad}\n` })).toBe(1)
  })
  test('a configuration key with a string value is code in JavaScript and Python, not a table', () => {
    expect(status('cors-wildcard', { 'src/app.js': "app.use(cors({\n  origin: '*',\n  credentials: true,\n}))\n" })).toBe(1)
    expect(status('jwt-weak', { 'src/auth.js': "jwt.verify(token, secret, {\n  algorithms: ['none'],\n})\n" })).toBe(1)
  })
  test('a template literal with a ${} hole is code, and an IP address written as a string is still reported', () => {
    const is = stringOnlyLines('a.ts', 'const q = `SELECT * FROM t WHERE id = ${id}`\nconst s = `plain text`')
    expect(is(1)).toBe(false)
    expect(status('hardcoded-ip', { 'src/hosts.js': "module.exports = [\n  '45.33.12.9',\n]\n" })).toBe(1)
  })
  test('a user name and password in a URL string is still reported in a table', () => {
    expect(status('credentials-in-urls', { 'src/samples.rs': 'pub const S: &[(&str, &str)] = &[\n    ("a.js", "const u = \'postgres://admin:Sup3rS3cretPw@db.acme.io/app\';"),\n];\n' })).toBe(1)
  })
})
