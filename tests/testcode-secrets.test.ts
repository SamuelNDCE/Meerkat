// Fake secrets in test code are on purpose: the secret checks leave Rust unit tests (after #[cfg(test)]), *_tests.rs files, values that say they are fake and a
// key header mentioned in a comment alone. A real-looking secret in shipped code must still be found, in the same files.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const project = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-tcs-'))
  made.push(d)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(d, name.split('/').slice(0, -1).join('/') || '.'), { recursive: true })
    writeFileSync(join(d, name), text)
  }
  return d
}
const run = (script: string, args: string[], root: string) => spawnSync(process.execPath, [join(ROOT, 'thorough', script), ...args, '--root', root], { encoding: 'utf8' })
// Assembled here so this file holds no token-shaped text itself.
const REAL_AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP'
const REAL_GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'

describe('secret-scan', () => {
  test('a real key in shipped code is found', () => {
    const r = run('secret-scan.mjs', [], project({ 'src/a.ts': `const k = '${REAL_AWS}'\n` }))
    expect(r.status).toBe(1)
  })
  test('the same key after #[cfg(test)] in a Rust file is not', () => {
    const r = run('secret-scan.mjs', [], project({ 'src/lib.rs': `fn main() {}\n\n#[cfg(test)]\nmod tests {\n    const K: &str = "${REAL_AWS}";\n}\n` }))
    expect(r.status, r.stdout).toBe(0)
  })
  test('but before #[cfg(test)] it still is', () => {
    const r = run('secret-scan.mjs', [], project({ 'src/lib.rs': `const K: &str = "${REAL_AWS}";\n\n#[cfg(test)]\nmod tests {}\n` }))
    expect(r.status).toBe(1)
  })
  test('code AFTER the test module closes is scanned again', () => {
    const r = run('secret-scan.mjs', [], project({ 'src/lib.rs': `#[cfg(test)]\nmod tests {\n    fn t() { let s = "{"; }\n}\n\nconst K: &str = "${REAL_AWS}";\n` }))
    expect(r.status).toBe(1)
  })
  test('an attribute that is not followed by a module covers nothing', () => {
    const r = run('secret-scan.mjs', [], project({ 'src/lib.rs': `#[cfg(test)]\nuse std::fmt;\nconst K: &str = "${REAL_AWS}";\n` }))
    expect(r.status).toBe(1)
  })
  test('a key header inside a string value is still reported', () => {
    const header = '-----BEGIN ' + 'PRIVATE KEY-----'
    expect(run('secret-scan.mjs', [], project({ 'src/a.ts': `const k = "${header}\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC"\n` })).status).toBe(1)
    // A constant that is the header alone is a marker for a parser, not a key; with anything after it on the line it is reported.
    expect(run('secret-scan.mjs', [], project({ 'src/a.ts': `const PEM_BEGIN = "${header}"\n` })).status).toBe(0)
    expect(run('secret-scan.mjs', [], project({ 'src/a.ts': `const k = "${header} MIIEvQIBADANBgkqhkiG9w0BAQEFAASC"\n` })).status).toBe(1)
  })
  test('a *_tests.rs file is skipped', () => {
    expect(run('secret-scan.mjs', [], project({ 'src/pair_tests.rs': `const K: &str = "${REAL_AWS}";\n` })).status).toBe(0)
  })
  test('a value that says it is fake is not a secret', () => {
    expect(run('secret-scan.mjs', [], project({ 'src/a.ts': `const FAKE_TOKEN = '${REAL_GH.replace('ghp_', 'ghp_FAKE')}'\n` })).status).toBe(0)
  })
  test('a real-looking token is found', () => {
    expect(run('secret-scan.mjs', [], project({ 'src/a.ts': `const t = '${REAL_GH}'\n` })).status).toBe(1)
  })
  test('a private key header in a comment with no key under it is not a key; with a key body it is', () => {
    const header = '-----BEGIN ' + 'PRIVATE KEY-----'
    expect(run('secret-scan.mjs', [], project({ 'src/a.ts': `// the detector looks for ${header} in a value\nconst x = 1\n` })).status).toBe(0)
    expect(run('secret-scan.mjs', [], project({ 'key.pem': `${header}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n` })).status).toBe(1)
  })
})

describe('credentials-in-urls', () => {
  const url = 'postgres://admin:Sup3rS3cretPw@db.acme.io/app'
  test('in shipped code it is found', () => {
    expect(run('sec-code.mjs', ['credentials-in-urls'], project({ 'src/db.ts': `const u = '${url}'\n` })).status).toBe(1)
  })
  test('in a Rust unit test module it is not', () => {
    const r = run('sec-code.mjs', ['credentials-in-urls'], project({ 'src/lib.rs': `fn a() {}\n#[cfg(test)]\nmod tests {\n  fn t() { let u = "${url}"; }\n}\n` }))
    expect(r.status, r.stdout).toBe(0)
  })
  test('in a *_tests.rs file it is not', () => {
    expect(run('sec-code.mjs', ['credentials-in-urls'], project({ 'src/pair_tests.rs': `fn t() { let u = "${url}"; }\n` })).status).toBe(0)
  })
})
