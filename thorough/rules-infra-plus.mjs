// Rule tables for the infra-plus checks: Dockerfiles, Kubernetes manifests, Terraform and Compose files, and GitHub Actions workflows.
// Each table is data for thorough/rules.mjs (the engine). Every rule carries a bad and a good sample, which selfProve() checks.
// The context helpers read neighbouring lines: a tolerant, line-based reading, not a parser. Regexes use bounded repeats only (linear time).
// Used by thorough/infra-plus.mjs. Accept a finding in .meerkat-infraplus-allow as "<rule-id> <path>".

export const DOCKER_FILES = /(^|\/)(Dockerfile|Containerfile)(\.[^/]*)?$|(^|\/)[^/]+\.(dockerfile|containerfile)$/i
export const YAML_FILES = /\.ya?ml$/i
export const TF_FILES = /\.tf$/i
export const COMPOSE_FILES = /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i
export const GHA_FILES = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i

const COMMENT = /^\s*#/
const TF_COMMENT = /^\s*(#|\/\/)/

// ---- context helpers (ctx = { file, lines, index, text } from the engine)
const indentOf = (s) => s.length - s.trimStart().length
const blank = (s) => s.trim() === ''
const isComment = (s) => COMMENT.test(s)

// Index of the first line of code (not blank, not a comment).
function firstCode(lines) {
  for (let i = 0; i < lines.length; i++) if (!blank(lines[i]) && !isComment(lines[i])) return i
  return -1
}

// A whole-file condition: evaluated once per file and reported on the first line of code.
let onceText = null
let onceFirst = -1
let onceMemo = new Map()
const once = (ctx, key, cond) => {
  if (ctx.text !== onceText) {
    onceText = ctx.text
    onceFirst = firstCode(ctx.lines)
    onceMemo = new Map()
  }
  if (ctx.index !== onceFirst) return false
  if (!onceMemo.has(key)) onceMemo.set(key, cond(ctx.text))
  return onceMemo.get(key)
}

// The keys of the less-indented lines above this one, nearest first (the parent, the grandparent, and so on).
// A "- item" line at the same indent as its key counts that key as its parent.
function ancestors(ctx, max = 3) {
  const out = []
  const ls = ctx.lines
  const self = ls[ctx.index]
  const item = /^\s*-\s/.test(self)
  let cur = indentOf(self)
  for (let j = ctx.index - 1; j >= 0 && j >= ctx.index - 200 && out.length < max; j--) {
    const l = ls[j]
    if (blank(l) || isComment(l)) continue
    const ind = indentOf(l)
    const listLine = /^\s*-\s/.test(l)
    if (ind < cur || (item && ind === cur && !listLine)) {
      const m = /^\s*(?:-\s+)?([A-Za-z0-9_.\/-]+):/.exec(l)
      out.push(m ? m[1] : '')
      cur = ind
    }
  }
  return out
}
const parentOf = (ctx) => ancestors(ctx, 1)[0]

// True when a line within n lines either side of this one matches re.
const windowHas = (ctx, re, n) => {
  for (let j = Math.max(0, ctx.index - n); j <= Math.min(ctx.lines.length - 1, ctx.index + n); j++) if (re.test(ctx.lines[j])) return true
  return false
}
// True when one of the n lines above this one matches re.
const backHas = (ctx, re, n) => {
  for (let j = Math.max(0, ctx.index - n); j < ctx.index; j++) if (re.test(ctx.lines[j])) return true
  return false
}

// The text of the YAML document (between --- lines) that holds this line.
// Each document keeps a memo of its regex results, so a file with thousands of matching lines is not re-scanned per line.
let docsSrc = null
let docsList = []
let lineDoc = []
const docs = (text) => {
  if (text !== docsSrc) {
    docsSrc = text
    docsList = []
    const ls = text.split(/\r?\n/)
    lineDoc = new Array(ls.length)
    let start = 0
    const close = (end) => {
      const d = { start, end, text: ls.slice(start, end + 1).join('\n'), memo: new Map() }
      docsList.push(d)
      for (let i = start; i <= end; i++) lineDoc[i] = d
    }
    for (let i = 0; i < ls.length; i++) {
      if (/^---(\s|$)/.test(ls[i])) {
        close(i - 1)
        start = i + 1
      }
    }
    close(ls.length - 1)
  }
  return docsList
}
const docObj = (ctx) => {
  docs(ctx.text)
  return lineDoc[ctx.index] ?? { text: ctx.text, memo: new Map() }
}
// The text of the document (the whole file when it has no --- lines).
const docAt = (ctx) => docObj(ctx).text
// Memoised: true when the document text matches re (the result is kept on the document).
const docHas = (ctx, re) => {
  const d = docObj(ctx)
  const key = `re:${re.source}`
  if (!d.memo.has(key)) d.memo.set(key, re.test(d.text))
  return d.memo.get(key)
}
const isWorkload = (t) => /^kind:\s*["']?(Deployment|StatefulSet|DaemonSet|ReplicaSet|Job|CronJob|Pod|ReplicationController)\b/m.test(t)
const docIsWorkload = (ctx) => {
  const d = docObj(ctx)
  if (!d.memo.has('workload')) d.memo.set('workload', isWorkload(d.text))
  return d.memo.get('workload')
}

// Neighbour scans are bounded (a few hundred lines), so a hostile file cannot make them quadratic.
const SPAN = 400

// The text of the block a line sits in: its parent key and everything more indented than that key.
function parentBlock(ctx) {
  const ls = ctx.lines
  const cur = indentOf(ls[ctx.index])
  let p = -1
  for (let j = ctx.index - 1; j >= 0 && j >= ctx.index - SPAN; j--) {
    if (blank(ls[j]) || isComment(ls[j])) continue
    if (indentOf(ls[j]) < cur) {
      p = j
      break
    }
  }
  if (p < 0) return ''
  const base = indentOf(ls[p])
  const out = []
  for (let j = p; j < ls.length && j <= p + SPAN; j++) {
    if (j > p && !blank(ls[j]) && indentOf(ls[j]) <= base) break
    out.push(ls[j])
  }
  return out.join('\n')
}

// The text nested under this line (the lines more indented than it).
function childBlock(ctx) {
  const ls = ctx.lines
  const cur = indentOf(ls[ctx.index])
  const out = []
  for (let j = ctx.index + 1; j < ls.length && j <= ctx.index + SPAN; j++) {
    if (blank(ls[j])) continue
    if (indentOf(ls[j]) <= cur) break
    out.push(ls[j])
  }
  return out.join('\n')
}

// Whether a Dockerfile instruction matching re appears earlier in the same build stage (within SPAN lines).
const earlierInStage = (ctx, re) => {
  let from = -1
  for (let j = ctx.index - 1; j >= 0 && j >= ctx.index - SPAN; j--) {
    if (/^\s*FROM\s/i.test(ctx.lines[j])) {
      from = j
      break
    }
  }
  for (let j = Math.max(from + 1, ctx.index - SPAN); j < ctx.index; j++) if (re.test(ctx.lines[j])) return true
  return false
}

const R = (id, title, re, bad, good, extra = {}) => ({ id, title, re, bad, good, ...extra })
const T = (id, title, test, bad, good, extra = {}) => ({ id, title, test, bad, good, ...extra })
const withScope = (files, skip, rules) => rules.map((r) => ({ files, skipLine: skip, ...r }))

// =====================================================================================================================
// Dockerfiles (ip-docker)
// =====================================================================================================================
const DOCKER_RULES = withScope(DOCKER_FILES, COMMENT, [
  T('docker-no-healthcheck', 'no HEALTHCHECK instruction, so the runtime cannot tell whether the app is working', (l, c) => once(c, 'hc', (t) => /^\s*FROM\s/im.test(t) && !/^\s*HEALTHCHECK\s/im.test(t)), 'FROM alpine:3.20\nRUN echo hi\n', 'FROM alpine:3.20\nHEALTHCHECK CMD true\n'),
  R('docker-healthcheck-none', 'HEALTHCHECK NONE switches the health check off', /^\s*HEALTHCHECK\s+NONE\b/i, 'HEALTHCHECK NONE', 'HEALTHCHECK CMD curl -f http://localhost/'),
  R('docker-apt-update-alone', 'apt-get update sits in its own RUN layer, so a later install can use a stale index', /^\s*RUN\s+apt-get\s+update\s*(#.*)?$/i, 'RUN apt-get update', 'RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*'),
  T('docker-apt-install-no-yes', 'apt-get install has no -y, so the build can stop waiting for input', (l) => /\bapt(-get)?\s+install\b/.test(l) && !/\s-[a-zA-Z]*y|--yes\b|--assume-yes/.test(l), 'RUN apt-get install curl', 'RUN apt-get install -y curl'),
  T('docker-apt-recommends', 'apt-get install pulls recommended packages (add --no-install-recommends)', (l) => /\bapt(-get)?\s+install\b/.test(l) && !/--no-install-recommends/.test(l), 'RUN apt-get install -y curl', 'RUN apt-get install -y --no-install-recommends curl'),
  T('docker-apt-cache-left', 'apt package lists are left in the image (remove /var/lib/apt/lists in the same layer)', (l, c) => /\bapt(-get)?\s+install\b/.test(l) && !/\/var\/lib\/apt\/lists/.test(c.text), 'RUN apt-get install -y curl', 'RUN apt-get install -y curl && rm -rf /var/lib/apt/lists/*'),
  R('docker-apt-upgrade', 'apt-get upgrade in an image makes the build depend on whatever is newest that day', /\bapt(-get)?\s+(dist-)?upgrade\b/, 'RUN apt-get upgrade -y', 'RUN apt-get install -y curl'),
  R('docker-apt-unauthenticated', 'a package install skips signature checks (--allow-unauthenticated or --force-yes)', /--allow-unauthenticated|--force-yes|AllowUnauthenticated/, 'RUN apt-get install --allow-unauthenticated x', 'RUN apt-get install -y x'),
  T('docker-apk-no-cache', 'apk add keeps its index in the image (add --no-cache)', (l) => /\bapk\s+add\b/.test(l) && !/--no-cache/.test(l), 'RUN apk add curl', 'RUN apk add --no-cache curl'),
  T('docker-yum-no-yes', 'yum or dnf install has no -y, so the build can stop waiting for input', (l) => /\b(yum|dnf)\s+install\b/.test(l) && !/\s-y\b|--assumeyes/.test(l), 'RUN dnf install curl', 'RUN dnf install -y curl'),
  T('docker-pip-no-cache', 'pip install keeps its download cache in the image (add --no-cache-dir)', (l) => /\bpip3?\s+install\b/.test(l) && !/--no-cache-dir|PIP_NO_CACHE_DIR/.test(l), 'RUN pip install flask', 'RUN pip install --no-cache-dir flask==3.0.3'),
  T('docker-pip-unpinned', 'a pip package is installed without a version pin', (l) => /\bpip3?\s+install\b/.test(l) && !/==|\s-r\s|--requirement|\s-c\s|--constraint|\s-e\s/.test(l) && !/\bpip3?\s+install\s+(--\S+\s+)*pip\s*$/.test(l), 'RUN pip install flask', 'RUN pip install --no-cache-dir flask==3.0.3'),
  T('docker-pip-untrusted-host', 'pip install trusts an unverified host or fetches the index over plain http', (l) => /\bpip3?\s+install\b/.test(l) && /--trusted-host|--index-url\s+http:\/\/|-i\s+http:\/\//.test(l), 'RUN pip install --trusted-host pypi.example x', 'RUN pip install --no-cache-dir x==1.0'),
  T('docker-npm-dev-dependencies', 'npm install in the image also installs dev dependencies (add --omit=dev)', (l) => /\bnpm\s+(install|i)(\s|$)/.test(l) && !/--omit=dev|--production|--only=prod|\s-g\b/.test(l), 'RUN npm install', 'RUN npm install --omit=dev'),
  T('docker-npm-global-unpinned', 'a global npm package is installed without a version', (l) => /\bnpm\s+(install|i)\s+(-g|--global)\s+/.test(l) && !/@\d/.test(l), 'RUN npm install -g typescript', 'RUN npm install -g typescript@5.4.5'),
  R('docker-curl-pipe-shell', 'a download is piped straight into a shell, so nothing is checked before it runs', /\b(curl|wget)\b[^|\n]{0,300}\|\s*(sudo\s+)?(ba|z)?sh\b/, 'RUN curl -fsSL https://example.com/install.sh | sh', 'RUN curl -fsSL -o install.sh https://example.com/install.sh && sha256sum -c install.sh.sha256'),
  T('docker-download-no-checksum', 'a download is fetched with no checksum check in the file', (l, c) => /\b(curl|wget)\s/.test(l) && /https?:\/\//.test(l) && !/localhost|127\.0\.0\.1/.test(l) && !/sha256sum|sha512sum|shasum|sha256/.test(c.text), 'RUN curl -fsSL -o /tmp/x.tgz https://example.com/x.tgz', 'RUN curl -fsSL -o /tmp/x.tgz https://example.com/x.tgz && echo "abc  /tmp/x.tgz" | sha256sum -c -'),
  R('docker-download-http', 'a download in RUN uses plain http', /^\s*RUN\b.{0,300}\b(curl|wget)\b.{0,300}\bhttp:\/\//i, 'RUN wget http://example.com/x', 'RUN wget https://example.com/x'),
  R('docker-add-from-url', 'ADD fetches a URL at build time, with no checksum and a cache that cannot be reasoned about', /^\s*ADD\s+(--\S+\s+)*https?:\/\//i, 'ADD https://example.com/app.tgz /opt/', 'COPY app.tgz /opt/'),
  R('docker-add-local', 'ADD copies a local file that COPY would copy (ADD unpacks archives and fetches URLs)', /^\s*ADD\s+(?!--)(?!https?:)(?![^\s]*\.(tar|tgz|tar\.gz|tar\.bz2|tar\.xz|txz|zip)\b)\S+\s+\S+/i, 'ADD app.js /opt/app.js', 'COPY app.js /opt/app.js'),
  R('docker-sudo', 'sudo is used in a RUN step, which is not needed inside a build', /^\s*RUN\b.*\bsudo\b/i, 'RUN sudo make install', 'RUN make install'),
  R('docker-expose-ssh', 'port 22 is exposed, which suggests an SSH server inside the container', /^\s*EXPOSE\b.*\b22\b/i, 'EXPOSE 22', 'EXPOSE 8080'),
  R('docker-cd-in-run', 'RUN uses cd, which does not persist to the next step (use WORKDIR)', /^\s*RUN\s+.*\bcd\s+\S/i, 'RUN cd /app && make', 'WORKDIR /app'),
  R('docker-relative-workdir', 'WORKDIR is relative, so its place depends on the step before it', /^\s*WORKDIR\s+(?![/$"'])\S/i, 'WORKDIR app', 'WORKDIR /app'),
  T('docker-multiple-entrypoint', 'a second ENTRYPOINT in the same stage replaces the first one silently', (l, c) => /^\s*ENTRYPOINT\s/i.test(l) && earlierInStage(c, /^\s*ENTRYPOINT\s/i), 'FROM alpine\nENTRYPOINT ["a"]\nENTRYPOINT ["b"]\n', 'FROM alpine\nENTRYPOINT ["a"]\n'),
  T('docker-multiple-cmd', 'a second CMD in the same stage replaces the first one silently', (l, c) => /^\s*CMD\s/i.test(l) && earlierInStage(c, /^\s*CMD\s/i), 'FROM alpine\nCMD ["a"]\nCMD ["b"]\n', 'FROM alpine\nCMD ["a"]\n'),
  T('docker-copy-all-before-deps', 'COPY of the whole folder comes before the dependency install, so every code change reinstalls', (l, c) => /^\s*COPY\s+(--\S+\s+)*\.\s/i.test(l) && c.lines.slice(c.index + 1, c.index + 1 + SPAN).some((x) => /\b(npm|pnpm|yarn)\s+(install|i|ci)\b|\bpip3?\s+install\b|\bgo\s+mod\s+download\b|\bbundle\s+install\b|\bcargo\s+(build|fetch)\b/.test(x)), 'FROM node\nCOPY . /app\nRUN npm install\n', 'FROM node\nCOPY package.json /app/\nRUN npm install\nCOPY . /app\n'),
  R('docker-maintainer-deprecated', 'MAINTAINER is deprecated (use a LABEL)', /^\s*MAINTAINER\b/i, 'MAINTAINER me@example.com', 'LABEL maintainer="me@example.com"'),
  R('docker-onbuild', 'ONBUILD sets a trigger for whoever builds on top of this image', /^\s*ONBUILD\b/i, 'ONBUILD COPY . /app', 'COPY . /app'),
  R('docker-volume-sensitive', 'a VOLUME exposes a sensitive path (root home, SSH or cloud keys, the Docker socket, /etc)', /^\s*VOLUME\s+.*(\/etc\b|\/root\b|\.ssh\b|\.aws\b|\/var\/run\/docker\.sock|\/home\/)/i, 'VOLUME /root/.ssh', 'VOLUME /data'),
  T('docker-secret-in-env', 'a secret-looking ARG or ENV holds a value in the image history', (l) => /^\s*(ARG|ENV)\s+[A-Za-z_]*(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z_]*\s*=\s*[^\s$]/i.test(l) && !/_FILE\s*=/.test(l), 'ENV DB_PASSWORD=hunter2', 'ENV DB_PASSWORD_FILE=/run/secrets/db'),
  R('docker-zero-width', 'a zero-width character is hidden in the file (it changes what the line does)', /[\u200B-\u200D\u2060\uFEFF]/, 'RUN echo\u200Bhi', 'RUN echo hi'),
  T('docker-user-root-last', 'the last USER instruction is root, so the container runs as root', (l, c) => /^\s*USER\s+(root|0)\s*$/i.test(l) && !c.lines.slice(c.index + 1).some((x) => /^\s*USER\s/i.test(x)), 'USER root', 'USER app'),
  T('docker-no-user', 'no USER instruction, so the container runs as root (CIS-DI-0001)', (l, c) => once(c, 'nouser', (t) => { if (!/^\s*FROM\s/im.test(t)) return false; const u = [...t.matchAll(/^\s*USER\s+(\S+)/gim)]; return u.length === 0 || /^(?:root|0)(?::|$)/i.test(u[u.length - 1][1]) }), 'FROM alpine:3.20\nRUN true\n', 'FROM alpine:3.20\nUSER app\n'),
  R('docker-chmod-world-writable', 'chmod makes a path writable by everyone (777)', /^\s*RUN\b.{0,300}\bchmod\b.{0,300}(\b0?777\b|a\+rwx|o\+w\b)/i, 'RUN chmod 777 /app', 'RUN chmod 755 /app'),
  R('docker-setuid-bit', 'chmod sets the setuid or setgid bit (CIS-DI-0008)', /^\s*RUN\b.{0,300}\bchmod\b.{0,300}(\+s\b|\b[2467][0-7]{3}\b)/i, 'RUN chmod u+s /usr/bin/x', 'RUN chmod 755 /app'),
])

// Folder-level rule (checked by the runner, not the engine): a Dockerfile needs a .dockerignore beside it.
const DOCKER_EXTRA = 1

// =====================================================================================================================
// Kubernetes manifests (ip-k8s)
// =====================================================================================================================
const K8S_CONTENT = (t) => /^apiVersion:/m.test(t) && /^kind:/m.test(t)
const CONTAINERS = /^\s*(init)?containers:\s*(#.*)?$/
const POD = 'kind: Deployment\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          image: app:1.4.0\n'
const POD_OK = `${POD}          securityContext:\n            allowPrivilegeEscalation: false\n            readOnlyRootFilesystem: true\n            runAsNonRoot: true\n            seccompProfile:\n              type: RuntimeDefault\n          resources:\n            requests:\n              cpu: 10m\n            limits:\n              memory: 128Mi\n          livenessProbe:\n            httpGet:\n              path: /\n              port: 80\n          readinessProbe:\n            httpGet:\n              path: /\n              port: 80\n      serviceAccountName: app\n`
const WORKLOAD_CONTAINER = (id, title, missing, extraBad = '') => T(id, title, (l, c) => CONTAINERS.test(l) && docIsWorkload(c) && !docHas(c, missing), POD + extraBad, POD_OK)

const K8S_RULES = withScope(YAML_FILES, COMMENT, [
  R('k8s-privileged', 'a container runs privileged, with all host devices and most kernel rights', /^\s*privileged:\s*true\b/, 'privileged: true', 'privileged: false'),
  R('k8s-priv-escalation-true', 'a container allows privilege escalation (allowPrivilegeEscalation true)', /^\s*allowPrivilegeEscalation:\s*true\b/, 'allowPrivilegeEscalation: true', 'allowPrivilegeEscalation: false'),
  WORKLOAD_CONTAINER('k8s-priv-escalation-unset', 'allowPrivilegeEscalation is not set to false, so it defaults to allowed', /allowPrivilegeEscalation:\s*false\b/),
  WORKLOAD_CONTAINER('k8s-readonly-rootfs', 'the root filesystem is writable (set readOnlyRootFilesystem to true)', /readOnlyRootFilesystem:\s*true\b/),
  WORKLOAD_CONTAINER('k8s-run-as-non-root-absent', 'runAsNonRoot is not set to true, so the container may run as root', /runAsNonRoot:\s*true\b/),
  R('k8s-run-as-user-zero', 'a container runs as user 0 (root)', /^\s*runAsUser:\s*0\s*(#.*)?$/, 'runAsUser: 0', 'runAsUser: 10001'),
  R('k8s-run-as-non-root-false', 'runAsNonRoot is set to false', /^\s*runAsNonRoot:\s*false\b/, 'runAsNonRoot: false', 'runAsNonRoot: true'),
  T('k8s-cap-add-dangerous', 'a dangerous Linux capability is added (SYS_ADMIN, NET_ADMIN, SYS_PTRACE and similar)', (l, c) => /^\s*-\s*["']?(SYS_ADMIN|NET_ADMIN|SYS_PTRACE|SYS_MODULE|SYS_RAWIO|NET_RAW)["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'add', 'capabilities:\n  add:\n    - SYS_ADMIN\n', 'capabilities:\n  drop:\n    - ALL\n'),
  T('k8s-cap-add-all', 'every Linux capability is added back (add ALL)', (l, c) => /^\s*-\s*["']?ALL["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'add', 'capabilities:\n  add:\n    - ALL\n', 'capabilities:\n  drop:\n    - ALL\n'),
  T('k8s-cap-drop-all-missing', 'capabilities are not dropped (drop ALL is the safe start)', (l, c) => /^\s*capabilities:\s*$/.test(l) && docIsWorkload(c) && !docHas(c, /drop:\s*(\[\s*)?(-\s*)?["']?ALL\b/), 'kind: Pod\nspec:\n  containers:\n    - name: a\n      securityContext:\n        capabilities:\n          add: [NET_BIND_SERVICE]\n', 'kind: Pod\nspec:\n  containers:\n    - name: a\n      securityContext:\n        capabilities:\n          drop: [ALL]\n'),
  T('k8s-host-path-docker-socket', 'a hostPath mounts the Docker socket, which gives full control of the host', (l, c) => /^\s*path:\s*["']?\/var\/run\/docker\.sock\b/.test(l) && parentOf(c) === 'hostPath', 'volumes:\n  - name: sock\n    hostPath:\n      path: /var/run/docker.sock\n', 'volumes:\n  - name: data\n    hostPath:\n      path: /var/lib/app\n'),
  T('k8s-host-path-root', 'a hostPath mounts the whole host root filesystem', (l, c) => /^\s*path:\s*["']?\/["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'hostPath', 'volumes:\n  - name: root\n    hostPath:\n      path: /\n', 'volumes:\n  - name: data\n    hostPath:\n      path: /data\n'),
  T('k8s-host-path-system', 'a hostPath mounts a system folder of the host (/etc, /root, /proc, /sys, kubelet state)', (l, c) => /^\s*path:\s*["']?\/(etc|root|proc|sys|boot|dev|var\/lib\/kubelet)(\/|["']?\s*(#.*)?$)/.test(l) && parentOf(c) === 'hostPath', 'volumes:\n  - name: etc\n    hostPath:\n      path: /etc\n', 'volumes:\n  - name: data\n    hostPath:\n      path: /var/data\n'),
  R('k8s-host-path-any', 'a hostPath volume mounts a folder of the node (review that it is needed)', /^\s*hostPath:\s*(#.*)?$/, 'hostPath:', 'emptyDir: {}'),
  R('k8s-host-network', 'the pod shares the host network namespace', /^\s*hostNetwork:\s*true\b/, 'hostNetwork: true', 'hostNetwork: false'),
  R('k8s-host-pid', 'the pod shares the host process namespace', /^\s*hostPID:\s*true\b/, 'hostPID: true', 'hostPID: false'),
  R('k8s-host-ipc', 'the pod shares the host IPC namespace', /^\s*hostIPC:\s*true\b/, 'hostIPC: true', 'hostIPC: false'),
  R('k8s-host-port', 'a container binds a port on the node (hostPort)', /^\s*hostPort:\s*\d+/, 'hostPort: 8080', 'containerPort: 8080'),
  WORKLOAD_CONTAINER('k8s-resource-limits-absent', 'no resource limits are set, so one pod can use a whole node', /\blimits:/),
  WORKLOAD_CONTAINER('k8s-resource-requests-absent', 'no resource requests are set, so the scheduler cannot place the pod safely', /\brequests:/),
  WORKLOAD_CONTAINER('k8s-liveness-absent', 'no liveness probe, so a hung container is never restarted', /livenessProbe:/),
  WORKLOAD_CONTAINER('k8s-readiness-absent', 'no readiness probe, so traffic can reach a container that is not ready', /readinessProbe:/),
  WORKLOAD_CONTAINER('k8s-default-service-account', 'no serviceAccountName, so the pod uses the namespace default account', /serviceAccountName:/),
  R('k8s-automount-token-true', 'the API token of the service account is mounted into the pod', /^\s*automountServiceAccountToken:\s*true\b/, 'automountServiceAccountToken: true', 'automountServiceAccountToken: false'),
  T('k8s-cluster-admin-binding', 'a binding grants cluster-admin, the all-powerful role', (l, c) => /^\s*name:\s*["']?cluster-admin["']?\s*(#.*)?$/.test(l) && /^kind:\s*(Cluster)?RoleBinding\b/m.test(docAt(c)), 'kind: ClusterRoleBinding\nroleRef:\n  kind: ClusterRole\n  name: cluster-admin\n', 'kind: RoleBinding\nroleRef:\n  kind: Role\n  name: reader\n'),
  T('k8s-wildcard-verb', 'a role allows every verb (verbs: "*")', (l, c) => /^\s*-\s*["']?\*["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'verbs', 'rules:\n  - apiGroups: [""]\n    resources: ["pods"]\n    verbs:\n      - "*"\n', 'rules:\n  - apiGroups: [""]\n    resources: ["pods"]\n    verbs:\n      - get\n'),
  T('k8s-wildcard-resource', 'a role covers every resource (resources: "*")', (l, c) => /^\s*-\s*["']?\*["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'resources', 'rules:\n  - resources:\n      - "*"\n', 'rules:\n  - resources:\n      - pods\n'),
  T('k8s-wildcard-api-group', 'a role covers every API group (apiGroups: "*")', (l, c) => /^\s*-\s*["']?\*["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'apiGroups', 'rules:\n  - apiGroups:\n      - "*"\n', 'rules:\n  - apiGroups:\n      - ""\n'),
  T('k8s-pods-exec', 'a role grants pods/exec, pods/attach or pods/portforward (a shell in any pod)', (l, c) => /^\s*-\s*["']?pods\/(exec|attach|portforward)["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'resources', 'rules:\n  - resources:\n      - pods/exec\n', 'rules:\n  - resources:\n      - pods\n'),
  T('k8s-secrets-readable-role', 'a role can read secrets (get, list or watch on secrets)', (l, c) => /^\s*-\s*["']?secrets["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'resources' && /^kind:\s*(Cluster)?Role\b/m.test(docAt(c)) && /verbs:[\s\S]{0,200}?["']?(get|list|watch|\*)["']?/.test(docAt(c)), 'kind: Role\nrules:\n  - resources:\n      - secrets\n    verbs:\n      - get\n', 'kind: Role\nrules:\n  - resources:\n      - configmaps\n    verbs:\n      - get\n'),
  T('k8s-ingress-no-tls', 'an Ingress has no tls section, so traffic is not encrypted', (l, c) => /^kind:\s*Ingress\b/.test(l) && !/^\s*tls:/m.test(docAt(c)), 'apiVersion: networking.k8s.io/v1\nkind: Ingress\nspec:\n  rules: []\n', 'apiVersion: networking.k8s.io/v1\nkind: Ingress\nspec:\n  tls:\n    - hosts: [shop.example.com]\n'),
  T('k8s-configmap-secret-key', 'a ConfigMap holds a key named like a secret (put secrets in a Secret)', (l, c) => /^\s+[\w.-]*(password|passwd|secret|token|api[_-]?key|private[_-]?key)[\w.-]*\s*:\s*\S/i.test(l) && /^kind:\s*ConfigMap\b/m.test(docAt(c)), 'kind: ConfigMap\ndata:\n  db_password: hunter2\n', 'kind: ConfigMap\ndata:\n  log_level: info\n'),
  T('k8s-secret-literal-env', 'an env variable with a secret-looking name holds a literal value', (l, c) => /^\s*(-\s+)?value:\s*\S/.test(l) && backHas(c, /name:\s*["']?[\w.-]*(password|passwd|secret|token|api_?key|private_?key)/i, 2) && !/\$\{/.test(l), 'env:\n  - name: DB_PASSWORD\n    value: hunter2\n', 'env:\n  - name: DB_PASSWORD\n    valueFrom:\n      secretKeyRef:\n        name: db\n        key: pw\n'),
  T('k8s-secret-manifest-stringdata', 'a Secret manifest holds its values in the file (stringData)', (l, c) => /^\s*stringData:\s*(#.*)?$/.test(l) && /^kind:\s*Secret\b/m.test(docAt(c)), 'kind: Secret\nstringData:\n  token: abc\n', 'kind: Secret\ntype: Opaque\n'),
  R('k8s-image-latest', 'an image uses the latest tag, which changes under you', /^\s*-?\s*image:\s*["']?[^\s"'@]+:latest\b["']?\s*(#.*)?$/, 'image: nginx:latest', 'image: nginx:1.27.0'),
  R('k8s-image-untagged', 'an image has no tag, so it means latest', /^\s*-?\s*image:\s*["']?[^\s"'@:$]+["']?\s*(#.*)?$/, 'image: nginx', 'image: nginx:1.27.0'),
  R('k8s-image-pull-never', 'imagePullPolicy is Never, so the node must already hold the image', /^\s*imagePullPolicy:\s*Never\b/, 'imagePullPolicy: Never', 'imagePullPolicy: IfNotPresent'),
  WORKLOAD_CONTAINER('k8s-seccomp-missing', 'no seccompProfile, so the container gets an unfiltered set of system calls', /seccompProfile:/),
  R('k8s-seccomp-unconfined', 'a seccomp profile is Unconfined (no system call filter)', /^\s*type:\s*Unconfined\b/, 'type: Unconfined', 'type: RuntimeDefault'),
  R('k8s-apparmor-unconfined', 'an AppArmor profile is set to unconfined', /apparmor[^\n]*:\s*["']?unconfined/i, 'container.apparmor.security.beta.kubernetes.io/app: unconfined', 'container.apparmor.security.beta.kubernetes.io/app: runtime/default'),
  R('k8s-service-exposed', 'a Service is NodePort or LoadBalancer, reachable beyond the cluster (review it)', /^\s*type:\s*(NodePort|LoadBalancer)\b/, 'type: NodePort', 'type: ClusterIP'),
  R('k8s-default-namespace', 'an object is placed in the default namespace', /^\s*namespace:\s*["']?default["']?\s*(#.*)?$/, 'namespace: default', 'namespace: shop'),
  R('k8s-deprecated-api', 'an API version is deprecated or removed in current Kubernetes', /^apiVersion:\s*["']?(extensions\/v1beta1|apps\/v1beta[12]|policy\/v1beta1|networking\.k8s\.io\/v1beta1|batch\/v1beta1|autoscaling\/v2beta[12]|rbac\.authorization\.k8s\.io\/v1beta1|apiextensions\.k8s\.io\/v1beta1)\b/, 'apiVersion: extensions/v1beta1', 'apiVersion: apps/v1'),
  R('k8s-psp-kind', 'a PodSecurityPolicy is declared, a kind that has been removed from Kubernetes', /^kind:\s*PodSecurityPolicy\b/, 'kind: PodSecurityPolicy', 'kind: Namespace'),
  T('k8s-emptydir-memory-no-limit', 'a memory-backed emptyDir has no sizeLimit, so it can use the node memory', (l, c) => /^\s*medium:\s*["']?Memory\b/.test(l) && !docHas(c, /sizeLimit:/), 'volumes:\n  - name: cache\n    emptyDir:\n      medium: Memory\n', 'volumes:\n  - name: cache\n    emptyDir:\n      medium: Memory\n      sizeLimit: 64Mi\n'),
  R('k8s-proc-mount-unmasked', 'procMount is Unmasked, so the container sees the host proc paths', /^\s*procMount:\s*["']?Unmasked\b/, 'procMount: Unmasked', 'procMount: Default'),
  T('k8s-sysctl-set', 'a kernel or net sysctl is set on the pod (unsafe unless the node allows it)', (l, c) => /^\s*-\s*name:\s*["']?(kernel|net)\.[\w.]+/.test(l) && parentOf(c) === 'sysctls', 'sysctls:\n  - name: net.core.somaxconn\n    value: "1024"\n', 'securityContext:\n  runAsNonRoot: true\n'),
  R('k8s-share-process-namespace', 'shareProcessNamespace lets containers in the pod see each other processes', /^\s*shareProcessNamespace:\s*true\b/, 'shareProcessNamespace: true', 'shareProcessNamespace: false'),
  T('k8s-namespace-no-pod-security', 'a Namespace has no Pod Security label, so no pod baseline is enforced', (l, c) => /^kind:\s*Namespace\b/.test(l) && !/pod-security\.kubernetes\.io\/enforce/.test(docAt(c)), 'kind: Namespace\nmetadata:\n  name: shop\n', 'kind: Namespace\nmetadata:\n  name: shop\n  labels:\n    pod-security.kubernetes.io/enforce: restricted\n'),
])

// Folder-level rule (runner): a folder of workloads needs a NetworkPolicy somewhere in it.
const K8S_EXTRA = 1

// =====================================================================================================================
// Terraform (ip-terraform-compose, the Terraform group)
// =====================================================================================================================
const sgSample = (port, cidr) => `resource "aws_security_group_rule" "r" {\n  type = "ingress"\n  from_port = ${port}\n  to_port = ${port}\n  cidr_blocks = ["${cidr}"]\n}\n`
const SG_PORTS = [[22, 'SSH'], [3389, 'RDP'], [3306, 'MySQL'], [5432, 'PostgreSQL'], [6379, 'Redis'], [27017, 'MongoDB']]
const SG_RULES = SG_PORTS.map(([port, name]) => {
  const portRe = new RegExp(`\\b(from|to)_port\\s*=\\s*${port}\\b`)
  return T(`tf-sg-open-${port}`, `a security group opens ${name} (port ${port}) to every address`, (l, c) => /cidr_blocks\s*=\s*\[\s*"0\.0\.0\.0\/0"/.test(l) && windowHas(c, portRe, 8), sgSample(port, '0.0.0.0/0'), sgSample(port, '10.0.0.0/16'))
})

const TF_RULES = withScope(TF_FILES, TF_COMMENT, [
  T('tf-provider-open-version', 'a provider version is only a lower bound (>=), so any future major version can be pulled in', (l) => /\bversion\s*=\s*"\s*>=[^"]*"/.test(l) && !/</.test(l), 'version = ">= 4.0"', 'version = "~> 5.0"'),
  R('tf-provider-wildcard-version', 'a provider version is a wildcard (*)', /\bversion\s*=\s*"\s*\*\s*"/, 'version = "*"', 'version = "5.2.0"'),
  T('tf-no-required-version', 'a terraform block does not set required_version', (l, c) => /^\s*terraform\s*\{/.test(l) && !/required_version\s*=/.test(c.text), 'terraform {\n  required_providers {}\n}\n', 'terraform {\n  required_version = ">= 1.6"\n}\n'),
  R('tf-backend-local', 'the state is kept on local disk (backend "local")', /^\s*backend\s+"local"/, 'backend "local" {}', 'backend "s3" {}'),
  T('tf-backend-s3-unencrypted', 'the S3 state backend does not set encrypt = true', (l, c) => /^\s*backend\s+"s3"/.test(l) && !/encrypt\s*=\s*true/.test(c.text), 'terraform {\n  backend "s3" {\n    bucket = "x"\n  }\n}\n', 'terraform {\n  backend "s3" {\n    encrypt = true\n  }\n}\n'),
  R('tf-s3-public-acl', 'an S3 bucket uses a public canned ACL', /\bacl\s*=\s*"(public-read|public-read-write|authenticated-read)"/, 'acl = "public-read"', 'acl = "private"'),
  T('tf-s3-no-public-access-block', 'an S3 bucket has no public access block in this file', (l, c) => /^\s*resource\s+"aws_s3_bucket"\s/.test(l) && !/aws_s3_bucket_public_access_block/.test(c.text), 'resource "aws_s3_bucket" "b" {\n}\n', 'resource "aws_s3_bucket" "b" {}\nresource "aws_s3_bucket_public_access_block" "b" {}\n'),
  T('tf-s3-no-versioning', 'an S3 bucket has no versioning resource in this file', (l, c) => /^\s*resource\s+"aws_s3_bucket"\s/.test(l) && !/aws_s3_bucket_versioning/.test(c.text), 'resource "aws_s3_bucket" "b" {\n}\n', 'resource "aws_s3_bucket" "b" {}\nresource "aws_s3_bucket_versioning" "b" {}\n'),
  T('tf-s3-no-logging', 'an S3 bucket has no access logging resource in this file', (l, c) => /^\s*resource\s+"aws_s3_bucket"\s/.test(l) && !/aws_s3_bucket_logging/.test(c.text), 'resource "aws_s3_bucket" "b" {\n}\n', 'resource "aws_s3_bucket" "b" {}\nresource "aws_s3_bucket_logging" "b" {}\n'),
  R('tf-s3-force-destroy', 'force_destroy is true, so a bucket with data can be deleted', /\bforce_destroy\s*=\s*true\b/, 'force_destroy = true', 'force_destroy = false'),
  ...SG_RULES,
  R('tf-ebs-unencrypted', 'an EBS volume is not encrypted', /^\s*encrypted\s*=\s*false\b/, 'encrypted = false', 'encrypted = true'),
  R('tf-rds-unencrypted', 'an RDS database is not encrypted at rest', /\bstorage_encrypted\s*=\s*false\b/, 'storage_encrypted = false', 'storage_encrypted = true'),
  T('tf-efs-unencrypted', 'an EFS file system does not set encrypted = true', (l, c) => /^\s*resource\s+"aws_efs_file_system"/.test(l) && !/encrypted\s*=\s*true/.test(c.text), 'resource "aws_efs_file_system" "f" {\n}\n', 'resource "aws_efs_file_system" "f" {\n  encrypted = true\n}\n'),
  R('tf-iam-wildcard-action', 'an IAM policy allows every action (or every action of a service)', /^\s*actions?\s*=\s*(\[\s*)?"(\*|[a-z0-9-]+:\*)"/, 'actions = ["*"]', 'actions = ["s3:GetObject"]'),
  R('tf-iam-wildcard-resource', 'an IAM policy applies to every resource', /^\s*resources?\s*=\s*(\[\s*)?"\*"/, 'resources = ["*"]', 'resources = ["arn:aws:s3:::bucket/*"]'),
  R('tf-public-ip-instance', 'an instance gets a public IP address', /\bassociate_public_ip_address\s*=\s*true\b/, 'associate_public_ip_address = true', 'associate_public_ip_address = false'),
  R('tf-cloudfront-old-tls', 'CloudFront allows TLS 1.0 or SSL 3 to viewers', /\bminimum_protocol_version\s*=\s*"(SSLv3|TLSv1|TLSv1_2016|TLSv1\.1_2016)"/, 'minimum_protocol_version = "TLSv1"', 'minimum_protocol_version = "TLSv1.2_2021"'),
  R('tf-kms-no-rotation', 'a KMS key does not rotate its key material', /\benable_key_rotation\s*=\s*false\b/, 'enable_key_rotation = false', 'enable_key_rotation = true'),
  R('tf-rds-public', 'an RDS database is publicly accessible', /\bpublicly_accessible\s*=\s*true\b/, 'publicly_accessible = true', 'publicly_accessible = false'),
  R('tf-rds-no-deletion-protection', 'an RDS database can be deleted (deletion_protection is false)', /\bdeletion_protection\s*=\s*false\b/, 'deletion_protection = false', 'deletion_protection = true'),
  R('tf-default-vpc', 'the default VPC is taken over, so Terraform manages a network nobody designed', /^\s*resource\s+"aws_default_vpc"\s/, 'resource "aws_default_vpc" "default" {}', 'resource "aws_vpc" "main" {}'),
  T('tf-secret-variable-default', 'a variable named like a secret has a literal default value', (l, c) => /^\s*default\s*=\s*"[^"$]+"/.test(l) && backHas(c, /^\s*variable\s+"[^"]*(password|passwd|secret|token|api_?key|private_?key)/i, 4), 'variable "db_password" {\n  default = "hunter2"\n}\n', 'variable "db_password" {\n  type = string\n  sensitive = true\n}\n'),
  T('tf-sensitive-output-not-marked', 'an output named like a secret is not marked sensitive', (l, c) => /^\s*output\s+"(?![^"]*(?:_arns?|_ids?|_names?|_urls?|_uris?|_paths?|_ids|_ref)")[^"]*(password|secret|token|key)[^"]*"/i.test(l) && !windowHas(c, /sensitive\s*=\s*true/, 4), 'output "db_password" {\n  value = var.pw\n}\n', 'output "db_password" {\n  value = var.pw\n  sensitive = true\n}\n'),
])

// =====================================================================================================================
// Compose (ip-terraform-compose, the Compose group). config.mjs already covers privileged, host networking and open database ports.
// =====================================================================================================================
const COMPOSE_RULES = withScope(COMPOSE_FILES, COMMENT, [
  T('compose-cap-add-dangerous', 'a service adds a dangerous Linux capability (cap_add)', (l, c) => /^\s*-\s*["']?(ALL|SYS_ADMIN|NET_ADMIN|SYS_PTRACE|SYS_MODULE|SYS_RAWIO)["']?\s*(#.*)?$/.test(l) && parentOf(c) === 'cap_add', 'services:\n  app:\n    cap_add:\n      - SYS_ADMIN\n', 'services:\n  app:\n    cap_drop:\n      - ALL\n'),
  T('compose-no-new-privileges-missing', 'a service does not set no-new-privileges in security_opt', (l, c) => /^\s*image:/.test(l) && !/no-new-privileges/.test(parentBlock(c)), 'services:\n  app:\n    image: nginx:1.27\n', 'services:\n  app:\n    image: nginx:1.27\n    security_opt:\n      - no-new-privileges:true\n'),
  T('compose-read-only-missing', 'a service root filesystem is writable (read_only is not true)', (l, c) => /^\s*image:/.test(l) && !/read_only:\s*true/.test(parentBlock(c)), 'services:\n  app:\n    image: nginx:1.27\n', 'services:\n  app:\n    image: nginx:1.27\n    read_only: true\n'),
  T('compose-restart-missing', 'a service has no restart policy, so it stays down after a crash', (l, c) => /^\s*image:/.test(l) && !/\brestart:/.test(parentBlock(c)), 'services:\n  app:\n    image: nginx:1.27\n', 'services:\n  app:\n    image: nginx:1.27\n    restart: unless-stopped\n'),
  R('compose-pid-host', 'a service shares the host process namespace (pid: host)', /^\s*pid:\s*["']?host["']?\s*(#.*)?$/, 'pid: host', 'restart: unless-stopped'),
  R('compose-ipc-host', 'a service shares the host IPC namespace (ipc: host)', /^\s*ipc:\s*["']?host["']?\s*(#.*)?$/, 'ipc: host', 'restart: unless-stopped'),
  R('compose-user-root', 'a service runs as root (user: root or 0)', /^\s*user:\s*["']?(root|0)(:[^"'\s]*)?["']?\s*(#.*)?$/, 'user: root', 'user: "1000:1000"'),
  T('compose-depends-on-not-healthy', 'depends_on waits only for the start of the other service, not for it to be healthy', (l, c) => /^\s*depends_on:\s*(#.*)?$/.test(l) && !/service_healthy/.test(childBlock(c)), 'services:\n  web:\n    depends_on:\n      - db\n', 'services:\n  web:\n    depends_on:\n      db:\n        condition: service_healthy\n'),
])

// =====================================================================================================================
// GitHub Actions workflows (ip-gha)
// =====================================================================================================================
const ISSUE_TEXT = /\$\{\{[^}]{0,200}github\.event\.(issue|pull_request|comment|review|review_comment|discussion)\.(title|body)\b/
const HEAD_REF = /\$\{\{[^}]{0,200}(github\.head_ref\b|github\.event\.pull_request\.head\.ref\b)/
const COMMIT_TEXT = /\$\{\{[^}]{0,200}github\.event\.(head_commit\.(message|author\.(name|email))|commits\b)/
const DISPATCH_INPUT = /\$\{\{[^}]{0,200}\binputs\./
const inRun = (c) => /^\s*(-\s+)?run:/.test(c.lines[c.index]) || parentOf(c) === 'run'
const inScript = (c) => /^\s*(-\s+)?script:/.test(c.lines[c.index]) || parentOf(c) === 'script'
const PR_TRIGGER = /\b(pull_request|pull_request_target|issue_comment|workflow_run)\b/
const EVENT_LINE = /^(on:\s*\[?\s*|\s{0,8}-?\s*)pull_request_target\s*(:|\]|,|$|#)/

const GHA_RULES = withScope(GHA_FILES, COMMENT, [
  T('gha-inject-issue-text-run', 'an issue, PR or comment title or body is put straight into run:', (l, c) => ISSUE_TEXT.test(l) && inRun(c), 'jobs:\n  x:\n    steps:\n      - run: echo "${{ github.event.issue.title }}"\n', 'jobs:\n  x:\n    steps:\n      - env:\n          TITLE: ${{ github.event.issue.title }}\n        run: echo "$TITLE"\n'),
  T('gha-inject-head-ref-run', 'the branch name (head_ref) is put straight into run:', (l, c) => HEAD_REF.test(l) && inRun(c), 'jobs:\n  x:\n    steps:\n      - run: git checkout ${{ github.head_ref }}\n', 'jobs:\n  x:\n    steps:\n      - env:\n          BRANCH: ${{ github.head_ref }}\n        run: git checkout "$BRANCH"\n'),
  T('gha-inject-commit-run', 'a commit message or author name is put straight into run:', (l, c) => COMMIT_TEXT.test(l) && inRun(c), 'jobs:\n  x:\n    steps:\n      - run: echo "${{ github.event.head_commit.message }}"\n', 'jobs:\n  x:\n    steps:\n      - run: echo "built"\n'),
  T('gha-inject-dispatch-input-run', 'a workflow_dispatch input is put straight into run:', (l, c) => DISPATCH_INPUT.test(l) && inRun(c), 'jobs:\n  x:\n    steps:\n      - run: ./deploy.sh ${{ inputs.target }}\n', 'jobs:\n  x:\n    steps:\n      - env:\n          TARGET: ${{ inputs.target }}\n        run: ./deploy.sh "$TARGET"\n'),
  T('gha-inject-github-script', 'untrusted event text is interpolated into an actions/github-script script', (l, c) => (ISSUE_TEXT.test(l) || HEAD_REF.test(l) || COMMIT_TEXT.test(l)) && inScript(c), 'jobs:\n  x:\n    steps:\n      - uses: actions/github-script@v7\n        with:\n          script: |\n            core.info("${{ github.event.issue.title }}")\n', 'jobs:\n  x:\n    steps:\n      - uses: actions/github-script@v7\n        with:\n          script: |\n            core.info(process.env.TITLE)\n'),
  T('gha-hardcoded-env-secret', 'a secret-looking env variable holds a literal value in the workflow', (l, c) => /^\s*[A-Z0-9_]*(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY)[A-Z0-9_]*:\s*["']?[^\s"'$]/.test(l) && parentOf(c) === 'env', 'env:\n  API_TOKEN: abc123xyz\n', 'env:\n  API_TOKEN: ${{ secrets.API_TOKEN }}\n'),
  T('gha-hardcoded-with-secret', 'a secret-looking action input holds a literal value', (l, c) => /^\s*(password|token|api[_-]?key|secret)\s*:\s*["']?[^\s"'$]/i.test(l) && parentOf(c) === 'with', 'with:\n  password: hunter2\n', 'with:\n  password: ${{ secrets.PW }}\n'),
  R('gha-secrets-inherit', 'secrets: inherit passes every secret to a reusable workflow', /^\s*secrets:\s*inherit\b/, 'secrets: inherit', 'secrets:\n  token: ${{ secrets.TOKEN }}'),
  T('gha-self-hosted-on-pr', 'a self-hosted runner is used by a workflow that runs on pull requests or comments', (l, c) => /\bself-hosted\b/.test(l) && /runs-on|^\s*-\s/.test(l) && PR_TRIGGER.test(c.text), 'on: pull_request\njobs:\n  b:\n    runs-on: [self-hosted, linux]\n', 'on: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n'),
  R('gha-constant-if', 'an if: condition is a constant, so the step always or never runs', /^\s*if:\s*["']?(true|false|\$\{\{\s*(true|false)\s*\}\})["']?\s*(#.*)?$/, 'if: true', 'if: github.ref == "refs/heads/main"'),
  R('gha-if-uses-secret', 'an if: condition reads a secret (secrets are not allowed in if:)', /^\s*if:.*\$\{\{[^}]{0,200}\bsecrets\./, 'if: ${{ secrets.DEPLOY_KEY != "" }}', 'if: github.ref == "refs/heads/main"'),
  T('gha-prt-checkout-pr-head', 'a pull_request_target workflow checks out the untrusted pull request head', (l, c) => /^\s*ref:\s*.*\$\{\{[^}]{0,200}github\.event\.pull_request\.head\./.test(l) && /\bpull_request_target\b/.test(c.text), 'on: pull_request_target\njobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n', 'on: pull_request\njobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n'),
  T('gha-workflow-run-artifact', 'a workflow_run workflow downloads artifacts, which a fork can have written', (l, c) => /uses:\s*["']?actions\/download-artifact/.test(l) && /\bworkflow_run\b/.test(c.text), 'on: workflow_run\njobs:\n  x:\n    steps:\n      - uses: actions/download-artifact@v4\n', 'on: push\njobs:\n  x:\n    steps:\n      - uses: actions/download-artifact@v4\n'),
  T('gha-permissions-absent', 'no top-level permissions block, so the token gets the repository default scope', (l, c) => /^on:/.test(l) && !/^permissions:/m.test(c.text), 'on: push\njobs:\n  b:\n    runs-on: x\n', 'on: push\npermissions:\n  contents: read\njobs:\n  b:\n    runs-on: x\n'),
  R('gha-permissions-write-all', 'permissions: write-all gives the token every write scope', /^\s*permissions:\s*write-all\b/, 'permissions: write-all', 'permissions: read-all'),
  R('gha-contents-write', 'the token can push to the repository (contents: write), confirm the job needs it', /(?:^\s*|[{,]\s*)contents:\s*write\b/, 'contents: write', 'contents: read'),
  T('gha-id-token-write-on-pr', 'an OIDC id-token is requested by a workflow that runs on pull requests or comments', (l, c) => /^\s*id-token:\s*write\b/.test(l) && PR_TRIGGER.test(c.text), 'on: pull_request\npermissions:\n  id-token: write\n', 'on: push\npermissions:\n  id-token: write\n'),
  T('gha-pull-request-target-trigger', 'the pull_request_target trigger runs with secrets for fork pull requests (review it)', (l) => EVENT_LINE.test(l), 'on: pull_request_target\n', 'on: pull_request\n'),
  T('gha-cache-on-pr-target', 'a cache is used in a pull_request_target workflow, where a fork can poison it', (l, c) => /uses:\s*["']?actions\/cache/.test(l) && /\bpull_request_target\b/.test(c.text), 'on: pull_request_target\njobs:\n  x:\n    steps:\n      - uses: actions/cache@v4\n', 'on: pull_request\njobs:\n  x:\n    steps:\n      - uses: actions/cache@v4\n'),
  T('gha-artifact-whole-workspace', 'an upload-artifact step uploads the whole workspace (path: . or *)', (l, c) => /^\s*path:\s*["']?(\.|\.\/|\*\*|\*)["']?\s*(#.*)?$/.test(l) && /uses:\s*["']?actions\/upload-artifact/.test(c.text), 'steps:\n  - uses: actions/upload-artifact@v4\n    with:\n      path: .\n', 'steps:\n  - uses: actions/upload-artifact@v4\n    with:\n      path: dist/\n'),
  T('gha-artifact-git-dir', 'an upload-artifact step uploads the .git folder, which holds credentials', (l, c) => /^\s*path:\s*.*(^|[\s"'/])\.git(\/|[\s"']|$)/.test(l) && /uses:\s*["']?actions\/upload-artifact/.test(c.text), 'steps:\n  - uses: actions/upload-artifact@v4\n    with:\n      path: .git/\n', 'steps:\n  - uses: actions/upload-artifact@v4\n    with:\n      path: dist/\n'),
  R('gha-persist-credentials', 'checkout keeps the git token in the workspace (persist-credentials: true)', /^\s*persist-credentials:\s*true\b/, 'persist-credentials: true', 'persist-credentials: false'),
  R('gha-set-output-deprecated', 'the ::set-output command is deprecated (write to $GITHUB_OUTPUT)', /::set-output\b/, 'echo "::set-output name=x::1"', 'echo "x=1" >> "$GITHUB_OUTPUT"'),
  R('gha-save-state-set-env-deprecated', 'the ::save-state, ::set-env or ::add-path commands are deprecated', /::(save-state|set-env|add-path)\b/, 'echo "::set-env name=A::b"', 'echo "A=b" >> "$GITHUB_ENV"'),
  R('gha-unsecure-commands', 'ACTIONS_ALLOW_UNSECURE_COMMANDS re-enables the disabled unsafe commands', /ACTIONS_ALLOW_UNSECURE_COMMANDS/, 'ACTIONS_ALLOW_UNSECURE_COMMANDS: true', 'ACTIONS_STEP_DEBUG: false'),
  T('gha-github-env-untrusted', 'an untrusted value is written into GITHUB_ENV, GITHUB_PATH or GITHUB_OUTPUT', (l) => /GITHUB_(ENV|PATH|OUTPUT)\b/.test(l) && /\$\{\{[^}]{0,200}\b(github\.event\.|inputs\.|github\.head_ref)/.test(l), 'run: echo "X=${{ github.event.issue.title }}" >> $GITHUB_ENV', 'run: echo "X=1" >> $GITHUB_ENV'),
  T('gha-curl-pipe-shell', 'a run step pipes a download into a shell', (l, c) => inRun(c) && /\b(curl|wget)\b[^|\n]{0,300}\|\s*(sudo\s+)?(ba|z)?sh\b/.test(l), 'run: curl -fsSL https://x.io/i.sh | bash', 'run: curl -fsSL -o i.sh https://x.io/i.sh'),
  T('gha-deploy-no-concurrency', 'a deploy or release workflow sets no concurrency group, so two runs can overlap', (l, c) => /^on:/.test(l) && /deploy|release/i.test(c.file) && !/^concurrency:/m.test(c.text), 'on: push\njobs:\n  x:\n    runs-on: a\n', 'on: push\nconcurrency: deploy\njobs:\n  x:\n    runs-on: a\n', { sample: '.github/workflows/deploy.yml' }),
  R('gha-broad-branch-trigger', 'a trigger matches every branch (branches: ["**"])', /^\s*branches:\s*\[?\s*["']?\*\*["']?\s*\]?\s*(#.*)?$/, "branches: ['**']", 'branches: [main]'),
  R('gha-cron-every-minute', 'a cron schedule runs every minute', /cron:\s*["']\*\s+\*\s+\*\s+\*\s+\*["']/, "cron: '* * * * *'", "cron: '0 6 * * 1'"),
  R('gha-cron-frequent', 'a cron schedule runs every nine minutes or more often', /cron:\s*["']\*\/[1-9]\s/, "cron: '*/5 * * * *'", "cron: '0 3 * * *'"),
  R('gha-old-action-major', 'an old major version (v1 to v3) of a common action is pinned', /uses:\s*["']?actions\/(checkout|setup-node|setup-python|setup-java|setup-go|cache|upload-artifact|download-artifact)@v[1-3]\b/, 'uses: actions/checkout@v2', 'uses: actions/checkout@v4'),
  R('gha-continue-on-error', 'continue-on-error: true lets a failed step pass without a sign', /^\s*continue-on-error:\s*true\b/, 'continue-on-error: true', 'continue-on-error: false'),
  R('gha-unknown-context', 'an expression uses a context name GitHub does not define, so it expands to nothing', /\$\{\{[^}]{0,200}\bgithub\.(actor_name|repo_name|branch_name|sha1|repository_name|pr_number)\b/, '${{ github.repo_name }}', '${{ github.repository }}'),
])

export { DOCKER_RULES, K8S_RULES, TF_RULES, COMPOSE_RULES, GHA_RULES, DOCKER_EXTRA, K8S_EXTRA }
const RULE_TOTAL = DOCKER_RULES.length + K8S_RULES.length + TF_RULES.length + COMPOSE_RULES.length + GHA_RULES.length

// The number of sub-checks each check reports (its rule tables plus its folder-level rules), for the pack entries.
export const CHECK_SUBS = {
  'ip-docker': DOCKER_RULES.length + DOCKER_EXTRA,
  'ip-k8s': K8S_RULES.length + K8S_EXTRA,
  'ip-terraform-compose': TF_RULES.length + COMPOSE_RULES.length,
  'ip-gha': GHA_RULES.length,
}

