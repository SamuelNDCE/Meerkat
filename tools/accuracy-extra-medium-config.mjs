// Planted defects, MEDIUM tier, configuration and infrastructure files: Kubernetes, Compose, Terraform, GitHub Actions, GitLab CI,
// Electron windows, nginx. Each is a real misconfiguration inside a realistic file, and has a clean twin in `med-config-clean`.
// Keys are prefixed `med-`. Secrets are built from random parts at runtime (the context's `tok`), never written down here.

export function projects(ctx) {
  const { d, tidy, pkg, tok } = ctx
  const expect = {}
  const bad = {}
  const good = {}
  const add = (key, id, desc, file, pre, line, post, fix) => {
    const k = `med-${key}`
    expect[k] = id
    bad[file] = [...pre, d(k, desc, line), ...post, '']
    good[file] = [...pre, fix, ...post, '']
  }
  const pw = tok(14)

  // ---------------------------------------------------------------- Kubernetes
  const head = (name) => ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', `  name: ${name}`, '  labels:', `    app: ${name}`, 'spec:', '  replicas: 2', '  selector:', '    matchLabels:', `      app: ${name}`, '  template:', '    metadata:', '      labels:', `        app: ${name}`, '    spec:']
  // A well-kept container: resource requests and limits, both probes, and a locked-down security context (everything a hardening scan wants).
  const RES = ['          resources:', '            requests: { cpu: 100m, memory: 128Mi }', '            limits: { cpu: 500m, memory: 256Mi }', '          readinessProbe:', '            httpGet: { path: /ready, port: 8080 }', '          livenessProbe:', '            httpGet: { path: /live, port: 8080 }']
  const SEC = { runAsNonRoot: '            runAsNonRoot: true', readOnlyRootFilesystem: '            readOnlyRootFilesystem: true', allowPrivilegeEscalation: '            allowPrivilegeEscalation: false', seccompProfile: '            seccompProfile: { type: RuntimeDefault }' }
  // The security context lines a container keeps, minus the keys a planted defect replaces.
  const secLines = (skip = []) => Object.entries(SEC).filter(([k]) => !skip.includes(k)).map(([, v]) => v)
  const pod = (name) => [...head(name), '      serviceAccountName: app', '      automountServiceAccountToken: false']
  const cont = (name, image = 'registry.example.com/team/api:2.4.1', sec = true) => ['      containers:', `        - name: ${name}`, `          image: ${image}`, '          ports:', '            - containerPort: 8080', ...RES, ...(sec ? ['          securityContext:', ...secLines()] : [])]
  add('k8s-host-network', 'ip-k8s/k8s-host-network', 'a pod that shares the node network', 'k8s/api-hostnet.yaml', [...pod('api')], '      hostNetwork: true', [...cont('api')], '      hostNetwork: false')
  add('k8s-host-pid', 'ip-k8s/k8s-host-pid', 'a pod that shares the node process namespace', 'k8s/debug-hostpid.yaml', [...pod('debug')], '      hostPID: true', [...cont('debug')], '      hostPID: false')
  add('k8s-privileged-sidecar', 'ip-k8s/k8s-privileged', 'a sidecar container that runs privileged', 'k8s/worker-priv.yaml', [...pod('worker'), ...cont('worker'), '        - name: metrics', '          image: registry.example.com/team/metrics:1.2.0', ...RES, '          securityContext:'], '            privileged: true', [...secLines()], '            privileged: false')
  add('k8s-image-latest', 'ip-k8s/k8s-image-latest', 'a deployment image with the latest tag', 'k8s/web-latest.yaml', [...pod('web'), '      containers:', '        - name: web'], '          image: registry.example.com/team/web:latest', ['          ports:', '            - containerPort: 8080', ...RES, '          securityContext:', ...secLines()], '          image: registry.example.com/team/web:3.1.0')
  add('k8s-run-as-root', 'ip-k8s/k8s-run-as-user-zero', 'a container forced to run as user 0', 'k8s/batch-root.yaml', [...pod('batch'), ...cont('batch', undefined, false), '          securityContext:'], '            runAsUser: 0', [...secLines()], '            runAsUser: 10001')
  add('k8s-escalation', 'ip-k8s/k8s-priv-escalation-true', 'allowPrivilegeEscalation switched on', 'k8s/api-escalation.yaml', [...pod('api2'), ...cont('api2', undefined, false), '          securityContext:', ...secLines(['allowPrivilegeEscalation'])], '            allowPrivilegeEscalation: true', [], '            allowPrivilegeEscalation: false')
  add('k8s-secret-env', 'ip-k8s/k8s-secret-literal-env', 'a database password written into the pod env', 'k8s/api-secret-env.yaml', [...pod('api3'), ...cont('api3'), '          env:', '            - name: DB_HOST', '              value: db.internal', '            - name: DB_PASSWORD'], `              value: "${pw}"`, [], '              valueFrom: { secretKeyRef: { name: db-credentials, key: password } }')
  add('k8s-docker-sock', 'ip-k8s/k8s-host-path-docker-socket', 'the Docker socket mounted from the node', 'k8s/builder-sock.yaml', [...pod('builder'), ...cont('builder'), '          volumeMounts:', '            - name: docker', '              mountPath: /var/run/docker.sock', '      volumes:', '        - name: docker', '          hostPath:'], '            path: /var/run/docker.sock', [], '            path: /var/lib/builder/cache')

  // The clean twin keeps its cache in an emptyDir (a hostPath is a node folder to review), and a folder of workloads has a default-deny NetworkPolicy.
  good['k8s/builder-sock.yaml'] = [...pod('builder'), ...cont('builder'), '          volumeMounts:', '            - name: cache', '              mountPath: /cache', '      volumes:', '        - name: cache', '          emptyDir: {}', '']
  const netpol = ['apiVersion: networking.k8s.io/v1', 'kind: NetworkPolicy', 'metadata:', '  name: default-deny', 'spec:', '  podSelector: {}', '  policyTypes: [Ingress, Egress]', '']
  bad['k8s/networkpolicy.yaml'] = netpol
  good['k8s/networkpolicy.yaml'] = netpol

  // ---------------------------------------------------------------- Compose
  add('compose-latest-db', 'compose-hygiene|ip-terraform-compose', 'a database image with the latest tag', 'compose/latest-db.yml', ['services:', '  db:'], '    image: postgres:latest', ['    restart: unless-stopped'], '    image: postgres:16.3')
  add('compose-password', 'compose-hygiene|secrets-plus', 'a database password in the service environment', 'compose/password.yml', ['services:', '  db:', '    image: postgres:16.3', '    environment:', '      POSTGRES_USER: app'], `      POSTGRES_PASSWORD: ${pw}`, ['    restart: unless-stopped'], '      POSTGRES_PASSWORD_FILE: /run/secrets/db_password')
  add('compose-db-port', 'compose-hygiene|ip-terraform-compose', 'the database port published on every interface', 'compose/dbport.yml', ['services:', '  db:', '    image: postgres:16.3', '    ports:'], '      - "5432:5432"', ['    restart: unless-stopped'], '      - "127.0.0.1:5432:5432"')
  add('compose-privileged', 'compose-hygiene|ip-terraform-compose', 'a service that runs privileged', 'compose/privileged.yml', ['services:', '  agent:', '    image: registry.example.com/agent:1.4.0'], '    privileged: true', ['    restart: unless-stopped'], '    privileged: false')
  add('compose-docker-sock', 'ip-terraform-compose|compose-hygiene', 'the Docker socket mounted into a service', 'compose/dockersock.yml', ['services:', '  ci:', '    image: registry.example.com/ci:2.0.0', '    volumes:'], '      - /var/run/docker.sock:/var/run/docker.sock', ['    restart: unless-stopped'], '      - ci-cache:/cache')

  // ---------------------------------------------------------------- Terraform
  add('tf-ssh-open', 'ip-terraform-compose/tf-sg-open-22', 'SSH open to the whole internet', 'terraform/ssh.tf', ['resource "aws_security_group" "bastion" {', '  name = "bastion"', '  ingress {', '    from_port = 22', '    to_port   = 22', '    protocol  = "tcp"'], '    cidr_blocks = ["0.0.0.0/0"]', ['  }', '}'], '    cidr_blocks = ["10.20.0.0/16"]')
  add('tf-bucket-public', 'ip-terraform-compose/tf-s3-public-acl', 'a bucket with a public-read ACL', 'terraform/bucket.tf', ['resource "aws_s3_bucket" "assets" {', '  bucket = "example-assets"'], '  acl    = "public-read"', ['}'], '  acl    = "private"')
  add('tf-db-public', 'ip-terraform-compose/tf-rds-public', 'a database reachable from the internet', 'terraform/db-public.tf', ['resource "aws_db_instance" "main" {', '  engine         = "postgres"', '  instance_class = "db.t3.medium"'], '  publicly_accessible = true', ['  storage_encrypted   = true', '}'], '  publicly_accessible = false')
  add('tf-db-unencrypted', 'ip-terraform-compose/tf-rds-unencrypted', 'a database with storage encryption off', 'terraform/db-plain.tf', ['resource "aws_db_instance" "reports" {', '  engine         = "mysql"', '  instance_class = "db.t3.small"', '  publicly_accessible = false'], '  storage_encrypted = false', ['}'], '  storage_encrypted = true')
  add('tf-iam-star', 'ip-terraform-compose/tf-iam-wildcard-action', 'an IAM statement that allows every action', 'terraform/iam.tf', ['data "aws_iam_policy_document" "deploy" {', '  statement {', '    effect    = "Allow"', '    resources = ["arn:aws:s3:::example-assets/*"]'], '    actions   = ["*"]', ['  }', '}'], '    actions   = ["s3:GetObject", "s3:PutObject"]')

  // ---------------------------------------------------------------- CI
  const jobOnly = ['jobs:', '  build:', '    runs-on: ubuntu-24.04', '    timeout-minutes: 15', '    steps:', '      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332']
  const job = ['permissions:', '  contents: read', ...jobOnly]
  add('gha-prt-trigger', 'ip-gha/gha-pull-request-target-trigger', 'pull_request_target on a workflow that builds fork code', '.github/workflows/med-prt.yml', ['name: preview', 'on:'], '  pull_request_target:', ['    types: [opened, synchronize]', ...job, '      - run: npm ci && npm run build'], '  pull_request:')
  add('gha-write-all', 'ip-gha/gha-permissions-write-all', 'the workflow token has write-all', '.github/workflows/med-write-all.yml', ['name: release', 'on:', '  push:', '    tags: ["v*"]'], 'permissions: write-all', [...jobOnly, '      - run: npm publish'], 'permissions:\n  contents: read')
  add('gha-checkout-head', 'ip-gha/gha-prt-checkout-pr-head', 'a privileged workflow that checks out the PR head', '.github/workflows/med-checkout.yml', ['name: label', 'on:', '  pull_request_target:', '    types: [opened]', ...job, '        with:'], '          ref: ${{ github.event.pull_request.head.sha }}', ['      - run: ./scripts/label.sh'], '          ref: ${{ github.event.pull_request.base.sha }}')
  add('gha-untrusted-title', 'ip-gha/gha-inject-issue-text-run', 'a pull request title expanded inside run', '.github/workflows/med-inject.yml', ['name: check', 'on: pull_request', ...job], '      - run: echo "Checking ${{ github.event.pull_request.title }}"', ['      - run: npm test'], '      - run: echo "Checking $PR_TITLE"\n        env:\n          PR_TITLE: ${{ github.event.pull_request.title }}')
  add('gha-curl-bash', 'ip-gha/gha-curl-pipe-shell', 'a remote script piped into bash', '.github/workflows/med-curl.yml', ['name: tools', 'on: push', ...job], '      - run: curl -fsSL https://tools.example.com/install.sh | bash', ['      - run: npm test'], '      - run: npm ci')
  add('gha-unpinned-branch', 'workflow-security|ip-gha|github-actions-reusable', 'a third party action pinned to a branch', '.github/workflows/med-unpinned.yml', ['name: deploy', 'on: push', 'permissions:', '  contents: read', 'jobs:', '  ship:', '    runs-on: ubuntu-24.04', '    timeout-minutes: 15', '    steps:', '      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332'], '      - uses: some-org/deploy-action@main', ['        with:', '          target: production'], '      - uses: some-org/deploy-action@0123456789abcdef0123456789abcdef01234567')
  add('gitlab-latest-image', 'gitlab-ci-images', 'a CI job image with the latest tag', 'ci/med-latest.gitlab-ci.yml', ['stages: [build]', 'build:'], '  image: docker:latest', ['  script:', '    - docker build -t app .'], '  image: docker:26.1.4')

  // ---------------------------------------------------------------- Electron windows and nginx
  const win = ["const { app, BrowserWindow } = require('electron')", '', 'app.whenReady().then(() => {', '  const win = new BrowserWindow({', '    width: 1100,', '    height: 720,', '    webPreferences: {']
  const winEnd = ['    },', '  })', "  win.loadFile('index.html')", '})']
  add('electron-node-integration', 'electron-node-integration', 'a window with Node integration on', 'src/electron-node.js', win, '      nodeIntegration: true,', [...winEnd], '      nodeIntegration: false,')
  add('electron-context-isolation', 'electron-context-isolation', 'a window with context isolation off', 'src/electron-isolation.js', win, '      contextIsolation: false,', [...winEnd], '      contextIsolation: true,')
  add('electron-web-security', 'electron-web-security', 'a window with web security off', 'src/electron-websec.js', win, '      webSecurity: false,', [...winEnd], '      webSecurity: true,')
  add('nginx-old-tls', 'wh-headers/tls-protocol-legacy', 'nginx still allows TLS 1.0 and 1.1', 'nginx/med-site.conf', ['server {', '  listen 443 ssl http2;', '  server_name app.example.com;', '  ssl_certificate /etc/ssl/app.pem;', '  ssl_certificate_key /etc/ssl/app.key;', '  server_tokens off;', '  ssl_prefer_server_ciphers on;', '  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;', '  add_header X-Frame-Options DENY always;', '  add_header X-Content-Type-Options nosniff always;', '  add_header Referrer-Policy no-referrer always;', '  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;', "  add_header Content-Security-Policy \"default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\" always;", '  add_header Cross-Origin-Opener-Policy same-origin always;', '  add_header Cross-Origin-Embedder-Policy require-corp always;', '  add_header Cross-Origin-Resource-Policy same-origin always;'], '  ssl_protocols TLSv1 TLSv1.1 TLSv1.2;', ['  location / { proxy_pass http://127.0.0.1:8080; }', '}'], '  ssl_protocols TLSv1.2 TLSv1.3;')

  const name = 'med-config'
  const root = (n) => ({ ...tidy(n), 'package.json': pkg(n, { main: 'src/electron-node.js', devDependencies: { electron: '30.0.0' } }) })
  return {
    projects: {
      [name]: { files: { ...root(name), ...bad } },
      [`${name}-clean`]: { files: { ...root(`${name}-clean`), ...good } },
    },
    expect,
  }
}
