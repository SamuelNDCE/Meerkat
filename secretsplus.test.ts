// The secrets-plus check (thorough/secrets-plus.mjs + thorough/rules-secrets-plus.mjs): every rule proves itself, the scan never prints a
// whole secret, every regex survives hostile input, and the pack loads.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { selfProve } from './thorough/rules.mjs'
// @ts-expect-error plain JS module
import { RULES, shannon, isPlaceholder } from './thorough/rules-secrets-plus.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/secrets-plus.mjs'
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-secretsplus-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

// Runs the check; returns the exit code and everything it printed.
function run(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, 'secrets-plus', ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

const subLines = (out: string) => out.split('\n').filter((l) => l.startsWith('MEERKAT-SUB '))

describe('the rule table', () => {
  test('has at least 150 rules with unique kebab-case ids', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(150)
    const ids = RULES.map((r: any) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,60}$/)
  })
  test('every rule finds its bad sample and ignores its good sample (selfProve)', () => {
    expect(selfProve(RULES)).toEqual([])
  })
  test('the source file never holds a whole real-looking key', () => {
    // The bad samples exist only at runtime: none of them appears verbatim in the rule file.
    const src = execFileSync(process.execPath, ['-e', "process.stdout.write(require('node:fs').readFileSync('thorough/rules-secrets-plus.mjs','utf8'))"], { cwd: ROOT, encoding: 'utf8' })
    for (const r of RULES) if (r.bad.length >= 40) expect(src.includes(r.bad), r.id).toBe(false)
  })
  test('the pack check id is not used by any other pack', async () => {
    const dir = join(ROOT, 'packs')
    const all = (await import('node:fs')).readdirSync(dir)
    let count = 0
    for (const p of all) {
      const checks = await loadChecks(join(dir, p))
      count += checks.filter((c: any) => c.id === 'secrets-plus').length
    }
    expect(count).toBe(1)
  })
})

describe('entropy and placeholder helpers', () => {
  test('shannon entropy ranks random above repetitive text', () => {
    expect(shannon('aaaaaaaa')).toBe(0)
    expect(shannon('abcdefghijklmnopqrstuvwxyz0123456789')).toBeGreaterThan(5)
  })
  test('placeholders are recognised', () => {
    for (const v of ['changeme', 'your_api_key_here', 'xxxxxxxxxxxx', '<token>', '${TOKEN}', 'process.env.KEY', 'os.getenv("K")', 'example-token-value', '{{ secret }}', 'password_confirmation']) expect(isPlaceholder(v), v).toBe(true)
    expect(isPlaceholder('hunter2Qx9Zr')).toBe(false)
  })
})

describe('the scan', () => {
  test('--fixtures exits 1 and says found', () => {
    const r = run(['--fixtures'])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/found/)
  })

  test('a clean project exits 0 and prints a PASS sub line for every rule that applies', () => {
    const dir = project({ 'src/app.js': 'export const answer = 42\nconst name = "token"\nconst pw = process.env.DB_PASSWORD\n', 'README.md': '# Clean\n' })
    const r = run(['--root', dir])
    expect(r.code).toBe(0)
    const subs = subLines(r.out)
    expect(subs.length).toBe(RULES.length)
    expect(subs.filter((l) => l.startsWith('MEERKAT-SUB PASS ')).length).toBeGreaterThanOrEqual(RULES.length - 10)
    expect(subs.some((l) => l.startsWith('MEERKAT-SUB FAIL '))).toBe(false)
  })

  test('every rule fires on its own planted sample, and no output line holds a whole secret', () => {
    const body: Record<string, string> = {}
    const loose: string[] = []
    for (const r of RULES) {
      if (r.sample) body[`cfg/${r.sample}`] = `${r.bad}\n`
      else loose.push(r.bad)
    }
    body['src/all.txt'] = `${loose.join('\n')}\n`
    const dir = project(body)
    const r = run(['--root', dir])
    expect(r.code).toBe(1)
    const failed = new Set(subLines(r.out).filter((l) => l.startsWith('MEERKAT-SUB FAIL ')).map((l) => l.split(' ')[2]))
    const missing = RULES.map((x: any) => x.id).filter((id: string) => !failed.has(id))
    expect(missing).toEqual([])
    const findingLines = r.out.split('\n').filter((l) => /^ {2}\S+:\d+ /.test(l))
    expect(findingLines.length).toBeGreaterThan(0)
    const findings = findingLines.join('\n')
    for (const x of RULES) if (x.bad.length > 12) expect(findings.includes(x.bad.slice(-12)), `${x.id} leaked its last 12 characters`).toBe(false)
    // Each finding line shows at most 4 characters in brackets.
    for (const l of r.out.split('\n').filter((l) => /^ {2}\S+:\d+ /.test(l))) {
      const m = /\[(.*)\]$/.exec(l)
      expect(m, l).not.toBeNull()
      expect(m![1].length).toBeLessThanOrEqual(4)
    }
  })

  test('an inline meerkat-allow marker on the line or the line above switches a finding off', () => {
    const key = 'AKIA' + 'QWERTYUIOPASDFGH'
    const dir = project({ 'src/a.js': `const a = '${key}' // meerkat-allow: secret\n// meerkat-allow: secret\nconst b = '${key}'\n` })
    expect(run(['--root', dir]).code).toBe(0)
    const dir2 = project({ 'src/a.js': `const a = '${key}'\n\nconst b = '${key}' // meerkat-allow: secret\n` })
    const r = run(['--root', dir2])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/src\/a\.js:1 aws-access-key-id/)
    expect(r.out).not.toMatch(/src\/a\.js:3/)
  })

  test('the allow file switches off a path glob or one rule on a path', () => {
    const key = 'AKIA' + 'QWERTYUIOPASDFGH'
    const gh = 'ghp_' + 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5'
    const files = { 'config/dev/a.js': `const a = '${key}'\n`, 'src/b.js': `const b = '${gh}'\n` }
    const dir = project({ ...files, '.meerkat-secrets-plus-allow': '# accepted\nconfig/dev/*\naws-access-key-id src/*\n' })
    const r = run(['--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/src\/b\.js:1 github-pat-classic/)
    expect(r.out).not.toMatch(/config\/dev\/a\.js:\d/)
  })

  test('tests, docs and lockfiles are skipped unless --include-tests; lockfiles never', () => {
    const key = 'AKIA' + 'QWERTYUIOPASDFGH'
    const dir = project({ 'tests/a.js': `const a = '${key}'\n`, 'docs/x.md': `key: ${key}\n`, 'package-lock.json': `{"x": "${key}"}\n` })
    expect(run(['--root', dir]).code).toBe(0)
    const r = run(['--root', dir, '--include-tests'])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/tests\/a\.js:1/)
    expect(r.out).not.toMatch(/package-lock/)
  })

  test('the key ids AWS prints in its own docs (ending in EXAMPLE) are not reported', () => {
    const dir = project({ 'src/a.js': `const a = '${'AKIA' + 'IOSFODNN7' + 'EXAMPLE'}'
` })
    expect(run(['--root', dir]).code).toBe(0)
  })

  test('placeholders and environment lookups do not trip the generic rules', () => {
    const dir = project({
      'src/a.js': ['const password = "changeme"', 'const token = process.env.API_TOKEN', 'api_key: "${API_KEY}"', 'secret = "your_secret_here"', 'auth_token = "<token>"', 'password: ""'].join('\n') + '\n',
    })
    const r = run(['--root', dir])
    expect(r.code).toBe(0)
  })

  test('a line over 4000 characters is skipped and counted, a binary file is skipped', () => {
    const key = 'AKIA' + 'QWERTYUIOPASDFGH'
    const dir = project({ 'src/min.js': `x='${key}'${' '.repeat(4100)}\n`, 'src/ok.js': 'const a = 1\n' })
    writeFileSync(join(dir, 'src', 'blob.js'), Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`'${key}'`)]))
    const r = run(['--root', dir])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/skipped 1 line\(s\) over 4000/)
    expect(r.out).toMatch(/1 binary/)
  })
})

describe('regex safety', () => {
  const HOSTILE: Record<string, string> = {
    letters: 'a'.repeat(100_000),
    mixedcase: 'aB3'.repeat(33_000),
    spaces: ' '.repeat(100_000),
    assignments: 'password = "'.repeat(8_400),
    colons: 'a:'.repeat(50_000),
    urls: 'http://a:'.repeat(11_200),
    names: 'datadog_api_key'.repeat(6_700),
    dashes: '-----BEGIN '.repeat(9_100),
    base64: 'eyJ'.repeat(33_000) + '.' + 'eyJ'.repeat(10),
    underscores: 'sk_'.repeat(33_000),
  }
  test('every regex finishes each 100 KB hostile string within 1.5 seconds', () => {
    const slow: string[] = []
    for (const r of RULES) {
      for (const [name, text] of Object.entries(HOSTILE)) {
        const t0 = performance.now()
        if (r.find) r.find(text)
        else r.re.exec(text)
        const ms = performance.now() - t0
        if (ms > 1500) slow.push(`${r.id} on ${name}: ${Math.round(ms)} ms`)
      }
    }
    expect(slow).toEqual([])
  }, 120_000)
})

describe('the secrets-plus pack', () => {
  test('loads one check with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'secrets-plus'))
    expect(checks.filter((c: any) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(1)
    const c = checks[0] as any
    expect(c.id).toBe('secrets-plus')
    expect(c.group).toBe('security')
    expect(c.suite).toBe('secrets')
    expect(c.subs).toBe(RULES.length)
    expect(c.selfTest.expectFail).toBe(true)
    expect(c.selfTest.expectMatch).toBe('found')
  })
})


describe('regressions found in review', () => {
  test('a vendor name next to a plain word is not a secret (locale JSON, no secret-like name)', () => {
    const dir = project({ 'src/i18n.json': '{ "snowflake": "Schneeflocke-Edition", "mistral": "Mistral-Windschutzscheibe" }\n' })
    expect(run(['--root', dir]).code).toBe(0)
  })
  test('test-named files are skipped by default, and read with --include-tests', () => {
    const key = 'AKIA' + 'QWERTYUIOPASDFGH'
    const dir = project({ 'test-keys.js': 'const a = "' + key + '"\n' })
    expect(run(['--root', dir]).code).toBe(0)
    expect(run(['--root', dir, '--include-tests']).code).toBe(1)
  })
  test('a placeholder password in a connection URL is not reported, a real-looking one is', () => {
    expect(run(['--root', project({ 'src/a.js': 'const u = "postgres://app:password@localhost:5432/app"\n' })]).code).toBe(0)
    expect(run(['--root', project({ 'src/a.js': 'const u = "postgres://app:Zq8vXk2LmNp4@db.internal:5432/app"\n' })]).code).toBe(1)
  })
  test('a PEM header inside a comment or closed by a quote is a mention, not a key', () => {
    const dir = project({ 'src/a.js': '// -----BEGIN PRIVATE KEY----- is what we look for\nconst H = "-----BEGIN PRIVATE KEY-----"\n' })
    expect(run(['--root', dir]).code).toBe(0)
  })
})

