// A detector's own source holds sample vulnerable code in string tables. The code-pattern checks leave a line alone when everything on it that is not punctuation is a
// string literal; a line with real code stays reported, and the secret check never uses this skip because there the string itself is the problem.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { blankStrings, stringOnlyLines } from '../thorough/kit.mjs'

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
  test('a tuple whose string is sample code is data, even with quotes inside; one whose string is not code is not', () => {
    expect(is(3)).toBe(true)
    expect(is(4)).toBe(false) // ("go", "x := 1") holds no call, so it could be configuration
  })
  test('code is not', () => {
    expect(is(1)).toBe(false)
    expect(is(7)).toBe(false)
  })
  test('the first line of a multi-line raw string that holds a call is data; its continuation without a call is judged on its own', () => {
    const m = stringOnlyLines('a.rs', ['let s = [', '    r#"res.cookie(\'a\', t,', '       { httpOnly: false })"#,', '];'].join('\n'))
    expect(m(2)).toBe(true)
    expect(m(3)).toBe(false) // no call on this line, so it is read like any other line
  })
  test('other file kinds are never data', () => {
    expect(stringOnlyLines('a.md', '"x"')(1)).toBe(false)
  })
})

describe('blankStrings', () => {
  const lines = (t: string, lang = 'js') => blankStrings(t, lang).split('\n')
  test('a nested template literal keeps the code after it as code', () => {
    const t = ['const a = `x ${ f(`b ${c}`) } y`', 'crypto.createCipher("aes192", pw)', 'const z = 1'].join('\n')
    const out = lines(t)
    expect(out[1]).toContain('crypto.createCipher(')
    expect(out[2]).toBe('const z = 1')
    expect(out[0]).toContain('f(')
  })
  test('a multi-line nested template does not swallow the lines below', () => {
    const t = ['const a = `line one', '  ${ g(`inner', '  text`) }', '  end`', 'res.cookie("s", t, { secure: false })'].join('\n')
    expect(lines(t)[4]).toContain('res.cookie(')
  })
  test('a backtick or an apostrophe in a comment opens nothing', () => {
    const t = ['// use `x` here, don\'t forget', 'danger(1)', '/* a `b */ danger(2)', 'danger(3)'].join('\n')
    const out = lines(t)
    expect(out[1]).toBe('danger(1)')
    expect(out[2]).toContain('danger(2)')
    expect(out[3]).toBe('danger(3)')
    expect(lines('# it\'s `py`\nprint(1)', 'py')[1]).toBe('print(1)')
  })
  test('a template literal that is never closed stays code', () => {
    const t = 'const a = `never closed\nexec(userInput)'
    expect(blankStrings(t, 'js')).toContain('exec(userInput)')
  })
  test('plain strings and Rust raw strings are blanked, lifetimes are not strings', () => {
    expect(lines('x("a b", \'c\')')[0].trim()).toBe('x(     ,    )')
    expect(lines('let s = r#"say "hi" there"#;', 'rs')[0].replace(/ +/g, ' ')).toBe('let s = ;')
    expect(lines("fn f<'a, 'b>(x: &'a str)", 'rs')[0]).toContain('fn f<')
  })
  test('the text length and the newlines never change', () => {
    const t = 'a `b\nc ${ d } e` f "g" r#"h\ni"# \'j\'\n'
    expect(blankStrings(t).length).toBe(t.length)
    expect(blankStrings(t).split('\n').length).toBe(t.split('\n').length)
  })
})

describe('review of PR 46: shapes that look like tables but are real configuration or code', () => {
  const lines = (t: string, lang = 'js') => blankStrings(t, lang).split('\n')
  test('a Rust configuration struct field with a string value is code', () => {
    const t = ['let cors = Cors {', '    origin: "*",', '    credentials: true,', '};', 'let algorithm = Config {', '    algorithm: "none",', '};'].join('\n')
    const is = stringOnlyLines('src/cors.rs', t)
    expect(is(2)).toBe(false)
    expect(is(6)).toBe(false)
  })
  test('header lists in Python, JavaScript and Rust are code, not sample tables', () => {
    expect(stringOnlyLines('app.py', 'start_response("200 OK", [\n    ("Access-Control-Allow-Origin", "*"),\n    ("Access-Control-Allow-Credentials", "true"),\n])')(2)).toBe(false)
    expect(stringOnlyLines('app.js', "res.writeHead(200, [\n  ['Set-Cookie', 'sid=abc'],\n])")(2)).toBe(false)
    expect(stringOnlyLines('h.rs', 'let headers = [\n    ("Access-Control-Allow-Origin", "*"),\n];')(2)).toBe(false)
  })
  test('a sample of code in a table is still a table', () => {
    expect(stringOnlyLines('t.rs', 'const S: &[(&str, &str)] = &[\n    ("js", r#"res.cookie(\'s\', t, { secure: false });"#),\n];')(2)).toBe(true)
    expect(stringOnlyLines('t.rs', 'CRule {\n    bad: &[(r#"js"#, r#"res.cookie(\'s\', t, { secure: false });"#)],\n}')(2)).toBe(true)
  })
  test('a lone backtick in a comment does not turn the next lines into data', () => {
    const t = ['// strip the ` character', 'res.cookie("session", token, { httpOnly: false })', 'const q = `ok`'].join('\n')
    expect(stringOnlyLines('a.js', t)(2)).toBe(false)
    expect(lines('"""a ` b"""\nprint(1)', 'py')[1]).toBe('print(1)')
  })
  test('a Go raw string ends at the next backtick, a backslash is not an escape', () => {
    const t = ['p := `C:\\dir\\`', 'http.SetCookie(w, &http.Cookie{Name: "s", Value: t})', 'q := `x`'].join('\n')
    const out = lines(t, 'go')
    expect(out[1]).toContain('http.SetCookie(')
    expect(out[0].trim()).toBe('p :=')
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
  test('a template literal with a hole does not turn the code after it into data', () => {
    const t = ['const a = `x ${y} z`', 'crypto.createCipher("aes192", pw)', 'const b = `plain`', 'res.cookie("s", t, { httpOnly: false })'].join('\n')
    const is = stringOnlyLines('a.js', t)
    expect(is(2)).toBe(false)
    expect(is(4)).toBe(false)
    expect(status('weak-crypto-modes', { 'src/a.js': `${t}\n` })).toBe(1)
  })
  test('a user name and password in a URL string is still reported in a table', () => {
    expect(status('credentials-in-urls', { 'src/samples.rs': 'pub const S: &[(&str, &str)] = &[\n    ("a.js", "const u = \'postgres://admin:Sup3rS3cretPw@db.acme.io/app\';"),\n];\n' })).toBe(1)
  })
})
