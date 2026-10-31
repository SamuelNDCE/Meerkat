// The ci-systems checks (thorough/ci-systems.mjs): each check must fail on its own fixture, pass when the project does not use that
// system, pass on a well-written project, honour the allow file, and the ci-systems pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/ci-systems.mjs'
const ALL = [
  'gitlab-ci-secrets',
  'gitlab-ci-images',
  'gitlab-ci-privileged',
  'gitlab-ci-stages',
  'circleci-config',
  'azure-pipelines',
  'jenkinsfile-safety',
  'github-actions-reusable',
  'github-actions-concurrency',
  'github-actions-artifacts',
  'helm-chart-basics',
  'helm-values-secrets',
  'ansible-hygiene',
  'pre-commit-config',
]

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code and printed output (0 clean, 1 findings, 75 not run, anything else is a crash).
function run(args: string[], root?: string): { code: number; out: string } {
  const full = root ? [...args, '--root', root] : args
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...full], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

// A folder with the given files (relative path to body). Returned path is removed after the run.
function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-cisystems-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

// A small project with no CI system at all: every check must say not applicable.
function plainFolder(): string {
  return folder({ 'package.json': '{\n  "name": "plain",\n  "version": "1.0.0"\n}\n', 'src/index.js': 'export const x = 1\n' })
}

// A well-written project that uses most of the systems: every check must pass.
function goodFolder(): string {
  return folder({
    '.gitlab-ci.yml': 'stages:\n  - build\n\nimage: node:20-alpine\n\nbuild:\n  stage: build\n  image: node:20-alpine\n  variables:\n    API_URL: https://example.com\n  script:\n    - npm ci\n',
    '.circleci/config.yml': 'version: 2.1\norbs:\n  aws: circleci/aws-cli@4.1.3\njobs:\n  build:\n    docker:\n      - image: cimg/node:20.11\n    steps:\n      - run: echo hi\n',
    'azure-pipelines.yml': 'pool:\n  vmImage: ubuntu-22.04\nsteps:\n  - script: echo hi\n',
    Jenkinsfile: 'pipeline {\n  agent { label "linux" }\n  stages {\n    stage("Build") {\n      steps {\n        sh "make build"\n      }\n    }\n  }\n}\n',
    '.github/workflows/deploy.yml':
      'name: deploy\non: push\nconcurrency:\n  group: deploy\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/upload-artifact@v4\n        with:\n          name: out\n          path: dist/\n          retention-days: 5\n',
    'Chart.yaml': 'apiVersion: v2\nname: app\nversion: 0.1.0\nappVersion: "1.0.0"\n',
    'values.yaml': 'image:\n  tag: "1.0.0"\n',
    'templates/deploy.yaml': 'spec:\n  replicas: 1\n',
    '.pre-commit-config.yaml': 'repos:\n  - repo: https://github.com/psf/black\n    rev: 24.4.2\n    hooks:\n      - id: black\n',
    'site.yml':
      '- hosts: web\n  become: true\n  become_user: root\n  tasks:\n    - name: install\n      package:\n        name: git\n        state: present\n    - name: set password\n      user:\n        name: app\n        password: "{{ app_password }}"\n        no_log: true\n',
  })
}

describe('ci-systems checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem with a found line`, () => {
      const r = run([check, '--fixtures'])
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/found \d+/)
      expect(r.out).not.toMatch(/cannot read/)
    })
  }
})

describe('ci-systems checks say not applicable when the system is absent', () => {
  const dir = plainFolder()
  for (const check of ALL) {
    test(`${check} passes on a project without that system`, () => {
      const r = run([check, '--root', dir])
      expect(r.code).toBe(0)
      expect(r.out).toContain('not applicable: no ')
    })
  }
})

describe('ci-systems checks pass on a well-written project', () => {
  const dir = goodFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      const r = run([check, '--root', dir])
      expect(r.code).toBe(0)
      expect(r.out).not.toMatch(/found \d+/)
    })
  }
})

describe('ci-systems checks on Meerkat itself', () => {
  for (const check of ALL) {
    test(`${check} has no false positive on this repository`, () => {
      expect(run([check], ROOT).code).toBe(0)
    })
  }
})

describe('the allow file', () => {
  test('a finding listed as "check-id path" is accepted', () => {
    const dir = folder({ '.gitlab-ci.yml': 'build:\n  image: node\n  script: echo hi\n' })
    expect(run(['gitlab-ci-images'], dir).code).toBe(1)
    writeFileSync(join(dir, '.meerkat-cisystems-allow'), '# reviewed\ngitlab-ci-images .gitlab-ci.yml\n')
    expect(run(['gitlab-ci-images'], dir).code).toBe(0)
  })
})

describe('an unreadable folder is NOT RUN, not a pass', () => {
  test('a missing root exits 75', () => {
    expect(run(['gitlab-ci-secrets'], join(ROOT, 'no-such-folder-for-cisystems')).code).toBe(75)
  })
})

describe('the ci-systems pack', () => {
  test('loads 14 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'ci-systems'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(14)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
