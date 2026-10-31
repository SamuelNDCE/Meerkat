// Infrastructure and CI-workflow checks: Dockerfiles, Kubernetes manifests, Terraform and Compose files, and GitHub Actions workflows.
// The rules live in thorough/rules-infra-plus.mjs (data for the rule engine in thorough/rules.mjs). This file finds the files of each
// family, prints one MEERKAT-SUB line per rule (PASS, FAIL or NA) and adds the few rules that need the whole folder, not one file.
// A family with no file of its kind reports NA for every rule. Run through the infra-plus pack, or by hand:
//   node thorough/infra-plus.mjs <check> [--root <dir>]      node thorough/infra-plus.mjs <check> --fixtures   (must exit 1)
// Accept a finding in .meerkat-infraplus-allow, one "<rule-id> <path>" per line (# starts a comment).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { evaluate, readAllow } from './rules.mjs'
import { finding, isFixture, main, readText, trackedFiles, withFixture } from './kit.mjs'
import { COMPOSE_RULES, COMPOSE_FILES, DOCKER_FILES, DOCKER_RULES, GHA_FILES, GHA_RULES, K8S_RULES, TF_FILES, TF_RULES, YAML_FILES } from './rules-infra-plus.mjs'

const ALLOW_FILE = '.meerkat-infraplus-allow'
const K8S_CONTENT = (t) => /^apiVersion:/m.test(t) && /^kind:/m.test(t)
const isWorkload = (t) => /^kind:\s*["']?(Deployment|StatefulSet|DaemonSet|ReplicaSet|Job|CronJob|Pod|ReplicationController)\b/m.test(t)

// Folder-level rules: each returns { id, title, fails: [path], na } and is skipped when the family has no files.
const dockerignore = (root, files) => {
  const fails = files.filter((f) => !existsSync(join(root, dirname(f), '.dockerignore')) && !existsSync(join(root, `${f}.dockerignore`)))
  return { id: 'docker-dockerignore-missing', title: 'no .dockerignore beside the Dockerfile, so the build context sends secrets and junk to the daemon', fails }
}
const networkPolicy = (files, read) => {
  const dirs = new Map()
  for (const f of files) {
    const d = dirname(f)
    const cur = dirs.get(d) ?? { workload: false, policy: false }
    const t = read(f)
    if (isWorkload(t)) cur.workload = true
    if (/^kind:\s*NetworkPolicy\b/m.test(t)) cur.policy = true
    dirs.set(d, cur)
  }
  const fails = [...dirs].filter(([, v]) => v.workload && !v.policy).map(([d]) => (d === '.' ? '(top folder)' : d))
  return { id: 'k8s-networkpolicy-missing', title: 'a folder of workloads has no NetworkPolicy, so every pod can reach every other pod', fails, na: ![...dirs.values()].some((v) => v.workload) }
}

// Each family: groups of { label, path, content?, rules, extras? }. A group is one kind of file.
const FAMILIES = {
  'ip-docker': { title: 'Dockerfiles', groups: [{ label: 'Dockerfile', path: DOCKER_FILES, rules: DOCKER_RULES, extras: [(root, files) => dockerignore(root, files)] }] },
  'ip-k8s': { title: 'Kubernetes manifests', groups: [{ label: 'Kubernetes manifest', path: YAML_FILES, content: K8S_CONTENT, rules: K8S_RULES, extras: [(root, files, read) => networkPolicy(files, read)] }] },
  'ip-terraform-compose': {
    title: 'Terraform and Compose files',
    groups: [
      { label: 'Terraform file', path: TF_FILES, rules: TF_RULES },
      { label: 'Compose file', path: COMPOSE_FILES, rules: COMPOSE_RULES },
    ],
  },
  'ip-gha': { title: 'GitHub Actions workflows', groups: [{ label: 'GitHub Actions workflow', path: GHA_FILES, rules: GHA_RULES }] },
}

// A Dockerfile instruction continued with a trailing backslash is one logical line: join it onto its first line and blank the others,
// so every rule sees the whole RUN and line numbers stay the same.
export function joinContinuations(text) {
  const ls = text.split(/\r?\n/)
  const out = []
  for (let i = 0; i < ls.length; i++) {
    let cur = ls[i]
    if (/^\s*#/.test(cur)) {
      out.push(cur)
      continue
    }
    let extra = 0
    while (/\\\s*$/.test(cur) && i + 1 < ls.length && extra < 60) {
      i++
      extra++
      const nx = ls[i]
      cur = /^\s*#/.test(nx) ? cur : cur.replace(/\\\s*$/, ' ') + nx.trim()
      if (/^\s*#/.test(nx)) cur = cur.replace(/\s*$/, '') + ' \\'
    }
    out.push(cur)
    for (let k = 0; k < extra; k++) out.push('')
  }
  return out.join('\n')
}
// Terraform written as JSON: `"key": value,` becomes `key = value`, one JSON object per line becomes one setting per line.
export function tfJsonAsHcl(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^(\s*)"([^"]{1,80})"\s*:\s*(.*?),?\s*$/, '$1$2 = $3'))
    .join('\n')
}
const FALLBACK = ['critical', 'high', 'medium', 'low', 'info'].includes(process.env.MEERKAT_DEFAULT_SEVERITY) ? process.env.MEERKAT_DEFAULT_SEVERITY : 'medium'

const sub = (status, id, reason) => console.log(`MEERKAT-SUB ${status} ${id} ${String(reason).replace(/[\r\n\u0000-\u001f]+/g, ' ').slice(0, 200)}`)

// Runs one family over a folder: prints the sub-check lines and returns the exit code (0 pass, 1 findings).
function runFamily(name, root) {
  const spec = FAMILIES[name]
  const allow = readAllow(root, ALLOW_FILE)
  const listed = trackedFiles(root)
  let failed = 0
  for (const g of spec.groups) {
    const texts = new Map()
    for (const f of listed) {
      if (!g.path.test(f) || isFixture(f)) continue
      let t = readText(root, f)
      if (g.content && !g.content(t)) continue
      if (g.label === 'Dockerfile') t = joinContinuations(t)
      if (g.label === 'Terraform file' && /\.tf\.json$/i.test(f)) t = tfJsonAsHcl(t)
      texts.set(f, t)
    }
    const files = [...texts.keys()]
    const read = (f) => texts.get(f) ?? ''
    if (!files.length) {
      for (const r of g.rules) sub('NA', r.id, `no ${g.label} here`)
      for (const x of g.extras ?? []) sub('NA', x.id ?? x(root, [], read).id, `no ${g.label} here`)
      continue
    }
    const { found, na, hits: located } = evaluate(root, g.rules, { files, allow, read })
    for (const h of located ?? []) finding(h.severity ?? FALLBACK, h.rule, h.file, h.line, h.title)
    const hits = new Map()
    for (const h of found) hits.set(h.rule, (hits.get(h.rule) ?? 0) + 1)
    for (const r of g.rules) {
      if (na.includes(r.id)) sub('NA', r.id, `no ${g.label} here`)
      else if (hits.has(r.id)) {
        failed++
        sub('FAIL', r.id, `${hits.get(r.id)} found: ${r.title}`)
      } else sub('PASS', r.id, r.title)
    }
    for (const x of g.extras ?? []) {
      const res = x(root, files, read)
      const fails = (res.fails ?? []).filter((p) => !allow.has(`${res.id} ${p}`))
      if (res.na) sub('NA', res.id, `no ${g.label} here`)
      else if (fails.length) {
        failed++
        sub('FAIL', res.id, `${fails.length} found: ${res.title}`)
        for (const p of fails.slice(0, 25)) console.log(`  ${p}: ${res.title}`)
        for (const p of fails) finding(FALLBACK, res.id, p, 0, res.title)
      } else sub('PASS', res.id, res.title)
    }
    for (const f of found.slice(0, 25)) console.log(`  ${f.text}`)
    if (found.length > 25) console.log(`  ... and ${found.length - 25} more`)
  }
  if (!failed) {
    console.log(`${spec.title}: nothing found`)
    return 0
  }
  console.log(`${spec.title}: ${failed} rule(s) found something`)
  return 1
}

// One deliberate violation per family, for the self-test: the check must exit 1 and say "found".
const FIXTURES = {
  'ip-docker': { Dockerfile: 'FROM alpine:3.20\nRUN apt-get update\nRUN apt-get install curl\nUSER root\n' },
  'ip-k8s': { 'deploy.yaml': 'apiVersion: apps/v1\nkind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          image: app:latest\n          securityContext:\n            privileged: true\n' },
  'ip-terraform-compose': { 'main.tf': 'resource "aws_security_group_rule" "ssh" {\n  from_port = 22\n  to_port = 22\n  cidr_blocks = ["0.0.0.0/0"]\n}\n' },
  'ip-gha': { '.github/workflows/ci.yml': 'on: pull_request_target\njobs:\n  x:\n    steps:\n      - run: echo "${{ github.event.pull_request.title }}"\n' },
}

const CHECKS = Object.fromEntries(
  Object.keys(FAMILIES).map((name) => [
    name,
    {
      run: (root) => runFamily(name, root),
      fixture: () => withFixture(FIXTURES[name], (dir) => runFamily(name, dir)),
    },
  ]),
)

main(CHECKS)
