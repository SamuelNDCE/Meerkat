// Clean twins in the accuracy corpus are well-kept repositories, so a hygiene check that fires on one is a real false alarm; planted projects keep their defects.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let out = ''
let mod: any

const check = (script: string, id: string, cwd: string) => spawnSync(process.execPath, [join(root, 'thorough', script), id], { cwd, encoding: 'utf8' })

beforeAll(async () => {
  mod = await import(pathToFileURL(join(root, 'tools', 'accuracy-corpus.mjs')).href)
  out = mkdtempSync(join(tmpdir(), 'meerkat-fa-'))
  mod.generateCorpus(out)
}, 120000)

describe('severity of the rate-limit check', () => {
  test('rate-limit-present is a low note, other functionality checks keep medium', async () => {
    const { defaultSeverity } = await import(pathToFileURL(join(root, 'lib', 'findings.mjs')).href)
    expect(defaultSeverity({ id: 'rate-limit-present', group: 'functionality' })).toBe('low')
    expect(defaultSeverity({ id: 'error-leak', group: 'functionality' })).toBe('medium')
  })
})

describe('clean twins hold what the hygiene checks ask for', () => {
  test.each([
    ['repo-docs.mjs', 'gitignore-essentials'],
    ['repo-docs.mjs', 'contributing-file'],
    ['repo-docs.mjs', 'ci-present'],
    ['repo-docs.mjs', 'dependency-updates-configured'],
    ['hygiene.mjs', 'lockfiles'],
    ['git.mjs', 'author-identity'],
    ['static.mjs', 'env-example'],
    ['quality.mjs', 'test-presence'],
  ])('%s %s passes on a clean twin', (script, id) => {
    for (const twin of ['ai-jwt-decode-auth-clean', 'crit-exec-clean']) {
      const r = check(script, id, join(out, twin))
      expect(r.status, `${twin} ${id}: ${r.stdout}${r.stderr}`).toBe(0)
    }
  })

  test('the same checks still fail on a repository that lacks the things', () => {
    const hygiene = join(out, 'package-hygiene')
    expect(check('repo-docs.mjs', 'gitignore-essentials', hygiene).status).not.toBe(0)
    expect(check('repo-docs.mjs', 'ci-present', hygiene).status).not.toBe(0)
    const bare = mkdtempSync(join(tmpdir(), 'meerkat-fa-bare-'))
    writeFileSync(join(bare, 'package.json'), '{"name":"x","version":"1.0.0"}\n')
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=Root', '-c', 'user.email=root@localhost', '-c', 'commit.gpgsign=false', ...a], { cwd: bare })
    g('init', '-q', '-b', 'main')
    g('add', '-A')
    g('commit', '-q', '-m', 'init')
    expect(check('hygiene.mjs', 'lockfiles', bare).status).not.toBe(0)
    expect(check('git.mjs', 'author-identity', bare).status).not.toBe(0)
    expect(check('repo-docs.mjs', 'dependency-updates-configured', bare).status).not.toBe(0)
  })

  test('the corpus commits with a real-looking address, not a placeholder', () => {
    const email = execFileSync('git', ['log', '-1', '--format=%ae'], { cwd: join(out, 'crit-exec-clean'), encoding: 'utf8' }).trim()
    expect(email).not.toMatch(/example\.(com|org|net)$|localhost$/)
  })
})

describe('helpers for a well-kept project', () => {
  test('wellKeptExtras documents env variables and adds a test per big source folder', () => {
    const files: Record<string, string[]> = { 'src/a.js': ['const k = process.env.MY_SECRET_THING'], 'main/x.py': ["import os\nos.getenv('DB_HOST')"] }
    for (let i = 0; i < 11; i++) files[`big/m${i}.js`] = ['module.exports = 1']
    const extra = mod.wellKeptExtras(files)
    expect(extra['.env.example']?.[0]).toContain('MY_SECRET_THING=')
    expect(extra['.env.example']?.[0]).toContain('DB_HOST=')
    expect(Object.keys(extra)).toContain('tests/m0.test.js')
    expect(Object.keys(extra).filter((k) => k.startsWith('tests/'))).toHaveLength(1)
  })

  test('wellKeptExtras adds nothing when there are no variables and few files', () => {
    expect(mod.wellKeptExtras({ 'src/a.js': ['module.exports = 1'] })).toEqual({})
  })

  test('lockFor returns a lockfile for a manifest and null for broken JSON', () => {
    const lock = JSON.parse(mod.lockFor({ 'package.json': ['{"name":"p","version":"1.2.0"}'] }))
    expect(lock.lockfileVersion).toBe(3)
    expect(lock.packages[''].name).toBe('p')
    expect(mod.lockFor({ 'package.json': ['{not json'] })).toBeNull()
  })
})

describe('the clean Kubernetes twin is hardened and the planted one keeps its defect', () => {
  const read = (p: string) => readFileSync(join(out, p), 'utf8')
  test('clean manifests have probes, resources, a security context and a service account', () => {
    const t = read('med-config-clean/k8s/api-hostnet.yaml')
    for (const want of ['readinessProbe:', 'livenessProbe:', 'requests:', 'limits:', 'seccompProfile:', 'readOnlyRootFilesystem: true', 'runAsNonRoot: true', 'allowPrivilegeEscalation: false', 'serviceAccountName:']) expect(t).toContain(want)
    expect(existsSync(join(out, 'med-config-clean/k8s/networkpolicy.yaml'))).toBe(true)
    expect(read('med-config-clean/k8s/builder-sock.yaml')).not.toContain('hostPath')
  })
  test('planted manifests still carry their defect line', () => {
    expect(read('med-config/k8s/builder-sock.yaml')).toContain('/var/run/docker.sock')
    expect(read('med-config/k8s/batch-root.yaml')).toContain('runAsUser: 0')
    expect(read('med-config/k8s/api-escalation.yaml')).toContain('allowPrivilegeEscalation: true')
    expect(read('med-config/k8s/worker-priv.yaml')).toContain('privileged: true')
    expect(read('med-config-clean/k8s/worker-priv.yaml')).toContain('privileged: false')
  })
  test('GitHub Actions workflows set a timeout and read-only token, except the write-all defect', () => {
    expect(read('med-config-clean/.github/workflows/med-curl.yml')).toContain('timeout-minutes: 15')
    expect(read('med-config-clean/.github/workflows/med-curl.yml')).toContain('contents: read')
    expect(read('med-config/.github/workflows/med-write-all.yml')).toContain('permissions: write-all')
    expect(read('med-config/.github/workflows/med-write-all.yml').match(/^permissions:/gm)).toHaveLength(1)
  })
  test('Dockerfile projects have a .dockerignore', () => {
    expect(existsSync(join(out, 'infra-stack/.dockerignore'))).toBe(true)
    expect(existsSync(join(out, 'x-docker/docker/.dockerignore'))).toBe(true)
  })
})
