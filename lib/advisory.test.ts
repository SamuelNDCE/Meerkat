// Advisory alerts (lib/advisory.mjs): manifests in, a recorded OSV snapshot in, plain-words findings out. No test touches the network:
// fetch is replaced by a function that fails the test if anything calls it, and refreshSnapshot gets a fake.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { compareVersions, cvss3Score, detectStack, loadSnapshot, lowerBound, matchAdvisories, refreshSnapshot, renderReport, scanAdvisories, severityOf, trimRecord } from './advisory.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PHP = join(ROOT, 'fixtures/advisory/php-old-laravel')
const SNAP = join(ROOT, 'fixtures/advisory/osv-snapshot-php.json')
const NOW = new Date('2026-11-07T00:00:00Z')

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('the network must not be used in tests') }) })
afterEach(() => { vi.unstubAllGlobals() })

const tmp = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-adv-'))
  for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), t)
  return d
}

describe('versions', () => {
  test('lowerBound takes the first version in a constraint', () => {
    expect(lowerBound('^7.2.5')).toBe('7.2.5')
    expect(lowerBound('>=1.4,<2')).toBe('1.4')
    expect(lowerBound('~> 3.1')).toBe('3.1')
    expect(lowerBound('*')).toBeNull()
  })
  test('compareVersions orders numbers as numbers and pre-releases below releases', () => {
    expect(compareVersions('7.30.0', '7.4.9')).toBe(1)
    expect(compareVersions('v8.0.0', '8.0.0')).toBe(0)
    expect(compareVersions('1.0.0rc1', '1.0.0')).toBe(-1)
    expect(compareVersions('2.9.3', '3.0.0')).toBe(-1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })
})

describe('detectStack', () => {
  test('the PHP fixture gives the PHP floor, the framework and exact locked versions', () => {
    const s = detectStack(PHP)
    expect(s.languages).toEqual([expect.objectContaining({ language: 'PHP', version: '7.2.5', source: 'composer.json' })])
    expect(s.packages).toContainEqual({ ecosystem: 'Packagist', name: 'laravel/framework', version: '7.30.0', exact: true, source: 'composer.lock' })
    expect(s.packages).toHaveLength(2)
  })
  test('without a lock file the lowest allowed version is used and flagged inexact', () => {
    const d = tmp({ 'composer.json': '{"require":{"php":">=8.1","symfony/http-kernel":"^5.4"}}' })
    try {
      const s = detectStack(d)
      expect(s.packages).toEqual([{ ecosystem: 'Packagist', name: 'symfony/http-kernel', version: '5.4', exact: false, source: 'composer.json' }])
      expect(s.notes.join(' ')).toMatch(/composer\.lock not found/)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
  test('reads npm, Python, Go, Rust, Ruby and Java manifests', () => {
    const d = tmp({
      'package.json': '{"engines":{"node":">=18"},"dependencies":{"lodash":"4.17.15"}}',
      'requirements.txt': 'Django==2.2.0\nrequests>=2.0 # c\n-r other.txt\n',
      'go.mod': 'module x\n\ngo 1.20\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.6.0\n)\n',
      'Cargo.toml': '[dependencies]\nregex = "1.5"\nserde = { version = "1.0.100", features = ["derive"] }\n',
      Gemfile: "ruby '3.1.0'\ngem 'rails', '~> 5.2'\n",
      'pom.xml': '<project><dependencies><dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId><version>2.14.1</version></dependency></dependencies></project>',
    })
    try {
      const s = detectStack(d)
      const names = s.packages.map((p) => `${p.ecosystem}:${p.name}@${p.version}`)
      expect(names).toEqual(expect.arrayContaining(['npm:lodash@4.17.15', 'PyPI:Django@2.2.0', 'PyPI:requests@2.0', 'Go:github.com/gin-gonic/gin@1.6.0', 'crates.io:regex@1.5', 'crates.io:serde@1.0.100', 'RubyGems:rails@5.2', 'Maven:org.apache.logging.log4j:log4j-core@2.14.1']))
      expect(s.languages.map((l) => l.language)).toEqual(expect.arrayContaining(['Node.js', 'Go', 'Ruby']))
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})

describe('the recorded snapshot', () => {
  test('has the documented format and is credited', () => {
    const s = loadSnapshot(SNAP)!
    expect(s.format).toBe('meerkat-advisory-snapshot')
    expect(s.source).toBe('osv.dev')
    expect(s.licenceNote).toMatch(/CC-BY/)
    expect(s.advisories.length).toBeGreaterThan(5)
    expect(s.queried).toContainEqual({ ecosystem: 'Packagist', name: 'laravel/framework' })
  })
  test('a file that is not a snapshot is refused', () => {
    const d = tmp({ 'x.json': '{"format":"other"}' })
    try { expect(loadSnapshot(join(d, 'x.json'))).toBeNull(); expect(loadSnapshot(join(d, 'missing.json'))).toBeNull() } finally { rmSync(d, { recursive: true, force: true }) }
  })
})

describe('scan of the old PHP project (offline)', () => {
  const r = scanAdvisories(PHP, { snapshotPath: SNAP, now: NOW })
  test('finds the known old-Laravel query binding vulnerability and says what fixes it', () => {
    const f = r.findings.find((x) => x.cve === 'CVE-2021-21263')!
    expect(f).toBeTruthy()
    expect(f).toMatchObject({ package: 'laravel/framework', version: '7.30.0', severity: 'HIGH', serious: true, fixedIn: '7.30.2' })
  })
  test('does not flag the up-to-date monolog', () => { expect(r.findings.some((f) => f.package === 'monolog/monolog')).toBe(false) })
  test('serious findings come first in the findings list and in the report', () => {
    const firstOther = r.findings.findIndex((f) => !f.serious)
    expect(firstOther).toBeGreaterThan(0)
    expect(r.findings.slice(firstOther).every((f) => !f.serious)).toBe(true)
    expect(r.report.startsWith('SERIOUS SECURITY ALERT')).toBe(true)
    expect(r.report.split('\n')[1]).toMatch(/^Action: update the packages below/)
    expect(r.report).toMatch(/changed nothing/)
    expect(r.report.indexOf('SERIOUS')).toBeLessThan(r.report.indexOf('Other advisories'))
  })
  test('serious flag is set', () => { expect(r.serious).toBe(true) })
  test('never used the network', () => { expect(() => scanAdvisories(PHP, { snapshotPath: SNAP })).not.toThrow() })
})

describe('matching rules', () => {
  const rec = (over = {}) => trimRecord({ id: 'X-1', summary: 'bad', aliases: ['CVE-1'], database_specific: { severity: 'CRITICAL' }, affected: [{ package: { ecosystem: 'npm', name: 'left-pad' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.3.0' }] }] }], ...over })
  const snap = (...advisories: unknown[]) => ({ format: 'meerkat-advisory-snapshot', version: 1, fetchedAt: NOW.toISOString(), advisories }) as never
  const p = (version: string, exact = true) => ({ ecosystem: 'npm', name: 'left-pad', version, exact, source: 'package.json' })

  test('inside the range matches, the fixed version and later do not', () => {
    expect(matchAdvisories([p('1.2.9')], snap(rec()))).toHaveLength(1)
    expect(matchAdvisories([p('1.3.0')], snap(rec()))).toHaveLength(0)
    expect(matchAdvisories([p('2.0.0')], snap(rec()))).toHaveLength(0)
  })
  test('a version only known as a lower bound is "may be affected" and never counted as serious', () => {
    const f = matchAdvisories([p('1.0.0', false)], snap(rec()))
    expect(f[0].serious).toBe(false)
    expect(renderReport({ stack: { languages: [], packages: [p('1.0.0', false)], notes: [] }, findings: f, snapshot: snap(rec()), now: NOW })).toMatch(/MAY be affected/)
  })
  test('last_affected and explicit version lists work; PyPI names are normalised', () => {
    const last = rec({ affected: [{ package: { ecosystem: 'npm', name: 'left-pad' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '1.0.0' }, { last_affected: '1.1.0' }] }] }] })
    expect(matchAdvisories([p('1.1.0')], snap(last))).toHaveLength(1)
    expect(matchAdvisories([p('1.1.1')], snap(last))).toHaveLength(0)
    const listed = trimRecord({ id: 'Y', summary: 's', affected: [{ package: { ecosystem: 'PyPI', name: 'Foo_Bar' }, versions: ['1.0'] }] })
    expect(matchAdvisories([{ ecosystem: 'PyPI', name: 'foo-bar', version: '1.0', exact: true, source: 'r' }], snap(listed))).toHaveLength(1)
  })
  test('severity words and CVSS vectors map to levels', () => {
    expect(severityOf({ database_specific: { severity: 'MODERATE' } })).toBe('MODERATE')
    expect(severityOf({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })).toBe('CRITICAL')
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8)
    expect(severityOf({})).toBe('UNKNOWN')
  })
})

describe('report honesty', () => {
  test('a stale snapshot and unchecked packages are said out loud', () => {
    const stack = detectStack(PHP)
    stack.packages.push({ ecosystem: 'Packagist', name: 'acme/never-asked', version: '1.0.0', exact: true, source: 'composer.lock' })
    const text = renderReport({ stack, findings: [], snapshot: loadSnapshot(SNAP)!, now: new Date('2027-03-01T00:00:00Z') })
    expect(text).toMatch(/STALE/)
    expect(text).toMatch(/1 package was not in the snapshot/)
    expect(text).toMatch(/^No known vulnerabilities found/)
  })
  test('no snapshot means nothing was checked, and the report says so', () => {
    const r = scanAdvisories(PHP, { snapshotPath: join(ROOT, 'fixtures/advisory/none.json') })
    expect(r.findings).toEqual([])
    expect(r.report).toMatch(/No advisory snapshot found, so nothing could be checked/)
  })
})

describe('refreshSnapshot (fake feed, no network)', () => {
  test('queries in batches, follows next_page_token, fetches each record once and trims it', async () => {
    const calls: string[] = []
    const fakeFetch = async (url: string, init: { body?: string }) => {
      calls.push(url.replace('https://api.osv.dev', ''))
      const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j })
      if (url.endsWith('/v1/querybatch')) {
        const q = JSON.parse(init.body!).queries[0]
        return ok({ results: [q.page_token ? { vulns: [{ id: 'B-2' }] } : { vulns: [{ id: 'A-1' }], next_page_token: 't' }] })
      }
      return ok({ id: url.split('/').pop(), summary: 's', details: 'long text dropped', affected: [{ package: { name: 'left-pad', ecosystem: 'npm' }, ranges: [{ type: 'GIT', events: [] }, { type: 'SEMVER', events: [{ introduced: '0' }] }] }] })
    }
    const s = await refreshSnapshot([{ ecosystem: 'npm', name: 'left-pad' }, { ecosystem: 'npm', name: 'left-pad' }], { fetch: fakeFetch as never, now: NOW })
    expect(calls).toEqual(['/v1/querybatch', '/v1/querybatch', '/v1/vulns/A-1', '/v1/vulns/B-2'])
    expect(s.advisories.map((a: { id: string }) => a.id)).toEqual(['A-1', 'B-2'])
    expect(s.advisories[0]).not.toHaveProperty('details')
    expect(s.advisories[0].affected[0].ranges).toHaveLength(1)
    expect(s.queried).toHaveLength(1)
  })
  test('a server error is thrown, not swallowed', async () => {
    const bad = async () => ({ ok: false, status: 503, json: async () => ({}) })
    await expect(refreshSnapshot([{ ecosystem: 'npm', name: 'x' }], { fetch: bad as never })).rejects.toThrow(/503/)
  })
})
