// Round 5b false alarms found by auditing a scan of a real project: each fix is tested on both sides, the false-alarm shape stays quiet
// and a genuine defect of the same rule still reports.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs one check of one script over a folder holding the given files; returns the exit code and what it printed.
function run(script: string, check: string, files: Record<string, string>): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-r5b-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  try {
    const out = execFileSync(process.execPath, [`thorough/${script}`, check, '--root', dir], { cwd: ROOT, stdio: 'pipe' }).toString()
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('pii-in-logs', () => {
  const pii = (files: Record<string, string>) => run('privacy.mjs', 'pii-in-logs', files)
  test('a UI card variable is not a payment card', () => {
    expect(pii({ 'a.mjs': 'console.error(`could not sweep the probe card ${CARD}: ${e.message}`)\n' }).code).toBe(0)
  })
  test('secret-looking words inside template text are not a logged value', () => {
    expect(pii({ 'a.ts': 'console.warn(`stripe-webhook: autotopup_save_card failed: ${error.message}`)\n' }).code).toBe(0)
  })
  test('a redaction list passed to a sanitiser is not a leak', () => {
    expect(pii({ 'a.rs': 'fn f() {\n    print(&redact_path_text(raw, secrets), json)\n}\n' }).code).toBe(0)
  })
  test('a sample string spanning lines in Rust is not a log call', () => {
    expect(pii({ 'a.rs': 'const S: &str = r#"\nprintln(token)\n"#;\n' }).code).toBe(0)
  })
  test('still reports a secret interpolated into a log, a card number, and a raw secrets list', () => {
    expect(pii({ 'a.js': 'console.log(`signed in ${userEmail}`)\n' }).code).toBe(1)
    expect(pii({ 'a.js': 'console.log("pay", cardNumber)\n' }).code).toBe(1)
    expect(pii({ 'a.js': 'console.log(JSON.stringify(secrets))\n' }).code).toBe(1)
    expect(pii({ 'a.js': 'console.log(token)\n' }).code).toBe(1)
  })
})

describe('pii-in-logs review fixes: defects still report', () => {
  const pii = (files: Record<string, string>) => run('privacy.mjs', 'pii-in-logs', files).code
  test('Rust macros are log calls, and a char literal quote does not hide a later log', () => {
    expect(pii({ 'a.rs': 'fn f() {\n    println!("{}", token);\n}\n' })).toBe(1)
    expect(pii({ 'a.rs': 'fn f() {\n    tracing::info!("x {}", password);\n}\n' })).toBe(1)
    expect(pii({ 'a.rs': 'fn f() {\n    let c = \'"\'; println!("{}", token); let s = "x";\n}\n' })).toBe(1)
    expect(pii({ 'a.rs': 'fn f() {}\n#[cfg(test)]\nmod t {\n    fn g() { println!("{}", token); }\n}\n' })).toBe(0)
  })
  test('payment card shapes report, including dotted paths', () => {
    expect(pii({ 'a.js': 'console.log(card.number)\n' })).toBe(1)
    expect(pii({ 'a.js': 'console.log(card.cvv)\n' })).toBe(1)
    expect(pii({ 'a.js': 'console.log(stripeCard)\n' })).toBe(1)
    expect(pii({ 'a.js': 'console.log(cvc)\n' })).toBe(1)
    expect(pii({ 'a.js': 'console.log(card.title)\n' })).toBe(0)
  })
  test('only an explicit redact/mask call exempts a value', () => {
    expect(pii({ 'a.js': 'console.log(sanitizeEmail(email))\n' })).toBe(1)
    expect(pii({ 'a.js': 'console.log(redactEmail(email))\n' })).toBe(0)
  })
})

describe('duplicate-test-names regex literal', () => {
  test('a regex with a brace does not end the describe scope', () => {
    const text = "describe('a', () => {\n  it('x', () => { expect(s).toMatch(/\\}/) })\n  it('x', () => {})\n})\ndescribe('b', () => {\n  it('x', () => {})\n})\n"
    expect(run('quality.mjs', 'duplicate-test-names', { 'a.test.ts': text }).code).toBe(1)
    const ok = "describe('a', () => {\n  it('x', () => { expect(s).toMatch(/\\}/) })\n})\ndescribe('b', () => {\n  it('x', () => {})\n})\n"
    expect(run('quality.mjs', 'duplicate-test-names', { 'a.test.ts': ok }).code).toBe(0)
  })
})

describe('ui-static', () => {
  const ui = (files: Record<string, string>) => run('hygiene.mjs', 'ui-static', files)
  test('tests and mockups are skipped', () => {
    expect(ui({ 'src/Chip.test.tsx': 'const x = <img src="a.png">\n' }).code).toBe(0)
    expect(ui({ 'docs/design/mockups/m.html': '<html><body><img src="a.png"></body></html>' }).code).toBe(0)
  })
  test('a shipped page with an image and no alt still reports', () => {
    expect(ui({ 'public/p.html': '<html><body><img src="a.png"></body></html>' }).code).toBe(1)
  })
})

describe('table-headers and render-blocking', () => {
  const table = '<table><tr><td>Name</td><td>Role</td></tr></table>\n'
  test('table-headers skips mockups but still reports a shipped headerless table', () => {
    expect(run('a11y.mjs', 'table-headers', { 'docs/design/mockups/m.html': table }).code).toBe(0)
    expect(run('a11y.mjs', 'table-headers', { 'index.html': table }).code).toBe(1)
  })
  test('render-blocking ignores XSS payload strings in tests but reports a real blocking head script', () => {
    expect(run('a11y.mjs', 'render-blocking', { 'GitStrip.test.tsx': "ok(prOf({ title: '<img src=x onerror=alert(1)>' }))\n" }).code).toBe(0)
    expect(run('a11y.mjs', 'render-blocking', { 'index.html': '<html><head><script src="app.js"></script></head><body></body></html>\n' }).code).toBe(1)
    expect(run('a11y.mjs', 'render-blocking', { 'Page.tsx': 'const p = <img src="a.png" alt="x" />\n' }).code).toBe(1)
  })
})

describe('duplicate-test-names', () => {
  const dup = (text: string) => run('quality.mjs', 'duplicate-test-names', { 'a.test.ts': text })
  test('the same title in different describe blocks is fine', () => {
    expect(dup("describe('a', () => {\n  it('works', () => {})\n})\ndescribe('b', () => {\n  it('works', () => {})\n})\n").code).toBe(0)
  })
  test('the same title twice in one describe, or twice at top level, still reports', () => {
    expect(dup("describe('a', () => {\n  it('works', () => {})\n  it('works', () => {})\n})\n").code).toBe(1)
    expect(dup("test('adds', () => {})\ntest('adds', () => {})\n").code).toBe(1)
  })
  test('a nested describe does not hide a repeat inside it', () => {
    expect(dup("describe('a', () => {\n  describe('b', () => {\n    it('x', () => { if (1) {} })\n    it('x', () => {})\n  })\n})\n").code).toBe(1)
  })
})

describe('broken-imports', () => {
  const imp = (text: string) => run('static.mjs', 'broken-imports', { 'a.test.ts': text })
  test('an import named in a comment or quoted in a string is not an import', () => {
    expect(imp("/**\n * Both forms: `import x from './gone.cjs'`\n */\nconst a = 1\n").code).toBe(0)
    expect(imp("// import x from './gone.js'\nconst a = 1\n").code).toBe(0)
    expect(imp("expect(source).toContain(\"from './gone.cjs'\")\n").code).toBe(0)
  })
  test('a real import of a missing file still reports', () => {
    expect(imp("import x from './gone.js'\n").code).toBe(1)
    expect(imp("const m = require('./gone.js') // import y from './other.js'\n").code).toBe(1)
  })
})
