// The one version helper (lib/version.mjs), and the checks that every place which shows or saves a version uses it.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { compareVersions, isNewer, isVersion, VERSION } from './version.mjs'
// @ts-expect-error plain .mjs module
import { findingsSarif } from './findingsdoc.mjs'
// @ts-expect-error plain .mjs module
import { writeRunReport } from './runlog.mjs'
// @ts-expect-error plain .mjs module
import { createContext, handleMessage } from './mcp.mjs'
// @ts-expect-error plain .mjs module
import { buildBugReport } from './bugreport.mjs'
// @ts-expect-error plain .mjs module
import { compareVersions as updateCompare, updateNotice, writeUpdateCache } from './update.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const scratch: string[] = []
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

describe('the version number comes from package.json, once', () => {
  test('VERSION is package.json version and is a valid version', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(VERSION).toBe(pkg.version)
    expect(isVersion(VERSION)).toBe(true)
  })
})

describe('compareVersions and isNewer (semver precedence)', () => {
  test('numbers compare as numbers, so 0.10.0 is newer than 0.9.0', () => {
    expect(compareVersions('0.1.0', '0.10.0')).toBe(-1)
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(isNewer('0.9.0', '0.10.0')).toBe(false)
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
  })

  test('a pre-release is older than its release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true)
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false)
  })

  test('pre-release parts compare one by one', () => {
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.1')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.9', '1.0.0-alpha.10')).toBe(-1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
  })

  test('build metadata is ignored', () => {
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0)
    expect(compareVersions('1.0.0-rc.1+build-7', '1.0.0-rc.1')).toBe(0)
    expect(isVersion('1.4.0+build.5')).toBe(true)
  })

  test('equal versions are equal, and very long numbers do not lose precision', () => {
    expect(compareVersions('2.3.4', '2.3.4')).toBe(0)
    expect(compareVersions('99999999999999999999.0.0', '9.0.0')).toBe(1)
  })

  test('invalid input is safe: null from compare, never newer', () => {
    for (const bad of ['1.4', 'v1.4.0', '1.4.0 ', '1.4.x', '', '01.2.3', '<b>1.0.0</b>', null, undefined, 5]) {
      expect(compareVersions(bad, '1.0.0')).toBeNull()
      expect(compareVersions('1.0.0', bad)).toBeNull()
      expect(isNewer(bad, '0.1.0')).toBe(false)
      expect(isNewer('1.0.0', bad)).toBe(false)
    }
    expect(isVersion('x'.repeat(65))).toBe(false)
  })

  test('the update bar uses the same rule: no bar for 0.9.0 against 0.10.0', () => {
    const home = mkdtempSync(join(tmpdir(), 'meerkat-ver-'))
    scratch.push(home)
    const env = { ...process.env, MEERKAT_HOME: home, HOME: home, USERPROFILE: home }
    writeUpdateCache('0.10.0', Date.now(), env, home)
    expect(updateNotice({ current: '0.9.0', env, home })).not.toBeNull()
    expect(updateNotice({ current: '0.10.0', env, home })).toBeNull()
    expect(updateCompare('0.9.0', '0.10.0')).toBe(-1)
  })
})

describe('every place that shows a version reports VERSION', () => {
  test('SARIF tool.driver.version', () => {
    const sarif = findingsSarif({ meerkat: { version: VERSION }, findings: [] })
    expect(sarif.runs[0].tool.driver.version).toBe(VERSION)
  })

  test('summary.json version, from the default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-run-'))
    scratch.push(dir)
    const env = { ...process.env, MEERKAT_LOG_DIR: join(dir, 'logs') }
    const runDir = join(dir, 'run')
    mkdirSync(runDir, { recursive: true }) // writeRunReport writes into a folder that already exists (makeRunDir creates it)
    writeRunReport({ dir: runDir, tier: 'fast', preset: 'quick', results: [], line: 'version test', exitCode: 0, ms: 1, env })
    const summary = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'))
    expect(summary.version).toBe(VERSION)
  })

  test('MCP context and the initialize reply (serverInfo.version)', async () => {
    expect(createContext().version).toBe(VERSION)
    const reply = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, createContext())
    expect(reply.result.serverInfo.version).toBe(VERSION)
  })

  test('meerkat bug report names the version', () => {
    expect(buildBugReport({ env: { ...process.env, MEERKAT_LOG_DIR: join(tmpdir(), 'meerkat-no-logs-here') } })).toContain(`- Meerkat version: ${VERSION}`)
  })
})

describe('no file under lib, bin, tools or docs hard-codes the current version', () => {
  test('the current version string appears only in package.json, tests and the CHANGELOG', () => {
    const esc = VERSION.replace(/\./g, '\\.')
    const pattern = new RegExp(`(?<![\\d.])${esc}(?!\\.?\\d)`)
    const text = /\.(mjs|cjs|js|json|md|txt|ts)$/
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') walk(p)
        } else if (text.test(e.name) && !/\.test\./.test(e.name) && !/^CHANGELOG/i.test(e.name) && pattern.test(readFileSync(p, 'utf8'))) {
          offenders.push(p.slice(root.length + 1))
        }
      }
    }
    for (const d of ['lib', 'bin', 'tools', 'docs']) walk(join(root, d))
    expect(offenders).toEqual([])
  })
})
