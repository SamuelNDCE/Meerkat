// The infra-plus checks (Dockerfiles, Kubernetes manifests, Terraform and Compose, GitHub Actions workflows): every rule table is proven
// by its own samples, each check's self-test fails with a finding, a clean project passes and an empty one is not applicable, the pack
// loads, and hostile input stays fast. The checks themselves are thorough/infra-plus.mjs and their rules thorough/rules-infra-plus.mjs.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'
// @ts-expect-error plain JS module
import { evaluate, selfProve } from './thorough/rules.mjs'
// @ts-expect-error plain JS module
import * as RI from './thorough/rules-infra-plus.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = join(ROOT, 'thorough', 'infra-plus.mjs')
const IDS = ['ip-docker', 'ip-k8s', 'ip-terraform-compose', 'ip-gha']
const TABLES = ['DOCKER_RULES', 'K8S_RULES', 'TF_RULES', 'COMPOSE_RULES', 'GHA_RULES']

// A file tree that follows every rule: no finding should come out of it.
const lines = (...l: string[]) => `${l.join('\n')}\n`
const CLEAN: Record<string, string> = {
  Dockerfile: lines(
    '# syntax=docker/dockerfile:1',
    'FROM node:22.11.0-alpine',
    'WORKDIR /app',
    'COPY package.json package-lock.json ./',
    'RUN npm ci --omit=dev',
    'COPY . .',
    'USER node',
    'HEALTHCHECK CMD wget -qO- http://localhost:3000/ || exit 1',
    'CMD ["node", "server.js"]',
  ),
  '.dockerignore': lines('node_modules', '.git'),
  'k8s/app.yaml': lines(
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: app',
    '  namespace: shop',
    'spec:',
    '  template:',
    '    spec:',
    '      serviceAccountName: app',
    '      automountServiceAccountToken: false',
    '      containers:',
    '        - name: app',
    '          image: registry.example.com/app:1.4.0',
    '          imagePullPolicy: IfNotPresent',
    '          securityContext:',
    '            allowPrivilegeEscalation: false',
    '            readOnlyRootFilesystem: true',
    '            runAsNonRoot: true',
    '            capabilities:',
    '              drop: [ALL]',
    '            seccompProfile:',
    '              type: RuntimeDefault',
    '          resources:',
    '            requests:',
    '              cpu: 10m',
    '              memory: 64Mi',
    '            limits:',
    '              memory: 128Mi',
    '          livenessProbe:',
    '            httpGet:',
    '              path: /',
    '              port: 8080',
    '          readinessProbe:',
    '            httpGet:',
    '              path: /',
    '              port: 8080',
    '---',
    'apiVersion: networking.k8s.io/v1',
    'kind: NetworkPolicy',
    'metadata:',
    '  name: app',
    'spec:',
    '  podSelector: {}',
    '  policyTypes: [Ingress]',
  ),
  'infra/main.tf': lines(
    'terraform {',
    '  required_version = ">= 1.6"',
    '  required_providers {',
    '    aws = {',
    '      source  = "hashicorp/aws"',
    '      version = "~> 5.0"',
    '    }',
    '  }',
    '  backend "s3" {',
    '    bucket  = "state"',
    '    key     = "app.tfstate"',
    '    encrypt = true',
    '  }',
    '}',
    'resource "aws_s3_bucket" "logs" {',
    '  bucket        = "app-logs"',
    '  force_destroy = false',
    '}',
    'resource "aws_s3_bucket_public_access_block" "logs" {',
    '  bucket            = aws_s3_bucket.logs.id',
    '  block_public_acls = true',
    '}',
    'resource "aws_s3_bucket_versioning" "logs" {}',
    'resource "aws_s3_bucket_logging" "logs" {}',
    'resource "aws_security_group_rule" "https" {',
    '  type        = "ingress"',
    '  from_port   = 443',
    '  to_port     = 443',
    '  cidr_blocks = ["10.0.0.0/16"]',
    '}',
    'variable "db_password" {',
    '  type      = string',
    '  sensitive = true',
    '}',
    'output "endpoint" {',
    '  value = "x"',
    '}',
  ),
  'compose.yaml': lines(
    'services:',
    '  web:',
    '    image: nginx:1.27.0',
    '    restart: unless-stopped',
    '    read_only: true',
    '    security_opt:',
    '      - no-new-privileges:true',
    '    cap_drop:',
    '      - ALL',
    '    depends_on:',
    '      db:',
    '        condition: service_healthy',
    '  db:',
    '    image: postgres:16.4',
    '    restart: unless-stopped',
    '    read_only: true',
    '    security_opt:',
    '      - no-new-privileges:true',
  ),
  '.github/workflows/ci.yml': lines(
    'name: CI',
    'on:',
    '  pull_request:',
    '  push:',
    '    branches: [main]',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  test:',
    '    name: Test',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          persist-credentials: false',
    '      - env:',
    '          TITLE: ${{ github.event.pull_request.title }}',
    '        run: echo "$TITLE"',
  ),
}

const writeTree = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'infraplus-test-'))
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}
const run = (id: string, args: string[] = []) => spawnSync(process.execPath, [SCRIPT, id, ...args], { encoding: 'utf8', timeout: 60000 })

describe('the rule tables are proven and large enough', () => {
  test('every rule carries a bad and a good sample that the engine proves', async () => {
    for (const name of TABLES) expect(selfProve((RI as Record<string, unknown[]>)[name]), name).toEqual([])
  })
  test('the rule total is at least 110', () => {
    const total = TABLES.reduce((n, t) => n + ((RI as Record<string, unknown[]>)[t]?.length ?? 0), 0)
    expect(total).toBeGreaterThanOrEqual(110)
  })
  test('the reported sub-check counts match the tables and the folder-level rules', () => {
    expect(RI.CHECK_SUBS['ip-docker']).toBe((RI.DOCKER_RULES as unknown[]).length + RI.DOCKER_EXTRA)
    expect(RI.CHECK_SUBS['ip-k8s']).toBe((RI.K8S_RULES as unknown[]).length + RI.K8S_EXTRA)
    expect(RI.CHECK_SUBS['ip-gha']).toBe((RI.GHA_RULES as unknown[]).length)
  })
})

describe('the checks', () => {
  test.each(IDS)('%s fails its own fixture with a finding (exit 1, says found)', (id) => {
    const r = run(id, ['--fixtures'])
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/found/)
    expect(r.stdout).toMatch(/MEERKAT-SUB FAIL /)
  })

  test('a clean project passes every check with PASS sub-check lines and no FAIL', () => {
    const dir = writeTree(CLEAN)
    for (const id of IDS) {
      const r = run(id, ['--root', dir])
      expect(r.stdout, id).not.toMatch(/MEERKAT-SUB FAIL/)
      expect(r.stdout, id).toMatch(/MEERKAT-SUB PASS /)
      expect(r.status, id).toBe(0)
    }
  })

  test('an empty project reports every rule as not applicable and exits 0', () => {
    const dir = writeTree({ 'README.md': 'hello\n' })
    for (const id of IDS) {
      const r = run(id, ['--root', dir])
      expect(r.status, id).toBe(0)
      expect(r.stdout, id).not.toMatch(/MEERKAT-SUB (PASS|FAIL) /)
      expect(r.stdout, id).toMatch(/MEERKAT-SUB NA /)
    }
  })

  test('a Dockerfile without .dockerignore beside it is a finding, and an allow-list entry clears it', () => {
    const dir = writeTree({ Dockerfile: lines('FROM alpine:3.20', 'USER app', 'HEALTHCHECK CMD true') })
    expect(run('ip-docker', ['--root', dir]).stdout).toMatch(/MEERKAT-SUB FAIL docker-dockerignore-missing/)
    writeFileSync(join(dir, '.meerkat-infraplus-allow'), 'docker-dockerignore-missing Dockerfile\n')
    expect(run('ip-docker', ['--root', dir]).stdout).not.toMatch(/MEERKAT-SUB FAIL docker-dockerignore-missing/)
  })

  test('a folder of workloads with no NetworkPolicy is a finding', () => {
    const dir = writeTree({ 'k8s/app.yaml': CLEAN['k8s/app.yaml'].split('---')[0] })
    expect(run('ip-k8s', ['--root', dir]).stdout).toMatch(/MEERKAT-SUB FAIL k8s-networkpolicy-missing/)
  })

  test('a pull_request_target workflow that checks out the PR head is flagged', () => {
    const dir = writeTree({
      '.github/workflows/review.yml': lines(
        'on: pull_request_target',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  review:',
        '    name: Review',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '        with:',
        '          ref: ${{ github.event.pull_request.head.sha }}',
      ),
    })
    expect(run('ip-gha', ['--root', dir]).stdout).toMatch(/MEERKAT-SUB FAIL gha-prt-checkout-pr-head/)
  })
})

describe('the pack and the ids', () => {
  test('the infra-plus pack loads with four checks, each self-testable and expecting a finding', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'infra-plus'))
    expect(checks.map((c: { id: string }) => c.id).sort()).toEqual([...IDS].sort())
    for (const c of checks) {
      expect(c.id.startsWith('bad-check-file'), c.id).toBe(false)
      expect(c.selfTest.expectFail, c.id).toBe(true)
      expect(c.selfTest.expectMatch, c.id).toBe('found')
      expect(c.subs, c.id).toBe((RI.CHECK_SUBS as Record<string, number>)[c.id])
      expect(c.needs, c.id).toEqual(['node'])
    }
  })

  test('check ids are unique across every pack folder and none is a bad-check-file', async () => {
    const { readdirSync } = await import('node:fs')
    const ids: string[] = []
    for (const d of readdirSync(join(ROOT, 'packs'), { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      for (const c of await loadChecks(join(ROOT, 'packs', d.name))) ids.push(c.id)
    }
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id.startsWith('bad-check-file'))).toEqual([])
  })
})

describe('hostile input', () => {
  test('long lines and dense repeated markers are evaluated in well under the time box', () => {
    const big = [
      `RUN ${'a '.repeat(50000)}`,
      '${{'.repeat(30000),
      'containers:\n'.repeat(20000),
      'apiVersion: v1\nkind: Deployment\n' + '      - "*"\n'.repeat(20000),
      'resource "aws_security_group_rule" "x" {\n' + 'cidr_blocks = ["0.0.0.0/0"]\n'.repeat(20000),
      'ENTRYPOINT ["a"]\n'.repeat(20000),
      '---\n'.repeat(20000),
      'image: x\n'.repeat(20000),
    ].join('\n')
    const started = Date.now()
    const files = ['Dockerfile', 'app.yaml', 'main.tf', 'compose.yaml', '.github/workflows/ci.yml']
    const tables: [string, string][] = [
      ['DOCKER_RULES', 'Dockerfile'],
      ['K8S_RULES', 'app.yaml'],
      ['TF_RULES', 'main.tf'],
      ['COMPOSE_RULES', 'compose.yaml'],
      ['GHA_RULES', '.github/workflows/ci.yml'],
    ]
    for (const [name, file] of tables) {
      evaluate('.', (RI as Record<string, unknown[]>)[name], { files: [file], read: () => big })
    }
    expect(files.length).toBe(5)
    expect(Date.now() - started).toBeLessThan(20000)
  }, 60000)
})


// @ts-expect-error plain JS module
import { evaluate as reviewEvaluate } from './thorough/rules.mjs'
// @ts-expect-error plain JS module
import { DOCKER_RULES as reviewDocker, GHA_RULES as reviewGha } from './thorough/rules-infra-plus.mjs'

describe('regressions found in review', () => {
  const found = (rules: any[], file: string, text: string) => reviewEvaluate('.', rules, { files: [file], read: () => text }).found.map((f: any) => f.rule)
  test('docker-no-user flags a Dockerfile whose last USER is root', () => {
    expect(found(reviewDocker, 'Dockerfile', 'FROM node:20\nUSER root\nCMD ["node","a.js"]\n')).toContain('docker-no-user')
    expect(found(reviewDocker, 'Dockerfile', 'FROM node:20\nUSER root\nUSER app\nCMD ["node","a.js"]\n')).not.toContain('docker-no-user')
  })
  test('gha-contents-write sees the flow style permissions { contents: write }', () => {
    expect(found(reviewGha, '.github/workflows/a.yml', 'on: push\npermissions: { contents: write }\njobs: {}\n')).toContain('gha-contents-write')
    expect(found(reviewGha, '.github/workflows/a.yml', 'on: push\npermissions: { contents: read }\njobs: {}\n')).not.toContain('gha-contents-write')
  })
  test('the removed low-value rule is gone', () => {
    expect(reviewGha.some((r: any) => r.id === 'gha-unnamed-job')).toBe(false)
  })
})

