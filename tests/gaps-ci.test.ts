// Accuracy-corpus gaps in CI and infrastructure rules: each widened rule reports the planted shape and stays quiet on a similar clean one.
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

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-gapsci-'))
  made.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return dir
}

function run(script: string, check: string, root: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [script, check, '--root', root], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

// infra-plus prints one MEERKAT-SUB line per rule; a rule fired when its line says FAIL.
function fired(check: string, root: string, rule: string): boolean {
  const { out } = run('thorough/infra-plus.mjs', check, root)
  return out.split('\n').some((l) => l.includes(rule) && /FAIL/.test(l))
}

const sg = (cidrLine: string) => `resource "aws_security_group" "c" {\n  ingress {\n    from_port = 22\n    to_port = 22\n    ${cidrLine}\n  }\n}\n`

describe('terraform: SSH open to every IPv6 address', () => {
  test('ipv6 ::/0 on port 22 reports', () => {
    expect(fired('ip-terraform-compose', folder({ 'terraform/v6.tf': sg('ipv6_cidr_blocks = ["::/0"]') }), 'tf-sg-open-22')).toBe(true)
  })
  test('a private ipv6 range does not', () => {
    expect(fired('ip-terraform-compose', folder({ 'terraform/v6.tf': sg('ipv6_cidr_blocks = ["fd00::/8"]') }), 'tf-sg-open-22')).toBe(false)
  })
  test('a private ipv4 range still does not', () => {
    expect(fired('ip-terraform-compose', folder({ 'terraform/v4.tf': sg('cidr_blocks = ["10.0.0.0/8"]') }), 'tf-sg-open-22')).toBe(false)
  })
})

describe('github actions: quoted write-all and the pull merge ref', () => {
  test('permissions: "write-all" reports', () => {
    expect(fired('ip-gha', folder({ '.github/workflows/a.yml': 'on: push\npermissions: "write-all"\njobs:\n  b:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo hi\n' }), 'gha-permissions-write-all')).toBe(true)
  })
  test('read-all and a quoted contents: read do not', () => {
    const wf = 'on: push\npermissions: read-all\njobs:\n  b:\n    runs-on: ubuntu-24.04\n    permissions:\n      contents: "read"\n    steps:\n      - run: echo hi\n'
    expect(fired('ip-gha', folder({ '.github/workflows/a.yml': wf }), 'gha-permissions-write-all')).toBe(false)
  })
  const prt = (ref: string, on = 'pull_request_target') => `on: ${on}\njobs:\n  b:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332\n        with:\n          ref: ${ref}\n`
  test('checkout of refs/pull/N/merge under pull_request_target reports', () => {
    expect(fired('ip-gha', folder({ '.github/workflows/p.yml': prt('refs/pull/${{ github.event.number }}/merge') }), 'gha-prt-checkout-pr-head')).toBe(true)
  })
  test('the same ref under pull_request, or a main ref under pull_request_target, does not', () => {
    expect(fired('ip-gha', folder({ '.github/workflows/p.yml': prt('refs/pull/${{ github.event.number }}/merge', 'pull_request') }), 'gha-prt-checkout-pr-head')).toBe(false)
    expect(fired('ip-gha', folder({ '.github/workflows/p.yml': prt('refs/heads/main') }), 'gha-prt-checkout-pr-head')).toBe(false)
  })
})

describe('ci systems: gitlab dind, circleci latest, jenkins curl pipe', () => {
  test('dind with TLS off in a *.gitlab-ci.yml file reports', () => {
    const y = 'deploy:\n  image: docker:24\n  services:\n    - docker:24-dind\n  variables:\n    DOCKER_TLS_CERTDIR: ""\n  script: [docker ps]\n'
    expect(run('thorough/ci-systems.mjs', 'gitlab-ci-privileged', folder({ 'ci/gitlab-extra.gitlab-ci.yml': y })).code).toBe(1)
  })
  test('dind with TLS on does not', () => {
    const y = 'deploy:\n  image: docker:24\n  services:\n    - docker:24-dind\n  variables:\n    DOCKER_TLS_CERTDIR: "/certs"\n  script: [docker ps]\n'
    expect(run('thorough/ci-systems.mjs', 'gitlab-ci-privileged', folder({ 'ci/gitlab-extra.gitlab-ci.yml': y })).code).toBe(0)
  })
  const circle = (img: string) => `version: 2.1\njobs:\n  build:\n    docker:\n      - image: ${img}\n    steps:\n      - checkout\n`
  test('circleci image with the latest tag reports', () => {
    expect(run('thorough/ci-systems.mjs', 'circleci-config', folder({ '.circleci/config.yml': circle('cimg/node:latest') })).code).toBe(1)
  })
  test('circleci pinned image does not', () => {
    expect(run('thorough/ci-systems.mjs', 'circleci-config', folder({ '.circleci/config.yml': circle('cimg/node:20.11') })).code).toBe(0)
  })
  const jf = (step: string) => `pipeline {\n  agent { label "linux" }\n  stages {\n    stage("build") {\n      steps {\n        ${step}\n      }\n    }\n  }\n}\n`
  test('jenkins curl piped to sh reports', () => {
    expect(run('thorough/ci-systems.mjs', 'jenkinsfile-safety', folder({ Jenkinsfile: jf('sh "curl -sSL https://example.com/i.sh | sh"') })).code).toBe(1)
  })
  test('jenkins curl saved to a file does not', () => {
    expect(run('thorough/ci-systems.mjs', 'jenkinsfile-safety', folder({ Jenkinsfile: jf('sh "curl -sSL -o i.sh https://example.com/i.sh"') })).code).toBe(0)
  })
})
