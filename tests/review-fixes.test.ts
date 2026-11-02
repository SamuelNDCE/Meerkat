// Fixes from the independent review of PR 44: the skips must not hide real problems in shipped code.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { isTestFile } from '../thorough/kit.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const riskyStatus = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-rf-'))
  made.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  try {
    execFileSync(process.execPath, ['thorough/static.mjs', 'risky-code', '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

describe('probe folders', () => {
  test('QA probe scripts and folders under scripts, tools or supabase are test code', () => {
    for (const f of ['supabase/probe/a.mjs', 'scripts/probes/x.js', 'apps/a/electron/probe-x.cts', 'tests/a.js']) expect(isTestFile(f), f).toBe(true)
  })
  test('a production folder that happens to be named probe is not', () => {
    expect(isTestFile('src/probe/runner.js')).toBe(false)
    expect(isTestFile('packages/net/probe/ping.ts')).toBe(false)
  })
})

describe('plain http addresses', () => {
  test('a real unencrypted request on a line that also calls replace is still reported', () => {
    expect(riskyStatus({ 'a.js': "await fetch('http://api.vendor.com/v1/' + name.replace(/\\W/g, '_'))\n" })).toBe(1)
  })
  test('an address that is only trimmed as a prefix is not', () => {
    expect(riskyStatus({ 'a.rs': 'fn f(s: &str) -> &str { s.trim_start_matches("http://github.com/") }\n' })).toBe(0)
  })
  test('a namespace host is not, another host on the same line is', () => {
    expect(riskyStatus({ 'a.java': 'f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);\n' })).toBe(0)
    expect(riskyStatus({ 'a.js': "const a = 'http://apache.org/xml/x'; const b = 'http://evil.example.net/api'\n" })).toBe(1)
  })
})
