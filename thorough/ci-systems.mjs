// CI and deploy configuration beyond the GitHub Actions checks already in the repo (workflow-security, ci-timeouts and friends):
// GitLab CI, CircleCI, Azure Pipelines, Jenkins, reusable and artifact steps in GitHub Actions, Helm charts, Ansible and pre-commit.
// A check that finds no such file says "not applicable: no <thing>" and passes. Run through the ci-systems pack, or by hand:
//   node thorough/ci-systems.mjs <check> [--root <dir>]      node thorough/ci-systems.mjs <check> --fixtures   (must exit 1)
// The YAML reader is line-based and tolerant: unreadable input is a finding, never a crash. Accept a finding in
// .meerkat-cisystems-allow, one "check-id path" per line.
import { existsSync } from 'node:fs'
import { posix } from 'node:path'
import { finish, isFixture, main, notRun, readText, trackedFiles, withFixture } from './kit.mjs'

const SKIP = /(^|\/)(node_modules|dist|build|vendor|target)\//i
const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i
const TOKEN = /\b(glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})/
const SECRET_PATH = /(^|[\s/'"])(\.env|\.git|\.ssh|\.npmrc|id_rsa|[^\s'"]*\.(pem|key|p12))(?=$|[\s/'"])|secret|credential/i

const lines = (t) => t.replace(/\r/g, '').split('\n')
const indent = (s) => s.length - s.trimStart().length
const blank = (s) => /^\s*(#.*)?$/.test(s)
const msg = (e) => String(e?.message ?? e).slice(0, 120)
const literal = (v) => v !== '' && !/\$|\{\{|^[|>]/.test(v) && !/^(true|false|yes|no|null|~)$/i.test(v)
const pickRe = (r) => (all) => all.filter((x) => r.test(x))
const allowSet = (root) => new Set(readText(root, '.meerkat-cisystems-allow').split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l && !l.startsWith('#')))

// Strips a trailing comment and the quotes around a value.
function clean(v) {
  const s = v.trim()
  if (/^["']/.test(s)) {
    const end = s.indexOf(s[0], 1)
    return end > 0 ? s.slice(1, end) : s.slice(1)
  }
  return s.replace(/\s+#.*$/, '').trim()
}

// "key: value", or "- key: value". keyCol is the column the key starts at, after any list dash.
function kv(line) {
  const m = /^(\s*)(- +)?["']?([A-Za-z0-9_.@\/-]+)["']?:(?:\s+(.*))?$/.exec(line)
  if (!m) return null
  return { key: m[3], value: clean(m[4] ?? ''), indent: m[1].length, keyCol: m[1].length + (m[2]?.length ?? 0) }
}

// The lines nested under line i: everything more indented than it, up to the next line at its own level or less.
function childRange(ls, i) {
  const base = indent(ls[i])
  const out = []
  for (let j = i + 1; j < ls.length; j++) {
    if (blank(ls[j])) continue
    if (indent(ls[j]) <= base) break
    out.push(j)
  }
  return out
}

// The list item (a step, task, play or repo) that holds the key on line i, as [first, end) line indexes.
function itemRange(ls, i) {
  const col = kv(ls[i])?.keyCol ?? indent(ls[i])
  let start = -1
  for (let j = i; j >= 0; j--) {
    const m = /^(\s*)- /.exec(ls[j])
    if (m && m[1].length < col) {
      start = j
      break
    }
  }
  const first = start < 0 ? i : start
  const base = start < 0 ? col - 1 : indent(ls[start])
  let end = ls.length
  for (let j = first + 1; j < ls.length; j++) {
    if (!blank(ls[j]) && indent(ls[j]) <= base) {
      end = j
      break
    }
  }
  return [first, end]
}

// The key that holds line i, found by walking up to the nearest less-indented line.
function parentOf(ls, i) {
  const col = indent(ls[i])
  for (let j = i - 1; j >= 0; j--) {
    if (blank(ls[j]) || indent(ls[j]) >= col) continue
    return kv(ls[j]) ?? { key: '', value: '' }
  }
  return null
}

// Literal secrets: a key that names a secret with a plain value, or a "value:" under a parent that names one (GitLab nested
// variables, Azure "- name: X / value: Y"). Values are never echoed into findings.
function secretHits(ls, exclude) {
  const hits = []
  ls.forEach((line, i) => {
    const p = kv(line)
    if (!p || !literal(p.value)) return
    if (SECRET_KEY.test(p.key) && !exclude?.test(p.key)) {
      hits.push({ i, what: p.key })
    } else if (p.key === 'value') {
      const parent = parentOf(ls, i)
      if (parent && SECRET_KEY.test(`${parent.key} ${parent.value}`) && !exclude?.test(parent.key)) {
        hits.push({ i, what: parent.key === 'name' ? parent.value : parent.key })
      }
    }
  })
  return hits
}

// Runs one check: picks its files, says "not applicable" when there are none, and reports what the per-file rules find.
function def(id, pick, naText, okNote, perFile) {
  return (root) => {
    if (!existsSync(root)) return notRun(`${id}: cannot read the folder ${root}`)
    try {
      const all = trackedFiles(root).filter((x) => !SKIP.test(x) && !isFixture(x))
      const list = pick(all, root)
      if (!list.length) {
        console.log(`${id}: not applicable: no ${naText}`)
        return 0
      }
      const allow = allowSet(root)
      const f = []
      const info = []
      const ctx = { root, all, set: new Set(all), info }
      for (const x of list) {
        if (allow.has(`${id} ${x}`)) continue
        try {
          perFile(x, lines(readText(root, x)), f, ctx)
        } catch (e) {
          f.push(`${x} cannot be read: ${msg(e)}`)
        }
      }
      const code = finish(id, f, okNote)
      for (const n of info.slice(0, 10)) console.log(`${id}: note, ${n}`)
      return code
    } catch (e) {
      console.log(`${id}: found 1`)
      console.log(`  cannot read the project's files: ${msg(e)}`)
      return 1
    }
  }
}

// ---- GitLab CI (.gitlab-ci.yml) -------------------------------------------------------------------------------------
const GITLAB = /(^|\/)\.gitlab-ci\.ya?ml$/
const NO_GITLAB = 'GitLab CI file (.gitlab-ci.yml)'

// ---- gitlab-ci-secrets: credentials or tokens written into the file, not into masked CI/CD variables
const gitlabSecrets = def('gitlab-ci-secrets', pickRe(GITLAB), NO_GITLAB, 'no credential is written into the GitLab CI file', (x, ls, f) => {
  for (const h of secretHits(ls)) f.push(`${x}:${h.i + 1} sets ${h.what} to a literal value. Keep it in a masked CI/CD variable instead.`)
  ls.forEach((l, i) => {
    if (TOKEN.test(l)) f.push(`${x}:${i + 1} contains what looks like a live access token`)
  })
})

// Every image and service a GitLab file names, with the line it is on.
function gitlabImages(ls) {
  const out = []
  ls.forEach((line, i) => {
    const p = kv(line)
    if (!p) return
    if (p.key === 'image') {
      if (p.value) {
        out.push({ i, img: p.value, kind: 'image' })
      } else {
        const name = childRange(ls, i).map((j) => kv(ls[j])).find((q) => q?.key === 'name')
        if (name?.value) out.push({ i, img: name.value, kind: 'image' })
      }
    }
    if (p.key === 'services' && !p.value) {
      for (const j of childRange(ls, i)) {
        const dash = /^\s*-\s+(\S+)\s*$/.exec(ls[j])
        const q = kv(ls[j])
        if (dash) out.push({ i: j, img: clean(dash[1]), kind: 'service' })
        else if (q?.key === 'name' && q.value) out.push({ i: j, img: q.value, kind: 'service' })
      }
    }
  })
  return out
}

// Why an image reference is not pinned, or null when it is pinned (or is a variable or digest we cannot judge).
function imageProblem(img) {
  if (/\$|@/.test(img)) return null
  const last = img.split('/').pop()
  if (!last.includes(':')) return 'has no tag, which means latest'
  return last.endsWith(':latest') ? 'uses the latest tag, which moves without notice' : null
}

// ---- gitlab-ci-images: images and services with no tag or the latest tag
const gitlabImage = def('gitlab-ci-images', pickRe(GITLAB), NO_GITLAB, 'every GitLab image and service is pinned to a tag', (x, ls, f) => {
  for (const s of gitlabImages(ls)) {
    const why = imageProblem(s.img)
    if (why) f.push(`${x}:${s.i + 1} ${s.kind} "${s.img}" ${why}. Pin a specific version tag.`)
  }
})

// ---- gitlab-ci-privileged: privileged containers, and docker:dind with TLS turned off or plain tcp
const gitlabPrivileged = def('gitlab-ci-privileged', pickRe(GITLAB), NO_GITLAB, 'no job asks for a privileged container without TLS', (x, ls, f) => {
  ls.forEach((l, i) => {
    const p = kv(l)
    if (p?.key === 'privileged' && /^true$/i.test(p.value)) f.push(`${x}:${i + 1} asks for a privileged container`)
  })
  if (!gitlabImages(ls).some((s) => /dind/.test(s.img))) return
  const vars = ls.map((l) => kv(l)).filter(Boolean)
  if (vars.some((p) => p.key === 'DOCKER_TLS_CERTDIR' && /^(|false)$/i.test(p.value))) f.push(`${x}: docker:dind runs with TLS turned off (DOCKER_TLS_CERTDIR is empty or false)`)
  if (vars.some((p) => p.key === 'DOCKER_HOST' && /^tcp:\/\/[^:\s]+:2375\b/.test(p.value))) f.push(`${x}: DOCKER_HOST points at plain tcp port 2375, which is not encrypted`)
})

// ---- gitlab-ci-stages: a job names a stage that is not defined; merge request duplicate pipelines are an informational note
const GL_RESERVED = new Set(['stages', 'variables', 'workflow', 'include', 'default', 'image', 'services', 'cache', 'before_script', 'after_script', 'types'])
const GL_DEFAULT_STAGES = ['.pre', 'build', 'test', 'deploy', '.post']
const gitlabStages = def('gitlab-ci-stages', pickRe(GITLAB), NO_GITLAB, 'every job names a stage that is defined', (x, ls, f, ctx) => {
  const top = ls.map((l, i) => ({ i, p: !blank(l) && indent(l) === 0 ? kv(l) : null })).filter((o) => o.p)
  const stagesAt = top.find((o) => o.p.key === 'stages')
  const stages = stagesAt
    ? childRange(ls, stagesAt.i).map((j) => /^\s*-\s+(.+?)\s*$/.exec(ls[j])?.[1]).filter(Boolean).map((s) => clean(s))
    : GL_DEFAULT_STAGES
  for (const o of top) {
    if (o.p.key.startsWith('.') || GL_RESERVED.has(o.p.key)) continue
    const st = childRange(ls, o.i).map((j) => kv(ls[j])).find((q) => q?.key === 'stage')
    const stage = st ? st.value : 'test'
    if (!stage.includes('$') && !stages.includes(stage)) f.push(`${x}:${o.i + 1} job "${o.p.key}" uses stage "${stage}", which is not in the stages list`)
  }
  const hasWorkflow = top.some((o) => o.p.key === 'workflow')
  if (!hasWorkflow && /merge_request/.test(ls.join('\n'))) ctx.info.push(`${x}: jobs run for merge requests and the file has no workflow: rules, so one push can start two pipelines`)
})

// ---- circleci-config: orbs pinned to @volatile, deprecated machine images, secrets in the config
const CIRCLE = /(^|\/)\.circleci\/config\.ya?ml$/
// Snapshot of image names known to be deprecated when this was written. Re-check CircleCI's deprecation notes before relying on it.
const OLD_CIRCLE_IMAGE = /\bimage:\s*['"]?(ubuntu-(1604|1804))\b/
const circleConfig = def('circleci-config', pickRe(CIRCLE), 'CircleCI config (.circleci/config.yml)', 'the CircleCI config pins its orbs, uses current machine images and keeps secrets out', (x, ls, f) => {
  ls.forEach((l, i) => {
    if (/@volatile\b/.test(l)) f.push(`${x}:${i + 1} uses an orb pinned to @volatile, which takes whatever release is newest. Pin a version number.`)
    if (OLD_CIRCLE_IMAGE.test(l)) f.push(`${x}:${i + 1} uses a machine image on the deprecated list. Move to a current image.`)
  })
  for (const h of secretHits(ls)) f.push(`${x}:${h.i + 1} sets ${h.what} to a literal value. Keep it in a CircleCI project environment variable.`)
})

// ---- azure-pipelines: vmImage on latest, a download piped into a shell, secrets inline
const AZURE = /(^|\/)azure-pipelines\.ya?ml$/
const azurePipelines = def('azure-pipelines', pickRe(AZURE), 'Azure Pipelines file (azure-pipelines.yml)', 'the pipeline uses named images, no piped installers and no inline secrets', (x, ls, f) => {
  ls.forEach((l, i) => {
    const p = kv(l)
    if (p?.key === 'vmImage' && /latest$/.test(p.value)) f.push(`${x}:${i + 1} uses vmImage "${p.value}", which moves when Microsoft updates it. Pin a named version.`)
    if (/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(l)) f.push(`${x}:${i + 1} pipes a download straight into a shell`)
  })
  for (const h of secretHits(ls)) f.push(`${x}:${h.i + 1} sets ${h.what} to a literal value. Keep it in a secret pipeline variable.`)
})

// ---- jenkinsfile-safety: build parameters inside shell strings, credentials printed, the Docker socket on any agent
const JENKINS = /(^|\/)Jenkinsfile(\.\w+)?$/
const jenkinsSafety = def('jenkinsfile-safety', pickRe(JENKINS), 'Jenkinsfile', 'the Jenkinsfile keeps parameters out of shell strings and credentials out of the log', (x, ls, f) => {
  const anyAgent = /^\s*agent\s+any\b/m.test(ls.join('\n'))
  ls.forEach((l, i) => {
    if (/\bsh\b[^\n]*"[^"]*\$\{?params\./.test(l)) f.push(`${x}:${i + 1} puts a build parameter inside a double-quoted sh step, so its value can inject shell commands. Pass it through an environment variable.`)
    if (/\b(echo|println|print)\b.*\$\{?\w*(PASS|TOKEN|SECRET|API_?KEY)\w*\}?/i.test(l)) f.push(`${x}:${i + 1} prints a credential to the build log`)
    if (anyAgent && /docker\.sock/.test(l)) f.push(`${x}:${i + 1} mounts the Docker socket on an agent that can be any machine. Use a labelled agent instead.`)
  })
})

// ---- GitHub Actions: reusable workflows, concurrency for deploys, artifact retention and paths
const WF = /^\.github\/workflows\/[^/]+\.ya?ml$/
const wfPick = (all) => all.filter((x) => WF.test(x))

// ---- github-actions-reusable: a called local workflow that does not exist, or a reference to a branch
const ghReusable = def('github-actions-reusable', wfPick, 'GitHub Actions workflow (.github/workflows)', 'every reusable workflow exists and is pinned to a fixed ref', (x, ls, f, ctx) => {
  ls.forEach((l, i) => {
    const p = kv(l)
    if (p?.key !== 'uses') return
    if (p.value.startsWith('./.github/workflows/') && !ctx.set.has(posix.normalize(p.value.slice(2)))) f.push(`${x}:${i + 1} calls ${p.value}, which is not in the repository`)
    if (/@(main|master)$/.test(p.value)) f.push(`${x}:${i + 1} uses ${p.value}, a branch that moves without notice. Pin a tag or a commit.`)
  })
})

// ---- github-actions-concurrency: a deploy or release workflow with no concurrency group, so two runs can overlap
const RELEASE = /(deploy|release|publish)/i
const ghConcurrency = def('github-actions-concurrency', (all, root) => all.filter((x) => WF.test(x) && (RELEASE.test(x) || RELEASE.test(readText(root, x).match(/^name:.*$/m)?.[0] ?? ''))), 'deploy or release workflow', 'every deploy or release workflow sets a concurrency group', (x, ls, f) => {
  if (!ls.some((l) => /^concurrency:/.test(l))) f.push(`${x} is a deploy or release workflow with no top-level concurrency: group, so two runs can overlap`)
})

// The path lines of an upload step, joined so the secret-looking test sees all of them.
function pathOf(block) {
  const i = block.findIndex((b) => kv(b)?.key === 'path')
  if (i < 0) return ''
  const base = indent(block[i])
  const out = [kv(block[i]).value]
  for (let j = i + 1; j < block.length; j++) {
    if (blank(block[j])) continue
    if (indent(block[j]) <= base) break
    out.push(block[j].trim())
  }
  return out.join('\n')
}

// ---- github-actions-artifacts: an upload with no retention limit, or one that uploads secrets or repository internals
const ghArtifacts = def('github-actions-artifacts', wfPick, 'GitHub Actions workflow (.github/workflows)', 'every uploaded artifact has a retention limit and no secret paths', (x, ls, f) => {
  ls.forEach((l, i) => {
    const p = kv(l)
    if (p?.key !== 'uses' || !/^actions\/upload-artifact@/.test(p.value)) return
    const [s, e] = itemRange(ls, i)
    const block = ls.slice(s, e)
    if (!block.some((b) => kv(b)?.key === 'retention-days')) f.push(`${x}:${i + 1} uploads an artifact with no retention-days, so it is kept for the account default`)
    if (SECRET_PATH.test(pathOf(block))) f.push(`${x}:${i + 1} uploads a path that looks like a secret or repository internals (.env, .git, keys, credentials)`)
  })
})

// ---- Helm (Chart.yaml) ------------------------------------------------------------------------------------------
const CHART = /(^|\/)Chart\.yaml$/
const NO_CHART = 'Helm chart (Chart.yaml)'

// ---- helm-chart-basics: metadata, apiVersion v2, no latest image tag, no host networking or privilege in templates
const helmBasics = def('helm-chart-basics', pickRe(CHART), NO_CHART, 'every Helm chart has valid metadata, pinned images and no host networking or privilege', (x, ls, f, ctx) => {
  const keys = new Map(ls.filter((l) => !blank(l) && indent(l) === 0).map((l) => kv(l)).filter(Boolean).map((p) => [p.key, p.value]))
  if (keys.get('apiVersion') !== 'v2') f.push(`${x} sets apiVersion ${keys.get('apiVersion') ?? '(missing)'}. Use v2 for Helm 3 charts.`)
  for (const k of ['name', 'version', 'appVersion']) if (!keys.has(k)) f.push(`${x} has no ${k}`)
  const dir = posix.dirname(x)
  const values = posix.join(dir, 'values.yaml')
  if (ctx.set.has(values)) {
    lines(readText(ctx.root, values)).forEach((l, i) => {
      const p = kv(l)
      if (p?.key === 'tag' && p.value === 'latest') f.push(`${values}:${i + 1} sets the image tag to latest`)
    })
  }
  const tdir = `${posix.join(dir, 'templates')}/`
  for (const t of ctx.all.filter((y) => y.startsWith(tdir) && /\.(ya?ml|tpl)$/.test(y))) {
    lines(readText(ctx.root, t)).forEach((l, i) => {
      const p = kv(l)
      if (p && /^true$/i.test(p.value) && (p.key === 'hostNetwork' || p.key === 'privileged')) f.push(`${t}:${i + 1} sets ${p.key}: true, which gives the pods host-level network or root access`)
    })
  }
})

// ---- helm-values-secrets: a literal password, token or key in a chart's values file (names of existing Secrets are fine)
const HELM_NAME_KEY = /(existing|name|ref|file|path|enabled|type)/i
const chartValuesPick = (all) => {
  const dirs = new Set(all.filter((x) => CHART.test(x)).map((x) => posix.dirname(x)))
  return all.filter((x) => /(^|\/)values[^/]*\.ya?ml$/.test(x) && dirs.has(posix.dirname(x)))
}
const helmSecrets = def('helm-values-secrets', chartValuesPick, 'Helm chart values file (values.yaml next to a Chart.yaml)', 'no chart values file holds a literal secret', (x, ls, f) => {
  for (const h of secretHits(ls, HELM_NAME_KEY)) f.push(`${x}:${h.i + 1} sets ${h.what} to a literal value. Read it from a Kubernetes Secret or pass it at install time.`)
})

// ---- Ansible ----------------------------------------------------------------------------------------------------
const YAML_FILE = /\.ya?ml$/
const NOT_ANSIBLE = /(^|\/)(\.github|\.gitlab|templates|charts?|docker-compose)(\/|$)|(^|\/)(\.gitlab-ci|\.pre-commit-config|azure-pipelines)\.ya?ml$/
const ROLE_TASKS = /(^|\/)roles\/[^/]+\/(tasks|handlers)\//
const PLAY = /^(\s*-\s+)?hosts:\s/m
const ansiblePick = (all, root) => all.filter((x) => YAML_FILE.test(x) && !NOT_ANSIBLE.test(x) && (ROLE_TASKS.test(x) || PLAY.test(readText(root, x))))
const PASSWORD_KEY = /^(\w*_)?(password|passwd|secret|token|api_key|apikey)$/i

// ---- ansible-hygiene: no_log on password tasks, become with become_user, ignore_errors, plain http downloads.
// shell and command tasks with no changed_when are an informational note only.
const ansibleHygiene = def('ansible-hygiene', ansiblePick, 'Ansible playbook (a file with hosts: or a roles/*/tasks folder)', 'playbooks hide passwords, limit become and avoid plain http', (x, ls, f, ctx) => {
  const seen = new Set()
  const once = (kind, start) => {
    const k = `${kind}:${start}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }
  ls.forEach((l, i) => {
    const p = kv(l)
    if (!p) return
    const [s, e] = itemRange(ls, i)
    const block = ls.slice(s, e).map((b) => kv(b))
    if (PASSWORD_KEY.test(p.key) && p.value && once('nolog', s) && !block.some((q) => q?.key === 'no_log' && /^(true|yes)$/i.test(q.value))) {
      f.push(`${x}:${i + 1} passes ${p.key} to a task without no_log: true, so the value is printed in run output`)
    }
    if (p.key === 'become' && /^(true|yes)$/i.test(p.value) && once('become', s) && !block.some((q) => q?.key === 'become_user')) {
      f.push(`${x}:${i + 1} turns on become with no become_user, so the task runs as root`)
    }
    if (p.key === 'ignore_errors' && /^(true|yes)$/i.test(p.value)) f.push(`${x}:${i + 1} sets ignore_errors: true, which hides a failed step`)
    if (p.key === 'url' && /^http:\/\//i.test(p.value)) f.push(`${x}:${i + 1} downloads over plain http: ${p.value.split('?')[0]}`)
    if ((p.key === 'shell' || p.key === 'command') && once('changed', s) && !block.some((q) => q?.key === 'changed_when')) {
      ctx.info.push(`${x}:${i + 1} runs ${p.key} with no changed_when, so every run reports changed`)
    }
  })
})

// ---- pre-commit-config: hooks fetched over http, not pinned, or pinned to a branch that moves
const PRECOMMIT = /(^|\/)\.pre-commit-config\.ya?ml$/
const preCommit = def('pre-commit-config', pickRe(PRECOMMIT), '.pre-commit-config.yaml file', 'every hook repository is pinned to a release and fetched over https', (x, ls, f) => {
  ls.forEach((l, i) => {
    const p = kv(l)
    if (p?.key !== 'repo' || /^(local|meta)$/.test(p.value)) return
    if (/^http:\/\//i.test(p.value)) f.push(`${x}:${i + 1} fetches hooks from ${p.value} over plain http`)
    const [s, e] = itemRange(ls, i)
    const rev = ls.slice(s, e).map((b) => kv(b)).find((q) => q?.key === 'rev')
    if (!rev) f.push(`${x}:${i + 1} repo ${p.value} has no rev, so it is not pinned`)
    else if (/^(main|master|HEAD|develop|trunk|stable|latest)$/i.test(rev.value)) f.push(`${x}:${i + 1} repo ${p.value} is pinned to the branch "${rev.value}", which moves. Pin a release tag or a commit.`)
  })
})

// ---- fixtures: one deliberate violation per check, run by the self-test ---------------------------------------
const fx = (tree, run) => ({ fixture: () => withFixture(tree, run) })

main({
  'gitlab-ci-secrets': { run: gitlabSecrets, ...fx({ '.gitlab-ci.yml': 'variables:\n  DB_PASSWORD: hunter2\n\nbuild:\n  script: echo hi\n' }, gitlabSecrets) },
  'gitlab-ci-images': { run: gitlabImage, ...fx({ '.gitlab-ci.yml': 'build:\n  image: node\n  script: echo hi\n' }, gitlabImage) },
  'gitlab-ci-privileged': {
    run: gitlabPrivileged,
    ...fx({ '.gitlab-ci.yml': 'build:\n  image: docker:24\n  services:\n    - docker:24-dind\n  variables:\n    DOCKER_TLS_CERTDIR: ""\n  privileged: true\n  script: docker info\n' }, gitlabPrivileged),
  },
  'gitlab-ci-stages': { run: gitlabStages, ...fx({ '.gitlab-ci.yml': 'stages:\n  - build\n\nunit:\n  stage: test\n  script: echo hi\n' }, gitlabStages) },
  'circleci-config': {
    run: circleConfig,
    ...fx({ '.circleci/config.yml': 'version: 2.1\norbs:\n  aws: circleci/aws-cli@volatile\njobs:\n  build:\n    machine:\n      image: ubuntu-1604:202010-01\n    environment:\n      API_TOKEN: abc123\n    steps:\n      - run: echo hi\n' }, circleConfig),
  },
  'azure-pipelines': {
    run: azurePipelines,
    ...fx({ 'azure-pipelines.yml': 'pool:\n  vmImage: ubuntu-latest\nsteps:\n  - script: curl -s https://example.com/install.sh | sh\n  - script: echo hi\nvariables:\n  - name: DB_PASSWORD\n    value: hunter2\n' }, azurePipelines),
  },
  'jenkinsfile-safety': {
    run: jenkinsSafety,
    ...fx({ Jenkinsfile: 'pipeline {\n  agent any\n  stages {\n    stage("Deploy") {\n      steps {\n        sh "deploy.sh ${params.TARGET}"\n        sh "echo ${PASSWORD}"\n        sh "docker run -v /var/run/docker.sock:/var/run/docker.sock img"\n      }\n    }\n  }\n}\n' }, jenkinsSafety),
  },
  'github-actions-reusable': {
    run: ghReusable,
    ...fx({ '.github/workflows/ci.yml': 'name: ci\non: push\njobs:\n  call:\n    uses: ./.github/workflows/missing.yml\n  other:\n    uses: someone/tools/.github/workflows/build.yml@main\n' }, ghReusable),
  },
  'github-actions-concurrency': {
    run: ghConcurrency,
    ...fx({ '.github/workflows/deploy.yml': 'name: deploy\non: push\njobs:\n  ship:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n' }, ghConcurrency),
  },
  'github-actions-artifacts': {
    run: ghArtifacts,
    ...fx({ '.github/workflows/ci.yml': 'name: ci\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/upload-artifact@v4\n        with:\n          name: out\n          path: .env\n' }, ghArtifacts),
  },
  'helm-chart-basics': {
    run: helmBasics,
    ...fx({ 'Chart.yaml': 'apiVersion: v1\nname: app\n', 'values.yaml': 'image:\n  tag: latest\n', 'templates/deploy.yaml': 'spec:\n  hostNetwork: true\n' }, helmBasics),
  },
  'helm-values-secrets': {
    run: helmSecrets,
    ...fx({ 'Chart.yaml': 'apiVersion: v2\nname: app\nversion: 0.1.0\nappVersion: "1.0"\n', 'values.yaml': 'db:\n  password: hunter2\n' }, helmSecrets),
  },
  'ansible-hygiene': {
    run: ansibleHygiene,
    ...fx({ 'site.yml': '- hosts: all\n  become: true\n  tasks:\n    - name: set password\n      user:\n        name: app\n        password: hunter2\n    - name: fetch\n      get_url:\n        url: http://example.com/x.tgz\n        dest: /tmp/x\n      ignore_errors: true\n' }, ansibleHygiene),
  },
  'pre-commit-config': {
    run: preCommit,
    ...fx({ '.pre-commit-config.yaml': 'repos:\n  - repo: https://github.com/psf/black\n    rev: main\n    hooks:\n      - id: black\n' }, preCommit),
  },
})
