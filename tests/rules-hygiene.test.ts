// Both sides of the hygiene rule fixes: each rule must fire on a planted sample in the shape that used to be missed, and stay quiet on a clean twin.
// Shapes: changelog headings with no date (also in a CHANGES/ folder), a Makefile inside build/, Compose files that are not called compose*.yml,
// a Docker socket mounted by a Compose service, a user name and password inside a link in an HTML page, tracker and font hosts reported as info
// findings, and an Info.plist ATS setting in a project that is not Electron.
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

function folderOf(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-hygiene-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body)
  }
  return dir
}

// Runs one check script on a folder: its exit code and everything it printed.
function run(script: string, check: string, dir: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [`thorough/${script}.mjs`, check, '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

describe('changelog-format asks every release heading for a date', () => {
  test('flags an undated version, also in a CHANGES/ folder', () => {
    const r = run('repo-docs', 'changelog-format', folderOf({ 'CHANGES/CHANGELOG.md': '# Changelog\n\n## 1.2.0\n- fixed some things\n' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/CHANGES\/CHANGELOG\.md: version 1\.2\.0 has no release date/)
  })
  test('flags only the undated one when others are dated', () => {
    const r = run('repo-docs', 'changelog-format', folderOf({ 'CHANGELOG.md': '# Changelog\n\n## 1.3.0 - 2026-10-01\n- a\n\n## 1.2.0\n- b\n' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/version 1\.2\.0 has no release date/)
    expect(r.out).not.toMatch(/version 1\.3\.0 has no release date/)
  })
  test('accepts the common date spellings and an Unreleased heading', () => {
    const body = [
      '# Changelog',
      '## Unreleased',
      '## [2.0.0] - 2026-10-01',
      '## v1.9.0 (2026/09/01)',
      '## 1.8.0 / 01.08.2026',
      '## 1.7.0 - Jul 4, 2026',
      '## 1.6.0 - 2 June 2026',
      '## 1.5.0 - May 2026',
      '',
    ].join('\n')
    const r = run('repo-docs', 'changelog-format', folderOf({ 'CHANGELOG.md': body }))
    expect(r.out).not.toMatch(/no release date/)
    expect(r.code).toBe(0)
  })
  test('still flags versions listed oldest first', () => {
    const r = run('repo-docs', 'changelog-format', folderOf({ 'CHANGELOG.md': '# Changelog\n\n## 1.0.0 - 2026-01-01\n\n## 2.0.0 - 2026-02-01\n' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/newer versions go first/)
  })
})

describe('makefile-tabs reads a tracked Makefile in a build/ folder', () => {
  test('flags space-indented recipes in build/Makefile.mk and build/GNUmakefile', () => {
    const r = run('quality', 'makefile-tabs', folderOf({ 'build/Makefile.mk': 'all:\n        echo hi\n', 'build/GNUmakefile': 'all:\n    echo hi\n' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/build\/Makefile\.mk:2 a recipe line is indented with spaces/)
    expect(r.out).toMatch(/build\/GNUmakefile:2 a recipe line is indented with spaces/)
  })
  test('passes the same files written with tabs, and skips a vendored Makefile', () => {
    const r = run('quality', 'makefile-tabs', folderOf({
      'build/Makefile.mk': '.PHONY: all\nall:\n\techo hi\n',
      'node_modules/dep/Makefile': 'all:\n    echo hi\n',
    }))
    expect(r.out).not.toMatch(/indented with spaces/)
    expect(r.code).toBe(0)
  })
})

const DB = 'services:\n  db:\n    image: postgres:16.3\n    restart: unless-stopped\n'
describe('compose-hygiene finds a Compose file whatever it is called', () => {
  test('flags latest tag, password, open database port and privileged in compose/*.yml', () => {
    const dir = folderOf({
      'compose/latest-db.yml': 'services:\n  db:\n    image: postgres:latest\n',
      'compose/password.yml': 'services:\n  db:\n    image: postgres:16.3\n    environment:\n      POSTGRES_PASSWORD: hunter2hunter2\n',
      'compose/dbport.yml': 'services:\n  db:\n    image: postgres:16.3\n    ports:\n      - "5432:5432"\n',
      'compose/privileged.yml': 'services:\n  agent:\n    image: agent:1.4.0\n    privileged: true\n',
    })
    const r = run('config', 'compose-hygiene', dir)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/compose\/latest-db\.yml: line 3 uses image postgres:latest/)
    expect(r.out).toMatch(/compose\/password\.yml: line 5 writes POSTGRES_PASSWORD/)
    expect(r.out).toMatch(/compose\/dbport\.yml: line 5 publishes database port 5432/)
    expect(r.out).toMatch(/compose\/privileged\.yml: line 4 runs a container privileged/)
  })
  test('passes the safe twins and ignores YAML that is not Compose', () => {
    const dir = folderOf({
      'compose/db.yml': DB.replace('restart', 'ports:\n      - "127.0.0.1:5432:5432"\n    restart'),
      'ci/gitlab.yml': 'image: node:latest\nservices:\n  - postgres:latest\n',
      'ci/gha.yml': 'jobs:\n  t:\n    services:\n      db:\n        image: postgres:latest\n',
      'k8s/pod.yaml': 'apiVersion: v1\nkind: Pod\nspec:\n  containers:\n    - image: nginx:latest\n',
    })
    const r = run('config', 'compose-hygiene', dir)
    expect(r.out).not.toMatch(/ci\/|k8s\//)
    expect(r.code).toBe(0)
  })
})

describe('ip-terraform-compose reports a mounted Docker socket, in any Compose file', () => {
  const sock = (line: string) => `services:\n  ci:\n    image: ci:2.0.0\n    volumes:\n${line}\n`
  test('short syntax, quoted, with :ro, and long syntax all fire', () => {
    const dir = folderOf({
      'compose/short.yml': sock('      - /var/run/docker.sock:/var/run/docker.sock'),
      'compose/quoted.yml': sock('      - "/var/run/docker.sock:/var/run/docker.sock:ro"'),
      'compose/long.yml': sock('      - type: bind\n        source: /var/run/docker.sock\n        target: /var/run/docker.sock'),
    })
    const r = run('infra-plus', 'ip-terraform-compose', dir)
    expect(r.out).toMatch(/FINDING high compose-docker-socket compose\/short\.yml:5/)
    expect(r.out).toMatch(/FINDING high compose-docker-socket compose\/quoted\.yml:5/)
    expect(r.out).toMatch(/FINDING high compose-docker-socket compose\/long\.yml:6/)
  })
  test('an ordinary volume and a DOCKER_HOST variable do not fire', () => {
    const dir = folderOf({
      'compose/ok.yml': sock('      - ./data:/data'),
      'compose/env.yml': 'services:\n  ci:\n    image: ci:2.0.0\n    environment:\n      - DOCKER_HOST=unix:///var/run/docker.sock\n',
    })
    const r = run('infra-plus', 'ip-terraform-compose', dir)
    expect(r.out).not.toMatch(/FINDING w+ compose-docker-socket/)
  })
})

describe('credentials-in-urls reads web pages and templates', () => {
  test('flags a link with a user name and password in HTML', () => {
    const r = run('sec-code', 'credentials-in-urls', folderOf({ 'public/download.html': '<main>\n<a href="https://deploy:svWQF1SRXsgdr4kt@files.shopfront.dev/app.zip">Download</a>\n</main>\n' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/public\/download\.html:2 a web address has a user name and password/)
  })
  test('passes the same link without credentials, and a placeholder user and password', () => {
    const r = run('sec-code', 'credentials-in-urls', folderOf({
      'public/download.html': '<a href="https://files.shopfront.dev/app.zip">Download</a>\n<p>postgres://user:password@localhost/db</p>\n',
    }))
    expect(r.code).toBe(0)
  })
})

describe('tracker and font hosts that are only listed are also reported as info findings', () => {
  test('third-party-trackers and external-fonts-cdn pass, and name the place', () => {
    const dir = folderOf({
      'public/stats.html': '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>\n',
      'public/fonts.html': '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">\n',
    })
    const t = run('privacy', 'third-party-trackers', dir)
    expect(t.code).toBe(0)
    expect(t.out).toMatch(/MEERKAT-FINDING info third-party-trackers public\/stats\.html:1 /)
    const f = run('privacy', 'external-fonts-cdn', dir)
    expect(f.code).toBe(0)
    expect(f.out).toMatch(/MEERKAT-FINDING info external-fonts-cdn public\/fonts\.html:1 /)
  })
  test('self-hosted assets produce nothing', () => {
    const dir = folderOf({ 'public/index.html': '<script src="/js/app.js"></script>\n<link rel="stylesheet" href="/fonts/inter.css">\n' })
    expect(run('privacy', 'third-party-trackers', dir).out).not.toMatch(/MEERKAT-FINDING/)
    expect(run('privacy', 'external-fonts-cdn', dir).out).not.toMatch(/MEERKAT-FINDING/)
  })
})

describe('the Info.plist ATS rule runs in a project that is not Electron', () => {
  const plist = (v: string) => `<dict>\n<key>NSAllowsArbitraryLoads</key>\n<${v}/>\n</dict>\n`
  test('NSAllowsArbitraryLoads true fires in a React Native app', () => {
    const r = run('electron-plus', 'ep-fuses-build', folderOf({ 'package.json': '{"dependencies":{"react-native":"0.74.0"}}\n', 'ios/Shop/Info.plist': plist('true') }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FINDING medium ep-plist-arbitrary-loads ios\/Shop\/Info\.plist:2/)
  })
  test('false passes, and the Electron-only rules stay off', () => {
    const r = run('electron-plus', 'ep-fuses-build', folderOf({
      'package.json': '{"dependencies":{"react-native":"0.74.0"},"scripts":{"start":"ELECTRON_DISABLE_SECURITY_WARNINGS=true x"}}\n',
      'ios/Shop/Info.plist': plist('false'),
    }))
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/MEERKAT-SUB NA ep-pkg-security-warnings-off/)
    expect(r.out).toMatch(/MEERKAT-SUB PASS ep-plist-arbitrary-loads/)
  })
})
