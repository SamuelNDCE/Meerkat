// False-alarm TRAPS, part 3: Docker, Kubernetes, Terraform, Compose, GitHub Actions, notebooks, packaging and repo-level files. Clean projects (names
// end in -clean) whose files LOOK like a bug to a naive rule but are safe. No defect is planted: a trap passes when its named check raises no
// bug-severity finding on that file. The module also exports TRAPS (project, file, check, name) for tools/trap-lang-verify.mjs.
// Source text is written with § for a backtick and @{ for ${ so it can sit in a template literal.

const fix = (s) => s.replaceAll('§', '`').replaceAll('@{', '${')
export const TRAPS = []
const FILES = {}
const raw = String.raw

const add = (project, check, name, file, text) => {
  FILES[project] ??= {}
  if (FILES[project][file]) throw new Error(`trap-lang: ${project}/${file} written twice`)
  FILES[project][file] = [fix(text).replace(/^\n/, '')]
  TRAPS.push({ project: `trap-lang-${project}-clean`, file, check, name })
}
const SHA = '692973e3d937129bcbf40652eb9f2f61becf3332'
const DIGEST = 'sha256:' + 'a'.repeat(64)

// ------------------------------------------------------------------------------------------------------------------- Docker
const D = 'docker'
add(D, 'docker-base-pinning', 'base-pinned-by-digest', 'a/Dockerfile', raw`
FROM node:22-slim@${DIGEST}
USER node
WORKDIR /app
COPY --chown=node:node . .
CMD ["node", "server.js"]
`)
add(D, 'docker-base-pinning', 'curl-to-file-not-shell', 'b/Dockerfile', raw`
FROM debian:12.5-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/tool.tgz https://example.com/tool-1.2.3.tgz && echo "${'a'.repeat(64)}  /tmp/tool.tgz" | sha256sum -c -
USER nobody
CMD ["sleep", "infinity"]
`)
add(D, 'docker-base-pinning', 'scratch-base-with-user', 'c/Dockerfile', raw`
FROM scratch
COPY app /app
USER 10001
ENTRYPOINT ["/app"]
`)
add(D, 'docker-base-pinning', 'multi-stage-final-nonroot', 'd/Dockerfile', raw`
FROM golang:1.22.3-alpine3.19 AS build
WORKDIR /src
COPY . .
RUN go build -o /out/app ./...

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER nonroot
ENTRYPOINT ["/app"]
`)
add(D, 'ip-docker', 'healthcheck-and-user-set', 'e/Dockerfile', raw`
FROM python:3.12.3-slim
RUN useradd --create-home app
USER app
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["python", "-m", "http.server", "8000", "--bind", "127.0.0.1"]
`)
add(D, 'ip-docker', 'build-arg-is-not-a-secret', 'f/Dockerfile', raw`
FROM alpine:3.19.1
ARG APP_VERSION=1.2.3
ENV APP_VERSION=$APP_VERSION
ENV PASSWORD_FILE=/run/secrets/db_password
USER nobody
CMD ["true"]
`)
add(D, 'compose-hygiene', 'compose-secret-from-file-and-loopback-port', 'compose/docker-compose.yml', raw`
services:
  db:
    image: postgres:16.3@${DIGEST}
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
secrets:
  db_password:
    file: ./secrets/db_password.txt
`)
add(D, 'compose-hygiene', 'compose-env-passthrough-no-value', 'compose2/docker-compose.yml', raw`
services:
  web:
    image: ghcr.io/example/web:1.4.2@${DIGEST}
    environment:
      - API_TOKEN
      - LOG_LEVEL=info
    read_only: true
    cap_drop: [ALL]
`)

// ------------------------------------------------------------------------------------------------------------------- Kubernetes
const K = 'kubernetes'
add(K, 'ip-k8s', 'hardened-deployment', 'k8s/deploy.yaml', raw`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      automountServiceAccountToken: false
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: web
          image: ghcr.io/example/web:1.4.2@${DIGEST}
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: [ALL] } }
          resources: { requests: { cpu: 100m, memory: 128Mi }, limits: { cpu: 500m, memory: 256Mi } }
          readinessProbe: { httpGet: { path: /ready, port: 8080 } }
          livenessProbe: { httpGet: { path: /live, port: 8080 } }
`)
add(K, 'ip-k8s', 'role-reads-only-named-configmap', 'k8s/role.yaml', raw`
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: read-config
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["web-config"]
    verbs: ["get"]
`)
add(K, 'ip-k8s', 'network-policy-deny-all', 'k8s/netpol.yaml', raw`
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
`)
add(K, 'ip-k8s', 'secret-by-reference-not-literal', 'k8s/envref.yaml', raw`
apiVersion: v1
kind: Pod
metadata:
  name: api
spec:
  containers:
    - name: api
      image: ghcr.io/example/api:2.0.1@${DIGEST}
      env:
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef: { name: db, key: password }
`)
add(K, 'helm-values-secrets', 'values-reference-existing-secret', 'chart/values.yaml', raw`
database:
  existingSecret: db-credentials
  passwordKey: password
password: ""
`)
add(K, 'helm-chart-basics', 'chart-pinned-image-tag', 'chart/Chart.yaml', raw`
apiVersion: v2
name: web
description: A clean chart
type: application
version: 0.1.0
appVersion: "1.4.2"
`)

// ------------------------------------------------------------------------------------------------------------------- Terraform
const T = 'terraform'
add(T, 'ip-terraform-compose', 'bucket-private-and-encrypted', 'main.tf', raw`
resource "aws_s3_bucket" "logs" {
  bucket = "example-logs"
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}
`)
add(T, 'ip-terraform-compose', 'sg-ingress-from-private-cidr', 'net.tf', raw`
resource "aws_security_group_rule" "db" {
  type              = "ingress"
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  cidr_blocks       = ["10.0.0.0/16"]
  security_group_id = "sg-0123456789abcdef0"
}
`)
add(T, 'ip-terraform-compose', 'sg-https-world-open-is-intended', 'lb.tf', raw`
resource "aws_security_group_rule" "https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "public HTTPS for the load balancer"
  security_group_id = "sg-0123456789abcdef0"
}
`)
add(T, 'ip-terraform-compose', 'iam-policy-scoped-actions', 'iam.tf', raw`
data "aws_iam_policy_document" "read" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::example-logs/*"]
  }
}
`)
add(T, 'ip-terraform-compose', 'password-from-variable-marked-sensitive', 'vars.tf', raw`
variable "db_password" {
  type      = string
  sensitive = true
}

resource "aws_db_instance" "main" {
  identifier        = "main"
  engine            = "postgres"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  password          = var.db_password
  storage_encrypted = true
}
`)

// ------------------------------------------------------------------------------------------------------------------- GitHub Actions
const A = 'actions'
add(A, 'ip-gha', 'pinned-by-sha-minimal-permissions-timeout', '.github/workflows/ci.yml', raw`
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-@{{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@${SHA}
        with:
          persist-credentials: false
      - uses: actions/setup-node@${'1'.repeat(40)}
        with:
          node-version: '22.4.1'
      - run: node --test
`)
add(A, 'ip-gha', 'untrusted-input-through-env', '.github/workflows/title.yml', raw`
name: title
on:
  pull_request:
permissions:
  contents: read
jobs:
  show:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Show the title
        env:
          TITLE: @{{ github.event.pull_request.title }}
        run: echo "$TITLE"
`)
add(A, 'workflow-security', 'secret-used-in-env-not-echoed', '.github/workflows/deploy.yml', raw`
name: deploy
on:
  workflow_dispatch:
permissions:
  contents: read
  id-token: write
concurrency:
  group: deploy
jobs:
  deploy:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    environment: production
    steps:
      - uses: actions/checkout@${SHA}
        with:
          persist-credentials: false
      - run: ./deploy.sh
        env:
          API_TOKEN: @{{ secrets.API_TOKEN }}
`)
add(A, 'workflow-security', 'pull-request-target-without-checkout-of-pr', '.github/workflows/label.yml', raw`
name: label
on:
  pull_request_target:
    types: [opened]
permissions:
  pull-requests: write
jobs:
  label:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/labeler@${'2'.repeat(40)}
`)
add(A, 'actions-secrets-echo', 'word-secrets-in-step-name', '.github/workflows/names.yml', raw`
name: names
on: [push]
permissions:
  contents: read
jobs:
  note:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Check that no secrets are printed
        run: echo "secrets are never printed here"
`)
add(A, 'github-actions-artifacts', 'artifact-with-retention', '.github/workflows/artifact.yml', raw`
name: artifact
on: [push]
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@${SHA}
      - run: mkdir out && echo ok > out/result.txt
      - uses: actions/upload-artifact@${'3'.repeat(40)}
        with:
          name: result
          path: out/result.txt
          retention-days: 7
`)
add(A, 'ci-timeouts', 'job-with-timeout', '.github/workflows/lint.yml', raw`
name: lint
on: [push]
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@${SHA}
      - run: node --check src/index.js
`)
add(A, 'ci-node-version-pinned', 'node-version-exact', '.github/workflows/node.yml', raw`
name: node
on: [push]
permissions:
  contents: read
jobs:
  t:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@${SHA}
      - uses: actions/setup-node@${'1'.repeat(40)}
        with:
          node-version-file: .nvmrc
`)
add(A, 'provenance-hints', 'release-with-provenance', '.github/workflows/release.yml', raw`
name: release
on:
  release:
    types: [published]
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@${SHA}
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: @{{ secrets.NPM_TOKEN }}
`)
add(A, 'github-actions-reusable', 'reusable-workflow-pinned-sha', '.github/workflows/call.yml', raw`
name: call
on: [push]
permissions:
  contents: read
jobs:
  shared:
    uses: example-org/shared/.github/workflows/test.yml@${'4'.repeat(40)}
`)

// ------------------------------------------------------------------------------------------------------------------- Notebooks
const N = 'notebooks'
const nb = (cells) => JSON.stringify({ cells, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5 }, null, 1)
const code = (src, extra = {}) => ({ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: src.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l)), ...extra })
const md = (src) => ({ cell_type: 'markdown', metadata: {}, source: [src] })
add(N, 'notebook-secrets', 'reads-key-from-environment', 'analysis.ipynb', nb([md('# Analysis'), code('import os\nkey = os.environ["API_KEY"]')]))
add(N, 'notebook-secrets', 'placeholder-in-markdown-help', 'howto.ipynb', nb([md('Set `API_KEY=<your key here>` in your shell, then run the cells below.'), code('import os\nprint("key set:", "API_KEY" in os.environ)')]))
add(N, 'notebook-absolute-paths', 'loads-a-file-the-project-ships', 'load.ipynb', nb([code('import pandas as pd\ndf = pd.read_csv("data/sample.csv")')]))
add(N, 'notebook-absolute-paths', 'path-from-pathlib-here', 'paths.ipynb', nb([code('from pathlib import Path\nDATA = Path.cwd() / "data"')]))
add(N, 'notebook-pip-magics', 'pip-install-exact-version', 'install.ipynb', nb([code('%pip install pandas==2.2.2')]))
add(N, 'notebook-outputs-stripped', 'outputs-empty-counts-null', 'clean.ipynb', nb([code('print("hello")'), code('x = 1 + 1\nx')]))
add(N, 'notebook-valid-json', 'minimal-valid-notebook', 'tiny.ipynb', nb([md('# tiny')]))
add(N, 'notebook-size', 'small-notebook', 'small.ipynb', nb([code('# a comment\nvalue = 3')]))
add(N, 'random-seed-missing', 'notebook-script-seeds-rng', 'train.py', raw`
import random

random.seed(7)
values = [random.random() for _ in range(3)]
`)

// ------------------------------------------------------------------------------------------------------------------- Packaging / repo
const L = 'repo'
add(L, 'dependency-pinning', 'exact-version-pins', 'package.json', JSON.stringify({ name: 'trap-lang-repo-clean', version: '1.0.0', description: 'trap', license: 'MIT', private: true, engines: { node: '>=20' }, dependencies: { ms: '2.1.3' }, devDependencies: {} }, null, 2))
add(L, 'lockfile-integrity', 'lockfile-with-integrity', 'package-lock.json', JSON.stringify({ name: 'trap-lang-repo-clean', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'trap-lang-repo-clean', version: '1.0.0', license: 'MIT', dependencies: { ms: '2.1.3' }, engines: { node: '>=20' } }, 'node_modules/ms': { version: '2.1.3', resolved: 'https://registry.npmjs.org/ms/-/ms-2.1.3.tgz', integrity: 'sha512-' + 'A'.repeat(86) + '==', license: 'MIT' } } }, null, 2))
add(L, 'secret-scan', 'documented-aws-example-key-in-docs', 'docs/aws.md', raw`
# AWS example

The AWS documentation uses this well-known placeholder: AKIAIOSFODNN7EXAMPLE with the secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY.
Neither is a real credential.
`)
add(L, 'secret-scan', 'stripe-test-placeholder-in-examples-folder', 'examples/stripe.js', raw`
// example only: the real key is read from the environment
const placeholder = 'sk_' + 'test_' + 'x'.repeat(24)
module.exports = { placeholder }
`)
add(L, 'secrets-plus', 'env-example-with-empty-values', '.env.example', raw`
API_KEY=
DB_PASSWORD=
SESSION_SECRET=change-me
`)
add(L, 'secrets-plus', 'fake-secret-in-test-fixture', 'tests/fixtures/fake.json', raw`
{ "token": "ghp_0000000000000000000000000000000000000", "note": "fake value used by a parser test" }
`)
add(L, 'secrets-plus', 'long-hash-is-not-a-secret', 'src/hashes.js', raw`
// sha256 of the empty string, used as a known-answer test value
module.exports = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
`)
add(L, 'sensitive-files', 'public-certificate-not-key', 'certs/ca.pem', raw`
-----BEGIN CERTIFICATE-----
MIIBszCCAVmgAwIBAgIUZm9vYmFyZm9vYmFyZm9vYmFyMDEwCgYIKoZIzj0EAwIw
-----END CERTIFICATE-----
`)
add(L, 'install-scripts', 'postinstall-is-absent-prepare-builds', 'tools/scripts.json', JSON.stringify({ scripts: { prepare: 'node --check src/index.js' } }, null, 2))
add(L, 'typosquat-names', 'popular-name-exact', 'tools/deps.json', JSON.stringify({ dependencies: { express: '4.19.2', lodash: '4.17.21' } }, null, 2))
add(L, 'wildcard-versions', 'caret-ranges-are-not-wildcards', 'tools/ranges.json', JSON.stringify({ dependencies: { ms: '^2.1.3' } }, null, 2))
add(L, 'env-example', 'env-var-documented', 'src/readenv.js', raw`
module.exports = process.env.APP_PORT || '3000'
`)
add(L, 'credentials-in-urls', 'user-at-host-ssh-url', 'docs/clone.md', raw`
Clone with git@github.com:example/repo.git or https://github.com/example/repo.git.
`)
add(L, 'wh-publish-root', 'publish-dir-is-dist-only', 'netlify.toml', raw`
[build]
  publish = "dist"
  command = "node build.js"
`)
add(L, 'wh-headers', 'headers-file-sends-all', '_headers', raw`
/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'
`)
add(L, 'sri-missing', 'cdn-script-with-integrity', 'public/cdn.html', raw`
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>CDN</title></head>
<body><script src="https://cdn.example.com/lib.js" integrity="sha384-${'B'.repeat(64)}" crossorigin="anonymous"></script></body>
</html>
`)
add(L, 'target-blank-noopener', 'blank-with-noopener', 'public/links.html', raw`
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Links</title></head>
<body><a href="https://example.com" target="_blank" rel="noopener noreferrer">example</a></body>
</html>
`)
add(L, 'third-party-trackers', 'tracker-name-in-prose', 'docs/privacy-notes.md', raw`
# Notes

We do not use google-analytics or any other tracker on this site.
`)
add(L, 'mixed-content', 'xml-namespace-http-url', 'public/ns.svg', raw`
<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="4"/></svg>
`)
add(L, 'yaml-valid', 'flow-sequence-multiline', 'config/list.yml', raw`
items: [
  one,
  two,
]
`)
add(L, 'debug-enabled', 'debug-false-in-config', 'config/app.json', JSON.stringify({ debug: false, logLevel: 'info' }, null, 2))
add(L, 'hardcoded-ip', 'version-number-looks-like-ip', 'config/versions.txt', raw`
release 1.2.3.4 of the format is stable
`)
add(L, 'pii-patterns-in-source', 'zero-filled-sample-number', 'docs/format.md', raw`
The card field is shown as 0000 0000 0000 0000 in the help text.
`)
add(L, 'unicode-control-chars', 'escaped-not-literal-control', 'src/ctl.txt', raw`
The text uses the escape ‮ in documentation and no literal control characters.
`)
add(L, 'markers', 'xxx-in-a-word', 'src/words.txt', raw`
The word maxxx and the string XXXL (a size) are not notes.
`)

export function projects(ctx) {
  const { tidy } = ctx
  const out = {}
  for (const [name, files] of Object.entries(FILES)) {
    const base = { ...tidy(`trap-lang-${name}-clean`) }
    if (name === 'actions') delete base['.github/workflows/ci.yml']
    if (name === 'repo') base['.nvmrc'] = ['22.4.1\n']
    out[`trap-lang-${name}-clean`] = { files: { ...base, ...files } }
  }
  return { projects: out, expect: {} }
}
