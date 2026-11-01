import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { defaultSeverity } from '../lib/findings.mjs'
// @ts-ignore plain .mjs module has no type declarations
import { dedupe } from '../lib/findingsdoc.mjs'

// Findings from a real review of a scan: presence-style rules were rated high, the same fact was reported twice, and innerHTML was flagged
// even when the value went through a sanitiser.
describe('severity of checks that report a practice or a notice', () => {
  test('deprecated dependencies, artifact retention, install scripts and the DevTools gate are not high', () => {
    expect(defaultSeverity({ id: 'deprecated-deps', group: 'security' })).toBe('low')
    expect(defaultSeverity({ id: 'github-actions-artifacts', group: 'security' })).toBe('low')
    expect(defaultSeverity({ id: 'install-scripts', group: 'security' })).toBe('medium')
    expect(defaultSeverity({ id: 'electron-devtools-prod', group: 'security' })).toBe('medium')
  })
  test('a check that is not listed keeps the severity of its group, and an explicit severity still wins', () => {
    expect(defaultSeverity({ id: 'sql-concat', group: 'security' })).toBe('high')
    expect(defaultSeverity({ id: 'deprecated-deps', group: 'security', severity: 'high' })).toBe('high')
  })
})

describe('the same fact is reported once', () => {
  const f = (id: string, check: string, rule: string | null, file: string, line: number, message: string, severity = 'medium') => [id, { id, check, rule, file, line, message, severity }] as const
  test('the lockfile deprecation rule is dropped when deprecated-deps reported', () => {
    const merged = new Map([f('a', 'deprecated-deps', null, 'package-lock.json', 0, 'boolean@3 is deprecated'), f('b', 'wh-supply', 'lockfile-deprecated-entry', 'package-lock.json', 0, 'A lockfile entry carries a deprecated marker'), f('c', 'wh-supply', 'release-workflow-no-sbom', '.github/workflows/r.yml', 3, 'no sbom')])
    dedupe(merged)
    expect([...merged.keys()].sort()).toEqual(['a', 'c'])
  })
  test('the lockfile rule stays when deprecated-deps reported nothing', () => {
    const merged = new Map([f('b', 'wh-supply', 'lockfile-deprecated-entry', 'package-lock.json', 0, 'x')])
    dedupe(merged)
    expect([...merged.keys()]).toEqual(['b'])
  })
  test('two checks with the same words about the same place become one finding with the higher severity', () => {
    const merged = new Map<string, any>([f('a', 'one', 'r', 'src/a.js', 5, 'unsafe call', 'medium'), f('b', 'two', 'r2', 'src/a.js', 5, 'Unsafe call', 'high')])
    dedupe(merged)
    expect([...merged.keys()]).toEqual(['b'])
    expect(merged.get('b').alsoDetectedBy).toEqual(['one'])
  })
  test('different places are never merged', () => {
    const merged = new Map([f('a', 'one', 'r', 'src/a.js', 5, 'unsafe call'), f('b', 'two', 'r', 'src/a.js', 6, 'unsafe call')])
    dedupe(merged)
    expect(merged.size).toBe(2)
  })
})

describe('innerHTML with a sanitised value is not flagged', () => {
  const NL = String.fromCharCode(10)
  const run = (code: string) => {
    const d = mkdtempSync(join(tmpdir(), 'meerkat-sev-'))
    try {
      mkdirSync(join(d, 'src'))
      writeFileSync(join(d, 'src', 'a.js'), code + NL)
      execFileSync('git', ['-C', d, 'init', '-q'])
      execFileSync('git', ['-C', d, 'add', '-A'])
      try {
        return execFileSync('node', [join(__dirname, '..', 'thorough', 'static.mjs'), 'risky-code', '--root', d], { encoding: 'utf8' })
      } catch (e) {
        return String((e as { stdout?: string }).stdout ?? '')
      }
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  }
  test('DOMPurify.sanitize and escapeHtml are trusted', () => {
    expect(run('el.innerHTML = DOMPurify.sanitize(html)')).not.toContain('innerHTML')
    expect(run('el.innerHTML = escapeHtml(name)')).not.toContain('innerHTML')
  })
  test('a raw value is still reported, as medium', () => {
    const out = run('el.innerHTML = userText')
    expect(out).toContain('innerHTML assignment')
    expect(out).toMatch(/MEERKAT-FINDING medium innerhtml-assignment src\/a\.js:1/)
  })
})

describe('version-tag-match: a version newer than the latest tag is not a mismatch', () => {
  const sh = (d: string, args: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' })
  const run = (pkgVersion: string, tag: string) => {
    const d = mkdtempSync(join(tmpdir(), 'meerkat-tag-'))
    try {
      sh(d, ['init', '-q'])
      writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'x', version: tag.replace('v', '') }))
      sh(d, ['add', '-A'])
      sh(d, ['commit', '-q', '-m', 'one'])
      sh(d, ['tag', tag])
      writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'x', version: pkgVersion }))
      sh(d, ['commit', '-q', '-a', '-m', 'two'])
      try {
        return { code: 0, out: execFileSync('node', [join(__dirname, '..', 'thorough', 'git.mjs'), 'version-tag-match', '--root', d], { encoding: 'utf8' }) }
      } catch (e) {
        return { code: (e as { status?: number }).status ?? 1, out: String((e as { stdout?: string }).stdout ?? '') }
      }
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  }
  test('newer than the tag passes with a note', () => {
    const r = run('0.3.11', 'v0.3.1')
    expect(r.code).toBe(0)
    expect(r.out).toContain('not tagged yet')
  })
  test('older than the tag fails', () => {
    expect(run('0.9.0', 'v1.0.0').code).toBe(1)
  })
})
