// Extra planted defects: realistic VARIANTS of defects the built-in corpus already plants (false-negative hunting).
// Loaded by tools/accuracy-corpus.mjs. Each variant is the same mistake written another way: multi-line shell steps with backslashes,
// flow-style YAML, quoted keys, CRLF files, JSON-style Terraform, comments in the middle, aliases, JSX/Vue/Svelte attribute forms.
// Keys are prefixed `xi-`. Secrets are built from random parts at runtime (the context's `tok`), never written down here.

export function projects(ctx) {
  const { d, a, tok, tidy, pkg } = ctx
  const expect = {}
  const X = (key, exp, desc, text) => {
    expect[`xi-${key}`] = exp
    return d(`xi-${key}`, desc, text)
  }
  const A = (key, exp, desc, file = '') => {
    expect[`xi-${key}`] = exp
    return a(`xi-${key}`, desc, file)
  }
  const SP = ['', '# ---', '#', '']
  const crlf = (items) => items.map((i) => (typeof i === 'string' ? `${i}\r` : { ...i, text: `${i.text}\r` }))
  const pw = tok(14)
  const npmTok = ['np', 'm_', tok(36)].join('')

  // ---------------------------------------------------------------- Dockerfiles
  const df = (...body) => ['FROM node:20.11-alpine', 'WORKDIR /app', 'COPY package.json /app/', 'HEALTHCHECK CMD true', ...body, '']
  const docker = {
    'Dockerfile.root1': df('USER app', 'RUN echo build', X('docker-root-last-pair', 'ip-docker/docker-user-root-last', 'last USER is root:root', 'USER root:root')),
    'Dockerfile.root2': df('USER app', 'RUN echo build', X('docker-root-last-zero', 'ip-docker/docker-user-root-last', 'last USER is 0:0', 'USER 0:0')),
    'Dockerfile.root3': df('USER app', 'RUN echo build', X('docker-root-last-comment', 'ip-docker/docker-user-root-last', 'last USER is root with a trailing comment', 'USER root # fix permissions later')),
    'Dockerfile.sec1': df(X('docker-env-arg-token', 'ip-docker/docker-secret-in-env', 'an ARG holding a token default', `ARG NPM_TOKEN=${npmTok}`), 'USER app'),
    'Dockerfile.sec2': df(X('docker-env-space-form', 'ip-docker/docker-secret-in-env', 'legacy ENV KEY value form with a secret', `ENV API_KEY ${pw}`), 'USER app'),
    'Dockerfile.sec3': df('ENV NODE_ENV=production \\', X('docker-env-multi-pair', 'ip-docker/docker-secret-in-env', 'a secret in the second pair of a multi-line ENV', `    DB_PASSWORD=${pw}`), 'USER app'),
    'Dockerfile.sec4': df(X('docker-env-quoted', 'ip-docker/docker-secret-in-env', 'a quoted secret value in ENV', `ENV SECRET_KEY="${pw}"`), 'USER app'),
    'Dockerfile.pipe1': df(X('docker-curl-pipe-multiline', 'ip-docker/docker-curl-pipe-shell', 'curl piped to a shell across lines', 'RUN curl -fsSL \\\n      https://example.com/install.sh \\\n    | bash'), 'USER app'),
    'Dockerfile.pipe2': df(X('docker-wget-pipe', 'ip-docker/docker-curl-pipe-shell', 'wget -O- piped to sh', 'RUN wget -qO- https://example.com/setup.sh | sh'), 'USER app'),
    'Dockerfile.pipe3': df(X('docker-curl-pipe-sudo-flags', 'ip-docker/docker-curl-pipe-shell', 'curl piped to sudo -E bash', 'RUN curl -sL https://deb.example.com/setup_20.x | sudo -E bash -'), 'USER app'),
    'Dockerfile.chmod1': df(X('docker-chmod-multiline', 'ip-docker/docker-chmod-world-writable', 'chmod 777 split over lines', 'RUN mkdir -p /data && \\\n    chmod -R \\\n    777 /data'), 'USER app'),
    'Dockerfile.chmod2': df(X('docker-chmod-a-rwx', 'ip-docker/docker-chmod-world-writable', 'chmod -R a+rwx', 'RUN chmod -R a+rwx /var/cache/app'), 'USER app'),
    'Dockerfile.chmod3': df(X('docker-chmod-0777', 'ip-docker/docker-chmod-world-writable', 'chmod 0777', 'RUN chmod 0777 /tmp/app.sock'), 'USER app'),
    'Dockerfile.add1': df(X('docker-add-chown-url', 'ip-docker/docker-add-from-url', 'ADD with a --chown flag fetching a URL', 'ADD --chown=app:app https://example.com/app.tgz /opt/'), 'USER app'),
    'Dockerfile.add2': df(X('docker-add-http-checksum', 'ip-docker/docker-add-from-url', 'ADD with --checksum over plain http', 'ADD --checksum=sha256:abcd http://example.com/app.tgz /opt/'), 'USER app'),
    'Dockerfile.add3': df(X('docker-add-lower', 'ip-docker/docker-add-from-url', 'lowercase add instruction fetching a URL', 'add https://example.com/tool.bin /usr/local/bin/tool'), 'USER app'),
    'Dockerfile.base1': ['# base image variants', X('docker-from-latest-as', 'docker-base-pinning', 'FROM with the latest tag and a stage name', 'FROM node:latest AS build'), 'USER app', ''],
    'Dockerfile.base2': ['', X('docker-from-platform-untagged', 'docker-base-pinning', 'FROM with a platform flag and no tag', 'FROM --platform=linux/amd64 ubuntu'), 'USER app', ''],
    'Dockerfile.base3': ['', X('docker-from-untagged-stage', 'docker-base-pinning', 'FROM with no tag in a later stage', 'FROM node:20.11-alpine AS deps\nRUN true\nFROM python AS runtime'), 'USER app', ''],
    'Dockerfile.apt1': df(X('docker-apt-multiline-no-y', 'ip-docker/docker-apt-install-no-yes', 'apt-get install without -y on a continued line', 'RUN apt-get update && \\\n    apt-get install --no-install-recommends curl'), 'USER app'),
    'Dockerfile.apt2': df(X('docker-apt-no-recommends-multiline', 'ip-docker/docker-apt-recommends', 'apt-get install without --no-install-recommends, continued', 'RUN apt-get update \\\n  && apt-get install -y \\\n     curl git'), 'USER app'),
    'Dockerfile.apt3': df(X('docker-apt-upgrade-chain', 'ip-docker/docker-apt-upgrade', 'apt-get upgrade inside a chain', 'RUN apt-get update && apt-get -y upgrade && rm -rf /var/lib/apt/lists/*'), 'USER app'),
    'Dockerfile.pip1': df(X('docker-pip-multiline', 'ip-docker/docker-pip-no-cache', 'pip install on a continued line without --no-cache-dir', 'RUN python -m pip \\\n    install flask==3.0.3'), 'USER app'),
    'Dockerfile.pip2': df(X('docker-pip3-unpinned', 'ip-docker/docker-pip-unpinned', 'pip3 install of unpinned packages', 'RUN pip3 install --no-cache-dir requests gunicorn'), 'USER app'),
    'Dockerfile.pip3': df(X('docker-pip-http-index', 'ip-docker/docker-pip-untrusted-host', 'pip install from an http index on a continued line', 'RUN pip install --no-cache-dir flask==3.0.3 \\\n    --index-url http://pypi.internal/simple'), 'USER app'),
    'Dockerfile.http1': df(X('docker-download-http-multiline', 'ip-docker/docker-download-http', 'a download over plain http, continued', 'RUN curl -fsSL \\\n    -o /tmp/x.tgz \\\n    http://downloads.example.com/x.tgz'), 'USER app'),
    'Dockerfile.http2': df(X('docker-download-http-wget', 'ip-docker/docker-download-http', 'wget over plain http after &&', 'RUN mkdir /opt/x && wget -q http://downloads.example.com/x.bin -O /opt/x/x.bin'), 'USER app'),
    'Dockerfile.ssh1': df(X('docker-expose-ssh-list', 'ip-docker/docker-expose-ssh', 'port 22 inside an EXPOSE list', 'EXPOSE 8080 22'), 'USER app'),
    'Dockerfile.ssh2': df(X('docker-expose-ssh-proto', 'ip-docker/docker-expose-ssh', 'port 22/tcp exposed', 'EXPOSE 22/tcp'), 'USER app'),
    'Dockerfile.sudo1': df(X('docker-sudo-chain', 'ip-docker/docker-sudo', 'sudo inside a chained RUN', 'RUN apt-get update && \\\n    sudo apt-get clean'), 'USER app'),
    'Dockerfile.npm1': df(X('docker-npm-global-multiline', 'ip-docker/docker-npm-global-unpinned', 'a global npm install without a version, continued', 'RUN npm install \\\n    --global typescript'), 'USER app'),
    'Dockerfile.hc1': ['FROM node:20.11-alpine', X('docker-healthcheck-none-spaced', 'ip-docker/docker-healthcheck-none', 'HEALTHCHECK NONE with extra spaces', 'HEALTHCHECK   NONE'), 'USER app', ''],
    'Dockerfile.vol1': df(X('docker-volume-json', 'ip-docker/docker-volume-sensitive', 'a sensitive VOLUME in JSON form', 'VOLUME ["/root/.ssh"]'), 'USER app'),
    'Dockerfile.setuid1': df(X('docker-setuid-find', 'ip-docker/docker-setuid-bit', 'chmod 4755 on a binary', 'RUN chmod 4755 /usr/local/bin/helper'), 'USER app'),
  }
  const dockerfiles = Object.fromEntries(Object.entries(docker).map(([k, v]) => [`docker/${k}`, v]))

  // ---------------------------------------------------------------- Kubernetes
  const k8sHead = ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: web', 'spec:', '  selector:', '    matchLabels: { app: web }', '  template:', '    metadata:', '      labels: { app: web }', '    spec:']
  const k8sPod = (specLines, container) => [...k8sHead, ...specLines, '      containers:', '        - name: web', ...container, '']
  const img = '          image: registry.example.com/web:1.4.2'
  const k8s = {
    'k8s/flow-priv.yaml': k8sPod([], [img, X('k8s-priv-flow', 'ip-k8s/k8s-privileged', 'privileged in a flow mapping', '          securityContext: { privileged: true }')]),
    'k8s/quoted-priv.yaml': k8sPod([], [img, '          securityContext:', X('k8s-priv-quoted', 'ip-k8s/k8s-privileged', 'privileged: "true" quoted', '            privileged: "true"')]),
    'k8s/multidoc.yaml': ['apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: cfg', 'data:', '  a: b', '---', ...k8sPod([], [img, '          securityContext:', X('k8s-priv-second-doc', 'ip-k8s/k8s-privileged', 'privileged in the second document of a file', '            privileged: true')])],
    'k8s/crlf-priv.yaml': crlf(k8sPod([], [img, '          securityContext:', X('k8s-priv-crlf', 'ip-k8s/k8s-privileged', 'privileged in a CRLF file', '            privileged: true')])),
    'k8s/hostnet-caps.yaml': k8sPod([X('k8s-hostnet-title', 'ip-k8s/k8s-host-network', 'hostNetwork: True', '      hostNetwork: True')], [img]),
    'k8s/hostnet-quoted.yaml': k8sPod([X('k8s-hostnet-quoted', 'ip-k8s/k8s-host-network', 'hostNetwork: "true"', '      hostNetwork: "true"')], [img]),
    'k8s/hostpid-comment.yaml': k8sPod(['      # debugging only', X('k8s-hostpid-comment', 'ip-k8s/k8s-host-pid', 'hostPID with a trailing comment', '      hostPID: true   # remove later')], [img]),
    'k8s/escalation-flow.yaml': k8sPod([], [img, X('k8s-escalation-flow', 'ip-k8s/k8s-priv-escalation-true', 'allowPrivilegeEscalation in a flow mapping', '          securityContext: {allowPrivilegeEscalation: true, runAsNonRoot: true}')]),
    'k8s/escalation-quoted.yaml': k8sPod([], [img, '          securityContext:', X('k8s-escalation-quoted', 'ip-k8s/k8s-priv-escalation-true', 'allowPrivilegeEscalation: "true"', '            allowPrivilegeEscalation: "true"')]),
    'k8s/root-quoted.yaml': k8sPod([], [img, '          securityContext:', X('k8s-runasuser-quoted', 'ip-k8s/k8s-run-as-user-zero', 'runAsUser: "0"', '            runAsUser: "0"')]),
    'k8s/root-flow.yaml': k8sPod([], [img, X('k8s-runasuser-flow', 'ip-k8s/k8s-run-as-user-zero', 'runAsUser 0 in a flow mapping', '          securityContext: { runAsUser: 0, runAsGroup: 0 }')]),
    'k8s/latest-quoted.yaml': k8sPod([], [X('k8s-latest-quoted', 'ip-k8s/k8s-image-latest', 'a quoted image with the latest tag', '          image: "registry.example.com/web:latest"')]),
    'k8s/latest-single.yaml': k8sPod([], [X('k8s-latest-single-quote', 'ip-k8s/k8s-image-latest', 'a single-quoted latest image with a comment', "          image: 'registry.example.com/web:latest' # moving tag")]),
    'k8s/untagged.yaml': k8sPod([], [X('k8s-image-untagged-plain', 'ip-k8s/k8s-image-untagged', 'an image with no tag', '          image: registry.example.com/web')]),
    'k8s/sock-quoted.yaml': [...k8sHead, '      containers:', '        - name: web', img, '      volumes:', '        - name: docker', '          hostPath:', X('k8s-sock-quoted', 'ip-k8s/k8s-host-path-docker-socket', 'a quoted docker.sock hostPath', '            path: "/var/run/docker.sock"'), ''],
    'k8s/sock-flow.yaml': [...k8sHead, '      containers:', '        - name: web', img, '      volumes:', X('k8s-sock-flow', 'ip-k8s/k8s-host-path-docker-socket', 'docker.sock hostPath in a flow mapping', '        - { name: docker, hostPath: { path: /var/run/docker.sock } }'), ''],
    'k8s/secret-env.yaml': k8sPod([], [img, '          env:', '            - name: API_TOKEN', X('k8s-secret-env-quoted-name', 'ip-k8s/k8s-secret-literal-env', 'a token literal in env with quoted name', `              value: '${pw}'`)]),
    'k8s/secret-env-flow.yaml': k8sPod([], [img, '          env:', X('k8s-secret-env-flow', 'ip-k8s/k8s-secret-literal-env', 'a password literal in a flow env entry', `            - { name: DB_PASSWORD, value: "${pw}" }`)]),
    'charts/web/templates/deployment.yaml': ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: {{ .Release.Name }}', 'spec:', '  template:', '    spec:', '      {{- if .Values.debug }}', X('k8s-helm-hostnet', 'ip-k8s/k8s-host-network', 'hostNetwork inside a Helm template block', '      hostNetwork: true'), '      {{- end }}', '      containers:', '        - name: web', '          image: "{{ .Values.image }}"', ''],
    'overlays/prod/patch.yaml': ['apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: web', 'spec:', '  template:', '    spec:', '      containers:', '        - name: web', '          securityContext:', X('k8s-kustomize-patch-priv', 'ip-k8s/k8s-privileged', 'a kustomize strategic patch that makes the container privileged', '            privileged: true'), ''],
  }

  // ---------------------------------------------------------------- Terraform (HCL and JSON)
  const tf = {
    'terraform/spaced.tf': ['resource "aws_security_group" "a" {', '  ingress {', '    from_port = 22', '    to_port = 22', X('tf-ssh-spaced-list', 'ip-terraform-compose/tf-sg-open-22', 'SSH open with spaces inside the list', '    cidr_blocks = [ "0.0.0.0/0" ]'), '  }', '}', ''],
    'terraform/compact.tf': ['resource "aws_security_group" "b" {', '  ingress {', '    from_port=22', '    to_port=22', X('tf-ssh-compact', 'ip-terraform-compose/tf-sg-open-22', 'SSH open with no spaces around =', '    cidr_blocks=["0.0.0.0/0"]'), '  }', '}', ''],
    'terraform/v6.tf': ['resource "aws_security_group" "c" {', '  ingress {', '    from_port = 22', '    to_port = 22', X('tf-ssh-ipv6', 'ip-terraform-compose/tf-sg-open-22', 'SSH open to every IPv6 address', '    ipv6_cidr_blocks = ["::/0"]'), '  }', '}', ''],
    'terraform/acl2.tf': ['resource "aws_s3_bucket" "d" {', '  bucket = "d"', X('tf-acl-public-rw', 'ip-terraform-compose/tf-s3-public-acl', 'a public-read-write bucket ACL', '  acl    = "public-read-write"'), '}', ''],
    'terraform/acl3.tf': ['resource "aws_s3_bucket" "e" {', '  bucket = "e"', X('tf-acl-compact', 'ip-terraform-compose/tf-s3-public-acl', 'a public-read ACL with no spaces', '  acl="public-read"'), '}', ''],
    'terraform/rds2.tf': ['resource "aws_db_instance" "f" {', '  engine = "mysql"', X('tf-rds-public-compact', 'ip-terraform-compose/tf-rds-public', 'publicly_accessible with no spaces', '  publicly_accessible=true'), '}', ''],
    'terraform/rds3.tf': ['resource "aws_db_instance" "g" {', '  engine = "mysql"', X('tf-rds-public-comment', 'ip-terraform-compose/tf-rds-public', 'publicly_accessible with a trailing comment', '  publicly_accessible = true # needed for the BI tool'), '}', ''],
    'terraform/rds4.tf': ['resource "aws_db_instance" "h" {', '  engine = "mysql"', X('tf-rds-unencrypted-compact', 'ip-terraform-compose/tf-rds-unencrypted', 'storage_encrypted false, no spaces', '  storage_encrypted=false'), '}', ''],
    'terraform/iam2.tf': ['data "aws_iam_policy_document" "i" {', '  statement {', X('tf-iam-star-spaced', 'ip-terraform-compose/tf-iam-wildcard-action', 'actions list with a star and spaces', '    actions = [ "*" ]'), '    resources = ["*"]', '  }', '}', ''],
    'terraform/iam3.tf': ['resource "aws_iam_policy" "j" {', '  policy = jsonencode({', '    Statement = [{', '      Effect = "Allow"', X('tf-iam-jsonencode-star', 'ip-terraform-compose/tf-iam-wildcard-action', 'Action star inside jsonencode', '      Action = "*"'), '      Resource = "*"', '    }]', '  })', '}', ''],
    'terraform/iam4.tf': ['resource "aws_iam_policy" "k" {', '  policy = <<EOF', '{"Statement":[{"Effect":"Allow",', X('tf-iam-heredoc-star', 'ip-terraform-compose/tf-iam-wildcard-action', 'Action star in a heredoc JSON policy', '"Action":"*","Resource":"*"}]}'), 'EOF', '}', ''],
    'terraform/pw2.tf': ['resource "aws_db_instance" "l" {', '  username = "admin"', X('tf-password-compact', 'ip-terraform-compose|secrets-plus', 'a password literal with no spaces', `  password="${pw}"`), '}', ''],
    'terraform/json/sg.tf.json': ['{', '  "resource": { "aws_security_group": { "web": { "ingress": [ {', '    "from_port": 22, "to_port": 22,', X('tf-json-ssh', 'ip-terraform-compose/tf-sg-open-22', 'SSH open to the internet in a JSON Terraform file', '    "cidr_blocks": ["0.0.0.0/0"]'), '  } ] } } }', '}', ''],
    'terraform/json/rds.tf.json': ['{', '  "resource": { "aws_db_instance": { "main": {', '    "engine": "postgres",', X('tf-json-rds-public', 'ip-terraform-compose/tf-rds-public', 'a public database in a JSON Terraform file', '    "publicly_accessible": true'), '  } } }', '}', ''],
    'terraform/json/s3.tf.json': ['{', '  "resource": { "aws_s3_bucket_acl": { "a": {', '    "bucket": "x",', X('tf-json-public-acl', 'ip-terraform-compose/tf-s3-public-acl', 'a public-read ACL in a JSON Terraform file', '    "acl": "public-read"'), '  } } }', '}', ''],
  }

  // ---------------------------------------------------------------- Compose
  const compose = {
    'compose/compose-latest-quoted.yml': ['services:', '  cache:', X('compose-latest-quoted', 'compose-hygiene|ip-terraform-compose', 'a quoted image with the latest tag', '    image: "redis:latest"'), ''],
    'compose/compose-latest-implicit.yml': ['services:', '  db:', X('compose-image-untagged', 'compose-hygiene|ip-terraform-compose', 'an image with no tag', '    image: postgres'), ''],
    'compose/compose-priv-quoted.yml': ['services:', '  agent:', '    image: agent:1.0', X('compose-priv-quoted', 'compose-hygiene|ip-terraform-compose', 'privileged: "true" quoted', '    privileged: "true"'), ''],
    'compose/compose-priv-yes.yml': ['services:', '  agent:', '    image: agent:1.0', X('compose-priv-yes', 'compose-hygiene|ip-terraform-compose', 'privileged: yes', '    privileged: yes'), ''],
    'compose/compose-nethost-quoted.yml': ['services:', '  agent:', '    image: agent:1.0', X('compose-nethost-quoted', 'compose-hygiene|ip-terraform-compose', "network_mode: 'host' quoted", "    network_mode: 'host'"), ''],
    'compose/compose-pw-map.yml': ['services:', '  db:', '    image: postgres:16', '    environment:', X('compose-pw-map-form', 'compose-hygiene|secrets-plus', 'a database password in map-form environment', `      POSTGRES_PASSWORD: ${pw}`), ''],
    'compose/compose-pw-list.yml': ['services:', '  db:', '    image: postgres:16', '    environment:', X('compose-pw-list-form', 'compose-hygiene|secrets-plus', 'a database password in list-form environment', `      - POSTGRES_PASSWORD=${pw}`), ''],
    'compose/compose-pw-quoted.yml': ['services:', '  db:', '    image: postgres:16', '    environment:', X('compose-pw-quoted', 'compose-hygiene|secrets-plus', 'a quoted list-form password', `      - "MYSQL_ROOT_PASSWORD=${pw}"`), ''],
    'compose/compose-dbport-unquoted.yml': ['services:', '  db:', '    image: postgres:16', '    ports:', X('compose-dbport-unquoted', 'compose-hygiene|ip-terraform-compose', 'the database port published unquoted', '      - 5432:5432'), ''],
    'compose/compose-dbport-long.yml': ['services:', '  db:', '    image: mysql:8', '    ports:', X('compose-dbport-long-syntax', 'compose-hygiene|ip-terraform-compose', 'the database port published with the long syntax', '      - target: 3306\n        published: 3306'), ''],
    'compose/compose-sock-long.yml': ['services:', '  ci:', '    image: ci:1.0', '    volumes:', X('compose-sock-long', 'ip-terraform-compose|compose-hygiene', 'the docker socket mounted with the long syntax', '      - type: bind\n        source: /var/run/docker.sock\n        target: /var/run/docker.sock'), ''],
    'compose/compose-sock-quoted.yml': ['services:', '  ci:', '    image: ci:1.0', '    volumes:', X('compose-sock-quoted', 'ip-terraform-compose|compose-hygiene', 'the docker socket mounted, quoted with :ro', '      - "/var/run/docker.sock:/var/run/docker.sock:ro"'), ''],
    'compose/compose-pid-host.yml': ['services:', '  agent:', '    image: agent:1.0', X('compose-pid-host', 'ip-terraform-compose/compose-pid-host', 'pid: host', '    pid: "host"'), ''],
    'compose/compose-capadd.yml': ['services:', '  agent:', '    image: agent:1.0', '    cap_add:', X('compose-cap-sys-admin', 'ip-terraform-compose/compose-cap-add-dangerous', 'cap_add SYS_ADMIN', '      - SYS_ADMIN'), ''],
    'compose/compose-user-root.yml': ['services:', '  agent:', '    image: agent:1.0', X('compose-user-root-pair', 'ip-terraform-compose/compose-user-root', 'user "0:0"', '    user: "0:0"'), ''],
  }

  // ---------------------------------------------------------------- GitHub Actions
  const wf = (on, ...jobLines) => [on, 'jobs:', '  build:', '    runs-on: ubuntu-24.04', '    steps:', '      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332', ...jobLines, '']
  const gha = {
    '.github/workflows/prt-flow.yml': wf(X('gha-prt-flow-list', 'ip-gha/gha-pull-request-target-trigger', 'pull_request_target in a flow list', 'on: [pull_request_target, push]')),
    '.github/workflows/prt-map.yml': wf('on: { pull_request_target: { types: [opened] } }'.replace('on: ', 'name: x\non: ')).map((l) => l),
    '.github/workflows/prt-quoted.yml': wf('"on":\n  ' + 'pull_request_target:\n    types: [opened]'),
    '.github/workflows/perm-flow.yml': ['on: push', X('gha-perm-flow-write', 'ip-gha/gha-contents-write', 'contents: write in a flow mapping', 'permissions: { contents: write }'), 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi', ''],
    '.github/workflows/perm-flow2.yml': ['on: push', X('gha-perm-flow-multi', 'ip-gha/gha-contents-write', 'contents: write in a multi-key flow mapping', 'permissions: {id-token: write, contents: write}'), 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi', ''],
    '.github/workflows/perm-all-comment.yml': ['on: push', X('gha-perm-write-all-comment', 'ip-gha/gha-permissions-write-all', 'write-all with a comment', 'permissions: write-all # simpler'), 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi', ''],
    '.github/workflows/perm-all-quoted.yml': ['on: push', X('gha-perm-write-all-quoted', 'ip-gha/gha-permissions-write-all', 'write-all quoted', 'permissions: "write-all"'), 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi', ''],
    '.github/workflows/perm-job.yml': ['on: push', 'permissions: {}', 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    permissions:', X('gha-perm-job-write', 'ip-gha/gha-contents-write', 'contents: write at job level', '      contents: write'), '    steps:', '      - run: echo hi', ''],
    '.github/workflows/inj-nospace.yml': wf('on: issues', X('gha-inj-nospace', 'ip-gha/gha-inject-issue-text-run', 'issue title with no spaces in the expression', '      - run: echo "${{github.event.issue.title}}"')),
    '.github/workflows/inj-block.yml': wf('on: issue_comment', '      - run: |', '          echo starting', X('gha-inj-block', 'ip-gha/gha-inject-issue-text-run', 'a comment body inside a block run', '          echo "${{ github.event.comment.body }}"')),
    '.github/workflows/inj-headref.yml': wf('on: pull_request', X('gha-inj-head-ref', 'ip-gha/gha-inject-head-ref-run', 'head_ref in run', '      - run: git checkout ${{ github.head_ref }}')),
    '.github/workflows/inj-headref2.yml': wf('on: pull_request', '      - run: |', '          echo building', X('gha-inj-head-ref-pr', 'ip-gha/gha-inject-head-ref-run', 'pull_request head ref in a block run', '          echo ${{ github.event.pull_request.head.ref }}')),
    '.github/workflows/inj-body.yml': wf('on: pull_request', X('gha-inj-pr-body', 'ip-gha/gha-inject-issue-text-run', 'pull request body in run', '      - run: echo "${{ github.event.pull_request.body }}"')),
    '.github/workflows/curl1.yml': wf('on: push', X('gha-curl-sudo-bash', 'ip-gha/gha-curl-pipe-shell', 'curl piped to sudo bash', '      - run: curl -sSL https://example.com/i.sh | sudo bash')),
    '.github/workflows/curl2.yml': wf('on: push', X('gha-wget-sh', 'ip-gha/gha-curl-pipe-shell', 'wget piped to sh', '      - run: wget -qO- https://example.com/i.sh | sh')),
    '.github/workflows/curl3.yml': wf('on: push', '      - run: |', X('gha-curl-block-bash', 'ip-gha/gha-curl-pipe-shell', 'curl piped to bash inside a block', '          curl -fsSL https://example.com/i.sh | bash -s -- --yes')),
    '.github/workflows/unpinned1.yml': ['on: push', 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', X('gha-unpinned-main', 'workflow-security|ip-gha|github-actions-reusable', 'an action pinned to a branch', '      - uses: actions/checkout@main'), ''],
    '.github/workflows/unpinned2.yml': ['on: push', 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', X('gha-unpinned-thirdparty-tag', 'workflow-security|ip-gha|github-actions-reusable', 'a third-party action pinned to a mutable tag', '      - uses: someorg/deploy-action@v2'), ''],
    '.github/workflows/unpinned3.yml': ['on: push', 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', X('gha-unpinned-quoted', 'workflow-security|ip-gha|github-actions-reusable', 'a quoted unpinned action', '      - uses: "docker/build-push-action@v5"'), ''],
    '.github/workflows/prt-checkout2.yml': ['on: pull_request_target', 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', '      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332', '        with:', X('gha-prt-checkout-head-ref', 'ip-gha/gha-prt-checkout-pr-head', 'checkout of the PR head ref', '          ref: ${{ github.event.pull_request.head.ref }}'), ''],
    '.github/workflows/prt-checkout3.yml': ['on: pull_request_target', 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', '      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332', '        with:', X('gha-prt-checkout-merge-ref', 'ip-gha/gha-prt-checkout-pr-head', 'checkout of refs/pull merge ref', '          ref: refs/pull/${{ github.event.number }}/merge'), ''],
    '.github/workflows/env-secret.yml': wf('on: push', '        env:', X('gha-hardcoded-token-env', 'ip-gha/gha-hardcoded-env-secret', 'a token literal in step env', `          API_TOKEN: ${pw}`)),
  }
  // the second flow-style file above had a join mistake guard: rewrite it plainly
  gha['.github/workflows/prt-map.yml'] = ['name: x', X('gha-prt-flow-map', 'ip-gha/gha-pull-request-target-trigger', 'pull_request_target in a flow mapping', 'on: { pull_request_target: { types: [opened] } }'), 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi', '']
  gha['.github/workflows/prt-quoted.yml'] = ['name: y', '"on":', X('gha-prt-block-quoted-on', 'ip-gha/gha-pull-request-target-trigger', 'pull_request_target under a quoted "on" key', '  pull_request_target:'), '    types: [opened]', 'jobs:', '  b:', '    runs-on: ubuntu-24.04', '    steps:', '      - run: echo hi', '']

  // ---------------------------------------------------------------- other CI systems
  const ci = {
    '.gitlab-ci.yml': ['stages: [build]', 'build:', X('gitlab-image-latest-explicit', 'gitlab-ci-images', 'an image with the latest tag', '  image: node:latest'), '  script: [echo hi]', '', 'lint:', X('gitlab-image-name-form', 'gitlab-ci-images', 'image given with name: and latest', '  image:\n    name: "alpine:latest"\n    entrypoint: [""]'), '  script: [echo lint]', '', 'db:', '  image: ruby:3.3', X('gitlab-service-latest', 'gitlab-ci-images', 'a service with the latest tag', '  services:\n    - postgres:latest'), '  script: [echo db]', '', 'variables:', X('gitlab-secret-variable', 'gitlab-ci-secrets', 'a token written into variables', `  DEPLOY_TOKEN: "${pw}"`), ''],
    'ci/gitlab-extra.gitlab-ci.yml': ['deploy:', '  image: docker:24', '  services:', '    - docker:24-dind', '  variables:', X('gitlab-dind-tls-off', 'gitlab-ci-privileged', 'docker-in-docker with TLS turned off', '    DOCKER_TLS_CERTDIR: ""'), '  script: [docker ps]', ''],
    '.circleci/config.yml': ['version: 2.1', 'jobs:', '  build:', '    docker:', X('circle-image-latest', 'circleci-config', 'an executor image with the latest tag', '      - image: cimg/node:latest'), '    steps:', '      - checkout', '      - run: echo hi', 'workflows:', '  main:', '    jobs: [build]', ''],
    'azure-pipelines.yml': ['trigger: [main]', 'pool:', "  vmImage: 'ubuntu-latest'", 'steps:', X('azure-curl-bash', 'azure-pipelines', 'curl piped to bash in a script step', '  - script: curl -sSL https://example.com/i.sh | bash'), ''],
    Jenkinsfile: ['pipeline {', '  agent any', '  stages {', '    stage("build") {', '      steps {', X('jenkins-curl-sh', 'jenkinsfile-safety', 'curl piped to sh in a shell step', '        sh "curl -sSL https://example.com/i.sh | sh"'), '      }', '    }', '  }', '}', ''],
  }

  // ---------------------------------------------------------------- web: headers, TLS, cookies, html
  const web = {
    'nginx/legacy-tls.conf': ['server {', '  listen 443 ssl;', X('web-tls-sslv3', 'wh-headers/tls-protocol-legacy', 'SSLv3 and TLS 1.0 enabled', '  ssl_protocols SSLv3 TLSv1 TLSv1.2;'), '  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;', '  add_header X-Frame-Options DENY always;', '  add_header X-Content-Type-Options nosniff always;', '  add_header Referrer-Policy no-referrer always;', '}', ''],
    'nginx/location-csp.conf': ['server {', '  listen 443 ssl;', '  ssl_protocols TLSv1.2 TLSv1.3;', '  location /app/ {', X('web-nginx-csp-location', 'wh-headers/csp-unsafe-inline-script', "script-src 'unsafe-inline' inside a location block", `    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'" always;`), '  }', '}', ''],
    'nginx/cors-star.conf': ['server {', '  listen 80;', '  location /api/ {', X('web-nginx-cors-always', 'wh-headers', 'a wildcard CORS header with always', '    add_header Access-Control-Allow-Origin * always;'), '  }', '}', ''],
    'nginx/server-tokens.conf': ['http {', X('web-server-tokens', 'wh-headers/nginx-server-tokens-on', 'server_tokens on', '  server_tokens on;'), '  server {', '    listen 80;', '  }', '}', ''],
    'nginx/autoindex.conf': ['server {', '  listen 80;', '  location /files/ {', X('web-autoindex', 'wh-headers/nginx-autoindex-on', 'autoindex on in a location', '    autoindex on;'), '  }', '}', ''],
    'apache/csp.conf': ['<VirtualHost *:443>', X('web-apache-csp-unsafe-eval', 'wh-headers/csp-unsafe-eval', "Apache CSP with 'unsafe-eval'", `  Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-eval'"`), '</VirtualHost>', ''],
    'apache/.htaccess': ['Options -MultiViews', X('web-apache-indexes', 'wh-headers/apache-indexes-option', 'Options +Indexes', 'Options +Indexes'), 'RewriteEngine On', ''],
    'apache/tls.conf': ['<VirtualHost *:443>', X('web-apache-sslprotocol', 'wh-headers/tls-protocol-legacy', 'Apache enabling TLS 1.0', '  SSLProtocol +TLSv1 +TLSv1.2'), '</VirtualHost>', ''],
    Caddyfile: ['example.com {', X('web-caddy-csp', 'wh-headers/csp-unsafe-inline-script', 'Caddy CSP with unsafe-inline scripts', `  header Content-Security-Policy "script-src 'self' 'unsafe-inline'"`), '}', ''],
    'src/server-helmet.js': ["const express = require('express')", "const helmet = require('helmet')", 'const app = express()', X('web-helmet-hsts-false', 'wh-headers', 'helmet with HSTS turned off', 'app.use(helmet({ hsts: false }))'), '', X('web-helmet-csp-false', 'wh-headers', 'helmet with the content security policy turned off', 'app.use(helmet({ contentSecurityPolicy: false }))'), 'app.listen(3000)', ''],
    'src/server-cookie.js': ["const session = require('express-session')", "const express = require('express')", 'const app = express()', 'app.use(session({', "  secret: process.env.SECRET,", '  cookie: {', X('web-cookie-httponly-false', 'wh-headers/session-cookie-no-httponly', 'a session cookie with httpOnly false', '    httpOnly: false,'), '  },', '}))', ''],
    'src/server-powered.js': ["const express = require('express')", 'const app = express()', X('web-x-powered-by-enable', 'wh-headers/express-x-powered-by-enabled', "app.enable('x-powered-by')", "app.enable('x-powered-by')"), 'app.listen(3000)', ''],
    'src/server-cors.js': ["const express = require('express')", 'const app = express()', "app.use((req, res, next) => {", X('web-cors-reflect', 'wh-headers/cors-reflects-request-origin', 'the request Origin echoed back', "  res.setHeader('Access-Control-Allow-Origin', req.headers.origin)"), "  res.setHeader('Access-Control-Allow-Credentials', 'true')", '  next()', '})', ''],
  }
  const htmlHead = ['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">', '<title>Variant</title>', '</head>', '<body>']
  const html = {
    'site/form-http.html': [...htmlHead, '<main>', X('web-form-http', 'wh-html/form-action-over-http', 'a form posting over plain http', '<form action="http://example.com/login" method="post"><label>Name <input name="n"></label></form>'), '</main>', '</body>', '</html>', ''],
    'site/iframe-nosandbox.html': [...htmlHead, '<main>', X('web-iframe-no-sandbox-multi', 'wh-html/iframe-no-sandbox', 'a third-party iframe with no sandbox, attributes on several lines', '<iframe\n  src="https://widgets.example.com/x"\n  title="Widget"\n></iframe>'), '</main>', '</body>', '</html>', ''],
    'site/css-single.html': [...htmlHead.slice(0, 5), X('web-css-http-single-quote', 'wh-html/stylesheet-over-http|mixed-content', 'a stylesheet over http in single quotes', "<link rel='stylesheet' href='http://cdn.example.com/site.css'>"), '<title>t</title></head>', '<body><main>x</main></body>', '</html>', ''],
    'site/script-http.html': [...htmlHead, '<main>x</main>', X('web-script-http', 'mixed-content', 'a script loaded over plain http', '<script src="http://cdn.example.com/lib.js"></script>'), '</body>', '</html>', ''],
    'site/img-upper.html': [...htmlHead, '<main>', X('web-img-upper-no-alt', 'image-alt-quality|ui-static|html-valid-basics', 'an upper-case IMG tag with no alt', '<IMG SRC="photo.png" width="10" height="10">'), '</main>', '</body>', '</html>', ''],
    'site/img-unquoted.html': [...htmlHead, '<main>', X('web-img-unquoted-no-alt', 'image-alt-quality|ui-static|html-valid-basics', 'an img with unquoted attributes and no alt', '<img src=photo.png width=10 height=10>'), '</main>', '</body>', '</html>', ''],
    'site/img-multiline.html': [...htmlHead, '<main>', X('web-img-multiline-no-alt', 'image-alt-quality|ui-static|html-valid-basics', 'an img over several lines with no alt', '<img\n  src="photo.png"\n  width="10"\n  height="10"\n>'), '</main>', '</body>', '</html>', ''],
    'site/blank-multiline.html': [...htmlHead, '<main>', X('web-blank-multiline', 'target-blank-noopener', 'target=_blank over several lines with no rel', '<a\n  href="https://example.com"\n  target="_blank"\n>Visit example</a>'), '</main>', '</body>', '</html>', ''],
    'site/blank-single.html': [...htmlHead, '<main>', X('web-blank-single-quote', 'target-blank-noopener', "target='_blank' single quoted", "<a href='https://example.com' target='_blank'>Visit example</a>"), '</main>', '</body>', '</html>', ''],
    'src/Link.jsx': ['export function Link() {', '  return (', X('web-jsx-blank', 'target-blank-noopener', 'target="_blank" in JSX with no rel', '    <a href="https://example.com" target="_blank">Visit example</a>'), '  )', '}', ''],
    'src/Card.jsx': ['export function Card({ src }) {', '  return (', X('web-jsx-img-no-alt', 'image-alt-quality|ui-static|html-valid-basics', 'an img in JSX with no alt', '    <img src={src} width={10} height={10} />'), '  )', '}', ''],
    'src/Card.vue': ['<template>', '  <div>', X('web-vue-img-no-alt', 'image-alt-quality|ui-static|html-valid-basics', 'a bound img in a Vue template with no alt', '    <img :src="photo" width="10" height="10">'), '  </div>', '</template>', ''],
    'src/Card.svelte': ['<div>', X('web-svelte-img-no-alt', 'image-alt-quality|ui-static|html-valid-basics', 'an img in a Svelte component with no alt', '  <img src={photo} width="10" height="10" />'), '</div>', ''],
    'site/nolang-upper.html': ['<!DOCTYPE html>', X('web-html-no-lang-upper', 'html-structure|ui-static', 'an upper-case HTML tag with no lang', '<HTML>'), '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title></head>', '<body><main>x</main></body>', '</HTML>', ''],
    'site/inline-handler.html': [...htmlHead, '<main>', X('web-inline-handler-single', 'inline-event-handlers', "an inline handler in single quotes", "<button type='button' onclick='go()'>Go</button>"), '</main>', '</body>', '</html>', ''],
    'site/dupe-id.html': [...htmlHead, '<main>', '<p id="a">one</p>', X('web-dupe-id-single', 'duplicate-ids', "a duplicate id written with single quotes", "<p id='a'>two</p>"), '</main>', '</body>', '</html>', ''],
    'site/tabindex.html': [...htmlHead, '<main>', X('web-tabindex-positive-single', 'ui-static|html-valid-basics', 'a positive tabindex in single quotes', "<div tabindex='3'>x</div>"), '</main>', '</body>', '</html>', ''],
    'site/link-text.html': [...htmlHead, '<main>', X('web-link-text-click-here', 'link-text', 'link text that says click here', '<a href="/docs">Click here</a>'), '</main>', '</body>', '</html>', ''],
    'site/link-text2.html': [...htmlHead, '<main>', X('web-link-text-read-more', 'link-text', 'link text that says read more', '<a href="/docs">read more</a>'), '</main>', '</body>', '</html>', ''],
    'site/table-nth.html': [...htmlHead, '<main>', X('web-table-no-th', 'table-headers', 'a data table with no header cells, attributes on the table tag', '<table class="data" id="t1">\n<tr><td>a</td><td>b</td></tr>\n<tr><td>c</td><td>d</td></tr>\n</table>'), '</main>', '</body>', '</html>', ''],
    'site/video.html': [...htmlHead, '<main>', X('web-video-no-track', 'media-captions', 'a video with controls and no captions track', '<video controls src="clip.mp4"></video>'), '</main>', '</body>', '</html>', ''],
    'site/iframe-title.html': [...htmlHead, '<main>', X('web-iframe-no-title', 'iframe-title', 'an iframe with no title', '<iframe src="https://widgets.example.com/y"></iframe>'), '</main>', '</body>', '</html>', ''],
    'site/sri.html': [...htmlHead, '<main>x</main>', X('web-sri-missing-script', 'sri-missing', 'a third-party script with no integrity', '<script src="https://cdn.example.com/lib.js"></script>'), '</body>', '</html>', ''],
    'site/sri2.html': [...htmlHead.slice(0, 5), X('web-sri-missing-link', 'sri-missing', 'a third-party stylesheet with no integrity', '<link rel="stylesheet" href="https://cdn.example.com/lib.css">'), '<title>t</title></head><body><main>x</main></body>', '</html>', ''],
    'site/style.css': ['a:focus {', X('web-css-outline-zero', 'focus-visible', 'outline: 0 on focus', '  outline: 0;'), '}', ''],
    'site/style2.css': ['button:focus { outline: none; }', '', X('web-css-outline-none-oneline', 'focus-visible', 'outline none in a one-line rule', 'input:focus-visible { outline: none }'), ''],
  }
  const pub = {
    'public/.env.local': [X('pub-env-local', 'wh-publish-root/env-file-present', 'an env file in the published folder', `TOKEN=${pw}`), ''],
    'public/dump.sql': [X('pub-sql-dump', 'wh-publish-root/database-dump-in-public', 'a SQL dump in the published folder', 'CREATE TABLE users (id int);\nINSERT INTO users VALUES (1);'), ''],
    'public/app.js.map': [X('pub-sourcemap', 'wh-publish-root/sourcemap-shipped|wh-html/sourcemap-shipped', 'a source map in the published folder', '{"version":3,"sources":["a.js"],"mappings":"AAAA"}'), ''],
    'public/index.html.bak': [X('pub-bak', 'wh-publish-root/backup-file-present', 'a backup file in the published folder', '<html></html>'), ''],
    'public/.htpasswd': [X('pub-htpasswd', 'wh-publish-root/htpasswd-file', 'an .htpasswd file in the published folder', 'admin:$apr1$abc$def'), ''],
    'public/phpinfo.php': [X('pub-phpinfo', 'wh-publish-root/phpinfo-or-test-page', 'a phpinfo page in the published folder', '<?php phpinfo();'), ''],
    'public/id_rsa': [X('pub-private-key', 'wh-publish-root/private-key-file', 'a private key file in the published folder', 'key material placeholder'), ''],
    'public/.DS_Store': [X('pub-ds-store', 'wh-publish-root/desktop-metadata-file', 'a .DS_Store file in the published folder', 'Bud1'), ''],
    'public/WEB-INF/web.xml': [X('pub-web-inf', 'wh-publish-root/web-inf-folder', 'a WEB-INF folder in the published folder', '<web-app/>'), ''],
    'netlify.toml': ['[build]', X('pub-netlify-root', 'wh-publish-root/netlify-publish-is-repo-root', 'Netlify publishing the repository root', '  publish = "."'), ''],
  }

  // ---------------------------------------------------------------- package, lockfile, npmrc
  const dep = (k, v) => ({ [k]: v })
  const packages = {
    'pkgs/star/package.json': pkg('pkg-star', { dependencies: { left: '*', right: '1.0.0' } }).map((t) => t),
  }
  // write package.json variants as plain files with a marked line
  const pj = (key, exp, desc, line) => ['{', '  "name": "p", "version": "1.0.0", "license": "MIT", "private": true,', '  "dependencies": {', X(key, exp, desc, line), '  }', '}', '']
  const pkgFiles = {
    'pkgs/a/package.json': pj('pkg-empty-range', 'wildcard-versions', 'an empty version range', '    "left": ""'),
    'pkgs/b/package.json': pj('pkg-gte-range', 'wildcard-versions|dependency-pinning', 'an open >= range', '    "left": ">=1.0.0"'),
    'pkgs/c/package.json': pj('pkg-x-range', 'wildcard-versions|dependency-pinning', 'a 1.x range', '    "left": "1.x"'),
    'pkgs/d/package.json': pj('pkg-github-shorthand', 'wh-supply/package-git-or-tarball-dependency|dependency-pinning', 'a github: shorthand dependency', '    "left": "github:someone/left"'),
    'pkgs/e/package.json': pj('pkg-git-ssh', 'wh-supply/package-git-or-tarball-dependency|dependency-pinning', 'a git+ssh dependency with no commit', '    "left": "git+ssh://git@github.com/someone/left.git"'),
    'pkgs/f/package.json': pj('pkg-tarball-https', 'wh-supply/package-git-or-tarball-dependency|dependency-pinning', 'a tarball URL dependency', '    "left": "https://example.com/left-1.0.0.tgz"'),
    'pkgs/g/package.json': ['{', '  "name": "g", "version": "1.0.0", "license": "MIT", "private": true,', '  "dependencies": {', '    "left": "1.0.0",', X('pkg-jest-in-deps', 'dev-deps-in-prod', 'jest listed in dependencies', '    "jest": "29.7.0"'), '  }', '}', ''],
    'pkgs/h/package.json': ['{', '  "name": "h", "version": "1.0.0", "license": "MIT", "private": true,', '  "dependencies": {', '    "left": "1.0.0",', X('pkg-eslint-in-deps', 'dev-deps-in-prod', 'eslint and typescript listed in dependencies', '    "typescript": "5.4.5",\n    "eslint": "9.0.0"'), '  }', '}', ''],
    'pkgs/i/package.json': ['{', '  "name": "i", "version": "1.0.0", "license": "MIT", "private": true,', '  "scripts": {', X('pkg-preinstall-wget', 'install-scripts', 'a preinstall that pipes wget into sh', '    "preinstall": "wget -qO- https://example.com/i.sh | sh"'), '  }', '}', ''],
    'pkgs/j/package.json': ['{', '  "name": "j", "version": "1.0.0", "license": "MIT", "private": true,', '  "scripts": {', X('pkg-postinstall-node-e', 'install-scripts', 'a postinstall that evaluates a downloaded script', '    "postinstall": "node -e \\"require(\'https\').get(\'https://example.com/x.js\', r => r.pipe(process.stdout))\\""'), '  }', '}', ''],
    'pkgs/k/package.json': ['{', '  "name": "k", "version": "1.0.0", "license": "MIT", "private": true,', '  "scripts": {', X('pkg-install-script-curl', 'install-scripts', 'an install script that downloads and runs a file', '    "install": "curl -s https://example.com/x | bash"'), '  }', '}', ''],
    'pkgs/l/.npmrc': ['registry=https://registry.npmjs.org/', X('npmrc-token-line', 'secrets-plus/npmrc-auth-token', 'an auth token on its own registry line', `//registry.npmjs.org/:_authToken=${npmTok}`), ''],
    'pkgs/m/.npmrc': [X('npmrc-registry-http', 'wh-supply/npmrc-registry-over-http', 'the registry set over plain http', 'registry=http://registry.example.com/'), ''],
    'pkgs/n/.npmrc': [X('npmrc-strict-ssl-spaced', 'wh-supply|secrets-plus', 'strict-ssl turned off, with spaces', 'strict-ssl = false'), ''],
    'pkgs/o/package-lock.json': ['{', '  "name": "o", "lockfileVersion": 3,', '  "packages": {', '    "": { "name": "o" },', '    "node_modules/left": {', '      "version": "1.0.0",', X('lock-http-v3', 'wh-supply/lockfile-resolved-over-http', 'a lockfile v3 entry resolved over http', '      "resolved": "http://registry.npmjs.org/left/-/left-1.0.0.tgz",'), '      "integrity": "sha512-AAAA"', '    }', '  }', '}', ''],
    'pkgs/p/yarn.lock': ['# yarn lockfile v1', '', 'left@^1.0.0:', '  version "1.0.0"', X('lock-http-yarn', 'wh-supply/lockfile-resolved-over-http', 'a yarn.lock entry resolved over http', '  resolved "http://registry.yarnpkg.com/left/-/left-1.0.0.tgz#abc"'), '  integrity sha512-AAAA', ''],
    'pkgs/q/package-lock.json': ['{', '  "name": "q", "lockfileVersion": 3,', '  "packages": {', '    "node_modules/left": {', '      "version": "1.0.0",', '      "resolved": "https://registry.npmjs.org/left/-/left-1.0.0.tgz"', X('lock-no-integrity', 'wh-supply/lockfile-entry-no-integrity', 'a lockfile entry with no integrity hash', '    }'), '  }', '}', ''],
  }
  void dep
  void packages

  // ---------------------------------------------------------------- config files and data files
  const config = {
    'cfg/flow-unclosed-eof.yaml': ['name: x', X('yaml-flow-seq-eof', 'yaml-valid', 'a flow sequence that is never closed at the end of the file', 'items: [one, two, three'), ''],
    'cfg/flow-multi.yaml': ['name: x', 'build:', X('yaml-flow-seq-multiline-unclosed', 'yaml-valid', 'a multi-line flow sequence closed by the next key', '  steps: [\n    one,\n    two'), 'deploy: true', ''],
    'cfg/flow-map-eof.yaml': ['name: x', X('yaml-flow-map-eof', 'yaml-valid', 'a flow mapping that is never closed', 'opts: { a: 1, b: 2'), ''],
    'cfg/flow-mismatch.yaml': ['name: x', X('yaml-flow-mismatch', 'yaml-valid', 'a flow sequence closed with a brace', 'list: [1, 2, 3}'), ''],
    'cfg/dup-nested.yaml': ['server:', '  port: 80', X('yaml-dup-nested', 'yaml-valid', 'a key repeated inside a nested mapping', '  port: 8080'), ''],
    'cfg/dup-item.yaml': ['items:', '  - name: a', X('yaml-dup-in-item', 'yaml-valid', 'a key repeated inside a list item', '    name: b'), ''],
    'cfg/alias.yaml': ['defaults: &defaults', '  retries: 3', 'job:', X('yaml-undefined-alias', 'yaml-valid', 'an alias with no matching anchor', '  <<: *missing'), ''],
    'cfg/tab-mid.yaml': ['a:', '  b: 1', X('yaml-tab-mid-file', 'yaml-valid', 'a tab used as indentation in the middle of a file', '\tc: 2'), ''],
    'cfg/quote-open.yaml': ['name: ok', X('yaml-quote-unclosed', 'yaml-valid', 'a double quote that is never closed', 'title: "unterminated'), ''],
    'cfg/crlf-dup.yaml': crlf(['a: 1', X('yaml-crlf-dup', 'yaml-valid', 'a repeated top-level key in a CRLF file', 'a: 2'), '']),
    'cfg/multidoc.yaml': ['a: 1', '---', 'b: 1', X('yaml-multidoc-dup', 'yaml-valid', 'a repeated key in the second document', 'b: 2'), ''],
    'cfg/dup-table.toml': ['[server]', 'port = 80', '[db]', 'host = "x"', X('toml-dup-table', 'toml-valid', 'a table header given twice', '[server]'), ''],
    'cfg/dup-key.toml': ['[server]', 'port = 80', X('toml-dup-key', 'toml-valid', 'a key given twice in one table', 'port = 81'), ''],
    'cfg/str-open.toml': ['[server]', X('toml-string-unclosed', 'toml-valid', 'a string that is never closed', 'name = "abc'), ''],
    'cfg/arr-open.toml': ['[server]', X('toml-array-unclosed', 'toml-valid', 'a multi-line array that is never closed', 'ports = [\n  80,\n  443,'), '[db]', 'host = "x"', ''],
    'cfg/bad-header.toml': [X('toml-bad-header', 'toml-valid', 'a malformed table header', '[server'), 'port = 80', ''],
    'cfg/crlf.toml': crlf(['[a]', X('toml-crlf-empty-value', 'toml-valid', 'a key with no value in a CRLF file', 'port ='), '']),
    'cfg/trailing.json': ['{', '  "a": [1, 2,', X('json-trailing-comma-nested', 'json-valid', 'a trailing comma inside a nested array', '    3,'), '  ]', '}', ''],
    'cfg/comment.json': ['{', X('json-line-comment', 'json-valid', 'a // comment in a JSON file', '  // the port'), '  "port": 80', '}', ''],
    'cfg/single-quote.json': ['{', X('json-single-quotes', 'json-valid', 'single-quoted strings in JSON', "  'a': 'b'"), '}', ''],
    'cfg/dup-nested.json': ['{', '  "outer": {', '    "a": 1,', X('json-dup-nested', 'json-duplicate-keys', 'a key repeated in a nested JSON object', '    "a": 2'), '  }', '}', ''],
    'cfg/dup-array.json': ['{ "list": [', '  { "id": 1,', X('json-dup-in-array', 'json-duplicate-keys', 'a repeated key in an object inside an array', '    "id": 2 }'), '] }', ''],
    'data/crlf.csv': crlf(['id,name', '1,a', X('csv-crlf-ragged', 'csv-consistent', 'a short row in a CRLF CSV', '2'), '3,c', '']),
    'data/quoted.csv': ['id,name,note', '1,a,"x, y"', X('csv-quoted-then-short', 'csv-consistent', 'a short row after a quoted field with a comma', '2,b'), ''],
    'data/semicolon.csv': ['id;name;score', '1;a;4', X('csv-semicolon-ragged', 'csv-consistent', 'a long row in a semicolon-separated file', '2;b;5;9;9'), ''],
    'notebooks/secret.ipynb': [JSON.stringify({ cells: [{ cell_type: 'code', execution_count: 1, metadata: {}, source: ['import os'], outputs: [{ output_type: 'stream', name: 'stdout', text: ['ok\n'] }] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 1).replace('"ok\\n"', `"token=${npmTok}\\n"`)],
    'notebooks/pip.ipynb': [JSON.stringify({ cells: [{ cell_type: 'code', execution_count: null, metadata: {}, source: ['%pip install pandas'], outputs: [] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 1)],
    'notebooks/paths.ipynb': [JSON.stringify({ cells: [{ cell_type: 'code', execution_count: null, metadata: {}, source: ['df = read("C:\\\\Users\\\\dana\\\\data.csv")'], outputs: [] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 1)],
    'notebooks/outputs.ipynb': [JSON.stringify({ cells: [{ cell_type: 'code', execution_count: 7, metadata: {}, source: ['print(1)'], outputs: [{ output_type: 'stream', name: 'stdout', text: ['1\n'] }] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 1)],
    'ml/split.py': ['import random', 'from sklearn.linear_model import LogisticRegression', '', X('ml-no-seed-shuffle', 'random-seed-missing', 'a shuffle and model fit with no seed', 'random.shuffle(rows)'), 'model = LogisticRegression()', 'model.fit(rows, labels)', ''],
    'ml/torch_train.py': ['import torch', '', X('ml-no-seed-torch', 'random-seed-missing', 'a torch randperm and training step with no seed', 'order = torch.randperm(100)'), 'loss = model(x)', 'loss.backward()', 'optimizer.step()', ''],
    'ml/tts.py': ['from sklearn.model_selection import train_test_split', 'from sklearn.tree import DecisionTreeClassifier', '', X('ml-no-seed-split', 'random-seed-missing', 'train_test_split with no random_state', 'X_train, X_test, y_train, y_test = train_test_split(X, y)'), 'clf = DecisionTreeClassifier().fit(X_train, y_train)', ''],
  }
  expect['xi-notebook-secret'] = 'notebook-secrets'
  expect['xi-notebook-pip'] = 'notebook-pip-magics'
  expect['xi-notebook-paths'] = 'notebook-absolute-paths'
  expect['xi-notebook-outputs'] = 'notebook-outputs-stripped'
  // notebooks are whole-file defects: planted as absences pointing at the file
  const nbAbsent = [
    A('notebook-secret', 'notebook-secrets', 'a token printed in a notebook output', 'notebooks/secret.ipynb'),
    A('notebook-pip', 'notebook-pip-magics', 'a %pip magic in a notebook', 'notebooks/pip.ipynb'),
    A('notebook-paths', 'notebook-absolute-paths', 'an absolute Windows path in a notebook', 'notebooks/paths.ipynb'),
    A('notebook-outputs', 'notebook-outputs-stripped', 'a notebook committed with outputs and execution counts', 'notebooks/outputs.ipynb'),
  ]

  // ---------------------------------------------------------------- content, docs, repo hygiene
  const docs = {
    'docs/fence.md': ['# Fence', '', X('md-tilde-fence-unclosed', 'markdown-code-fences', 'a tilde code fence that is never closed', '~~~sh\nnpm install'), ''],
    'docs/heading.md': ['# Title', '', '## Section', '', X('md-heading-skip-h4', 'markdown-headings', 'a jump from level 2 to level 4', '#### Deep'), ''],
    'docs/anchor.md': ['# Title', '', '## Setup', '', X('md-anchor-case', 'markdown-anchors', 'a link to an anchor with the wrong spelling', 'See [the setup](#set-up) first.'), ''],
    'docs/anchor2.md': ['# Title', '', '## Usage', '', X('md-anchor-missing-ref', 'markdown-anchors', 'a link to a heading that was renamed', 'Jump to [install](#installation-steps).'), ''],
    'docs/typo.md': ['# Typos', '', X('md-typo-definately', 'spell-common-typos', 'common misspellings', 'This is definately wrong and it occured twice.'), ''],
    'docs/typo2.txt': [X('txt-typo-teh', 'spell-common-typos', 'a misspelling in a text file', 'Make sure teh config is adress-able and succesful.'), ''],
    'docs/zero-width.md': ['# Zero width', '', X('md-zero-width', 'unicode-control-chars', 'a zero width space hidden in a Markdown file', 'Run the comm\u200Band now.'), ''],
    'src/rlo.py': ['access = "user"', X('py-rlo', 'unicode-control-chars', 'a right-to-left override in a Python string', 'role = "admin\u202E"'), ''],
    'CHANGES/CHANGELOG.md': ['# Changelog', '', X('changelog-no-date', 'changelog-format', 'a version heading with no date', '## 1.2.0\n- fixed some things'), ''],
    'docs/conflict.md': ['# Conflict', '<<<<<<< HEAD', X('md-conflict-marker', 'conflict-markers', 'a conflict marker in a Markdown file', 'text a'), '=======', 'text b', '>>>>>>> topic', ''],
    'src/conflict.py': ['x = 1', '<<<<<<< ours', X('py-conflict-marker', 'conflict-markers', 'a conflict marker in a Python file', 'y = 2'), '=======', 'y = 3', '>>>>>>> theirs', ''],
    'build/Makefile.mk': ['all:', X('mk-spaces', 'makefile-tabs', 'a recipe indented with spaces in a second Makefile', '        echo hi'), ''],
    'build/GNUmakefile': ['all:', X('gnumakefile-spaces', 'makefile-tabs', 'a recipe indented with spaces in a GNUmakefile', '    echo hi'), ''],
    'src/trail.py': [X('trailing-ws-tab', 'trailing-whitespace', 'trailing tab characters', 'x = 1\t\t'), ''],
    'src/trail2.js': ['const a = 1;', X('trailing-ws-crlf-spaces', 'trailing-whitespace', 'trailing spaces before a line break in a JS file', 'const b = 2;      '), ''],
  }

  return {
    projects: {
      'x-docker': { files: { ...tidy('x-docker'), ...dockerfiles } },
      'x-k8s': { files: { ...tidy('x-k8s'), ...k8s } },
      'x-terraform': { files: { ...tidy('x-terraform'), ...tf } },
      'x-compose': { files: { ...tidy('x-compose'), ...compose } },
      'x-ci': { files: { ...tidy('x-ci'), ...gha, ...ci } },
      'x-web': { files: { ...tidy('x-web'), ...web, ...html, ...pub } },
      'x-packages': { files: { ...tidy('x-packages'), ...pkgFiles } },
      'x-config': { files: { ...tidy('x-config'), ...config, ...docs }, absent: nbAbsent },
    },
    expect,
  }
}
