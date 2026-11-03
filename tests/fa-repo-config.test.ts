// False alarms on clean twins from the repository and configuration checks: each change is tested on both sides, the clean shape stays quiet and the planted shape is still reported.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const project = (files: Record<string, string>, history = false) => {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-farc-'))
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), text)
  }
  if (history) {
    const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { stdio: 'ignore' })
    git('init', '-q')
    git('add', '-A', '-f')
    git('commit', '-q', '-m', 'one')
  }
  return dir
}
const run = (script: string, id: string, dir: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [join(root, 'thorough', script), id, '--root', dir], { encoding: 'utf8', env: { ...process.env, ...env } })
const found = (script: string, id: string, files: Record<string, string>, history = false) => {
  const dir = project(files, history)
  try {
    return run(script, id, dir).status === 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const PLACEHOLDERS = 'NEXT_PUBLIC_SITE_NAME=Shopfront\nSTRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}\nDATABASE_URL=${DATABASE_URL}\n# comment\nTOKEN=\n'
const SECRET = 'NEXT_PUBLIC_SITE_NAME=Shopfront\nSTRIPE_SECRET_KEY=sk_live_abcdefghijklmnop\n'
const STUB_KEY = '\n# the key is mounted at runtime from the secret store\n'
const REAL_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n'

describe('sensitive-files', () => {
  test('an environment file of placeholders and plain settings is not a leak', () => {
    expect(found('hygiene.mjs', 'sensitive-files', { '.env.production': PLACEHOLDERS })).toBe(false)
  })
  test('an environment file with a secret value is still reported', () => {
    expect(found('hygiene.mjs', 'sensitive-files', { '.env.production': SECRET })).toBe(true)
    expect(found('hygiene.mjs', 'sensitive-files', { '.env': 'DATABASE_URL=postgres://app:hunter22@db.internal:5432/app\n' })).toBe(true)
  })
  test('a key file holding only comments is a stub, a key file with a key is reported', () => {
    expect(found('hygiene.mjs', 'sensitive-files', { 'certs/server.key': STUB_KEY })).toBe(false)
    expect(found('hygiene.mjs', 'sensitive-files', { 'certs/server.key': REAL_KEY })).toBe(true)
    expect(found('hygiene.mjs', 'sensitive-files', { 'id_rsa': REAL_KEY })).toBe(true)
  })
})

describe('env-files-in-history', () => {
  test('placeholder environment files and a stub key were never a leak', () => {
    expect(found('sec-supply.mjs', 'env-files-in-history', { '.env.production': PLACEHOLDERS, 'certs/server.key': STUB_KEY }, true)).toBe(false)
  })
  test('a committed environment file with a secret, or a real key, is still reported', () => {
    expect(found('sec-supply.mjs', 'env-files-in-history', { '.env.production': SECRET }, true)).toBe(true)
    expect(found('sec-supply.mjs', 'env-files-in-history', { 'certs/server.key': REAL_KEY }, true)).toBe(true)
  })
})

describe('ui-static', () => {
  const page = (lang: string) => `<!doctype html>\n<html${lang}><head><meta charset="utf-8"><title>About</title></head><body><main><h1>About</h1></main></body></html>\n`
  test('rel="noreferrer" already implies noopener, a bare target=_blank is still reported', () => {
    expect(found('hygiene.mjs', 'ui-static', { 'src/Social.jsx': 'export const A = () => <a href="/x" target="_blank" rel="noreferrer">Follow</a>\n' })).toBe(false)
    expect(found('hygiene.mjs', 'ui-static', { 'src/Social.jsx': 'export const A = () => <a href="/x" target="_blank">Follow</a>\n' })).toBe(true)
  })
  test('a desktop app window needs no viewport tag, a website page does', () => {
    expect(found('hygiene.mjs', 'ui-static', { 'renderer/index.html': page(' lang="en"'), 'package.json': '{"devDependencies":{"electron":"^30.0.0"}}' })).toBe(false)
    expect(found('hygiene.mjs', 'ui-static', { 'renderer/index.html': page(' lang="en"'), 'package.json': '{"dependencies":{"express":"^4.19.0"}}' })).toBe(true)
  })
  test('a missing lang is still reported in a desktop app', () => {
    expect(found('hygiene.mjs', 'ui-static', { 'renderer/index.html': page(''), 'package.json': '{"devDependencies":{"electron":"^30.0.0"}}' })).toBe(true)
  })
})

describe('severity of opinion-level findings', () => {
  const finding = (script: string, id: string, files: Record<string, string>, rule: string) => {
    const dir = project(files)
    try {
      const out = run(script, id, dir, { MEERKAT_FINDINGS: 'all' }).stdout
      return out.split('\n').filter((l) => l.startsWith('MEERKAT-FINDING') && l.includes(` ${rule} `))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const COMPOSE = 'services:\n  db:\n    image: postgres:16.3\n    restart: unless-stopped\n'
  test('the compose hardening hints are info and still reported', () => {
    for (const rule of ['compose-no-new-privileges-missing', 'compose-read-only-missing']) {
      const lines = finding('infra-plus.mjs', 'ip-terraform-compose', { 'compose/db.yml': COMPOSE }, rule)
      expect(lines.length).toBe(1)
      expect(lines[0]).toContain('MEERKAT-FINDING info ')
    }
  })
  test('the compose hardening hints are quiet once the service sets them', () => {
    const hardened = `${COMPOSE}    read_only: true\n    security_opt:\n      - no-new-privileges:true\n`
    expect(finding('infra-plus.mjs', 'ip-terraform-compose', { 'compose/db.yml': hardened }, 'compose-read-only-missing')).toEqual([])
    expect(finding('infra-plus.mjs', 'ip-terraform-compose', { 'compose/db.yml': hardened }, 'compose-no-new-privileges-missing')).toEqual([])
  })
  test('debug-leftovers and tsconfig-strict are below bug severity', async () => {
    const { defaultSeverity, meetsSeverity } = await import(pathToFileURL(join(root, 'lib', 'findings.mjs')).href)
    expect(meetsSeverity(defaultSeverity({ id: 'debug-leftovers', group: 'functionality' }), 'medium')).toBe(false)
    expect(defaultSeverity({ id: 'tsconfig-strict', group: 'functionality' })).toBe('info')
    expect(defaultSeverity({ id: 'broken-imports', group: 'functionality' })).toBe('medium')
  })
  test('both are still reported', () => {
    expect(found('quality.mjs', 'debug-leftovers', { 'src/app.js': 'debugger;\n' })).toBe(true)
    expect(found('config.mjs', 'tsconfig-strict', { 'src/a.ts': 'export const a = 1\n' })).toBe(true)
  })
})

describe('rapi-missing-docs-lint', () => {
  const lines = (files: Record<string, string>) => {
    const dir = project(files)
    try {
      return run('rust-plus.mjs', 'rp-api-ffi-wasm', dir, { MEERKAT_FINDINGS: 'all' }).stdout.split('\n').filter((l) => l.startsWith('MEERKAT-FINDING') && l.includes(' rapi-missing-docs-lint '))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const SRC = 'pub fn load() -> u32 {\n    0\n}\n'
  test('only the crate root is asked for the lint, as info', () => {
    const r = lines({ 'src/lib.rs': SRC, 'src/auth.rs': SRC, 'src/store.rs': SRC })
    expect(r.length).toBe(1)
    expect(r[0]).toContain('MEERKAT-FINDING info rapi-missing-docs-lint src/lib.rs:')
  })
  test('a crate root with the lint is quiet', () => {
    expect(lines({ 'src/lib.rs': `#![deny(missing_docs)]\n\n/// Loads.\n${SRC}`, 'src/auth.rs': SRC })).toEqual([])
  })
})

describe('the corpus twins', () => {
  test('the lockfile of a tidy twin records the direct dependencies, so the two lockfile checks agree with the manifest', async () => {
    const { lockFor } = await import(pathToFileURL(join(root, 'tools', 'accuracy-corpus.mjs')).href)
    const manifest = JSON.stringify({ name: 'shop', version: '1.0.0', dependencies: { next: '^14.2.0', react: '18.3.1' }, devDependencies: { vitest: '~1.6.0' } })
    const lock = lockFor({ 'package.json': [manifest] })
    const parsed = JSON.parse(lock)
    expect(parsed.packages[''].dependencies).toEqual({ next: '^14.2.0', react: '18.3.1' })
    expect(parsed.packages['node_modules/next'].version).toBe('14.2.0')
    expect(parsed.packages['node_modules/vitest'].version).toBe('1.6.0')
    const files = { 'package.json': manifest, 'package-lock.json': lock }
    expect(found('health.mjs', 'lockfile-in-sync', files)).toBe(false)
    expect(found('repo-files.mjs', 'lockfile-sync', files)).toBe(false)
  })
  test('a lockfile that lacks a dependency is still reported by both checks', () => {
    const files = {
      'package.json': JSON.stringify({ name: 'shop', version: '1.0.0', dependencies: { next: '^14.2.0' } }),
      'package-lock.json': JSON.stringify({ name: 'shop', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'shop', version: '1.0.0' } } }),
    }
    expect(found('health.mjs', 'lockfile-in-sync', files)).toBe(true)
    expect(found('repo-files.mjs', 'lockfile-sync', files)).toBe(true)
  })
  test('importStubs gives each missing relative import a module, and leaves existing files alone', async () => {
    const { importStubs } = await import(pathToFileURL(join(root, 'tools', 'accuracy-corpus.mjs')).href)
    const stubs = importStubs({
      'app/actions/search.js': ["const db = require('../db')", "const own = require('./own')", "import x from '../../lib/x.js'"],
      'app/actions/own.js': ['module.exports = 1'],
      'lib/x.js': ['export default 1'],
      'README.md': ["see require('./nothing')"],
    })
    expect(Object.keys(stubs)).toEqual(['app/db.js'])
    const dir = project({ 'app/actions/search.js': "const db = require('../db')\n" })
    try {
      expect(run('static.mjs', 'broken-imports', dir).status).toBe(1)
      mkdirSync(join(dir, 'app'), { recursive: true })
      writeFileSync(join(dir, 'app', 'db.js'), `${stubs['app/db.js'].join('\n')}`)
      expect(run('static.mjs', 'broken-imports', dir).status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test('the static-site twin carries the lang attribute that its planted page lacks', async () => {
    const { generateCorpus } = await import(pathToFileURL(join(root, 'tools', 'accuracy-corpus.mjs')).href)
    const out = mkdtempSync(join(tmpdir(), 'meerkat-farc-corpus-'))
    try {
      const r = generateCorpus(out)
      expect(run('hygiene.mjs', 'ui-static', r.projects['client-static-site-clean']).stdout).not.toContain('about.html')
      expect(run('hygiene.mjs', 'ui-static', r.projects['client-static-site']).stdout).toContain('public/about.html: <html> has no lang attribute')
      const planted = r.planted.find((p: any) => p.key === 'client-site-nolang')
      expect(planted.file).toBe('public/about.html')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120000)
})
