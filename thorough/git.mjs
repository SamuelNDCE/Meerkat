// Git history and release hygiene, using only the git already installed. Run through the git pack, or by hand:
//   node thorough/git.mjs <check> [--root <dir>]      node thorough/git.mjs <check> --fixtures   (must exit 1)
// Budgets live in .meerkat-budgets.json under "git". A finding you accept goes in .meerkat-git-allow as "<check-id> <value>",
// where the value is what the check names: a short commit hash, a branch, a tag, an author email, a path or a URL.
// Every git call is a fixed argument array with no shell, and a hard timeout. Outside a git repository the check is NOT RUN (exit 75).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { finish, main, notRun, readBudgets, readText } from './kit.mjs'

const TIMEOUT_MS = 60_000
const MAX_BUFFER = 256 * 2 ** 20

// Runs git against a folder with a fixed argument array (never a shell). Returns stdout, or null when git fails (no tags yet, for example).
function git(root, args, input) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
  } catch {
    return null
  }
}

const gitInstalled = () => {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe', timeout: TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}
const inRepo = (root) => git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true'
const hasCommits = (root) => git(root, ['rev-parse', '--verify', '-q', 'HEAD']) !== null
const latestTag = (root) => git(root, ['describe', '--tags', '--abbrev=0'])?.trim() || null

// The shared start of every check: NOT RUN without git, a repository, or a commit to look at. Null when the check may run.
function gate(root) {
  if (!gitInstalled()) return notRun('git is not installed on this machine')
  if (!inRepo(root)) return notRun(`${root} is not inside a git repository, so there is no history to check`)
  if (!hasCommits(root)) return notRun('the repository has no commits yet')
  return null
}

// Recent commits, newest first. Fields are joined by the unit separator and each record ends with the record separator.
function recent(root, n, fields) {
  const out = git(root, ['log', `-n${n}`, `--format=${fields}%x1e`])
  if (out === null) return null
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n+/, ''))
    .filter((r) => r.trim() !== '')
    .map((r) => r.split('\x1f'))
}

const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
const snip = (s, n = 60) => {
  const t = clean(s)
  return t.length > n ? `${t.slice(0, n - 3)}...` : t
}
const budget = (root, key, dflt) => readBudgets(root)?.git?.[key] ?? dflt

// Accepted findings from .meerkat-git-allow: lines of "<check-id> <value>". A short commit hash matches the full hash it starts.
function allowList(root) {
  const map = new Map()
  for (const raw of readText(root, '.meerkat-git-allow').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [id, ...rest] = line.split(/\s+/)
    if (!map.has(id)) map.set(id, new Set())
    map.get(id).add(rest.join(' '))
  }
  return map
}
const allowed = (allow, id, value, hash = false) => {
  const set = allow.get(id)
  if (!set) return false
  if (set.has(value)) return true
  return hash && [...set].some((e) => e.length >= 7 && value.startsWith(e))
}

// ---- commit-message-format: the last 100 subjects are sane (merges are skipped, their subjects are generated)
const BAD_SUBJECT = /^(wip\b|fixup!|squash!|amend!)/i
function commitMessageFormat(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const rows = recent(root, 100, '%H%x1f%P%x1f%an%x1f%ae%x1f%s')
  if (!rows) return notRun('could not read the commit log')
  const max = budget(root, 'maxSubjectLength', 72)
  const allow = allowList(root)
  const f = []
  for (const [hash, parents = '', , , subject = ''] of rows) {
    if (parents.trim().split(' ').filter(Boolean).length > 1) continue
    if (allowed(allow, 'commit-message-format', hash, true)) continue
    const short = hash.slice(0, 10)
    const s = clean(subject)
    const label = `${short} "${snip(s, 50)}"`
    if (!s) f.push(`${short} has an empty subject line`)
    if (s.length > max) f.push(`${label} is ${s.length} characters (budget ${max})`)
    if (s.endsWith('.')) f.push(`${label} ends with a period`)
    if (BAD_SUBJECT.test(s)) f.push(`${label} is a WIP, fixup! or squash! commit left in the history`)
  }
  return finish('commit-message-format', f, `the last 100 commit subjects are well formed (at most ${max} characters)`)
}

// ---- merge-commit-noise: too many "Merge branch" commits in the last 200
function mergeCommitNoise(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const rows = recent(root, 200, '%H%x1f%s')
  if (!rows) return notRun('could not read the commit log')
  const max = budget(root, 'maxMergeBranchCommits', 10)
  const allow = allowList(root)
  const hits = rows.filter(([hash, subject = '']) => /^Merge branch /.test(clean(subject)) && !allowed(allow, 'merge-commit-noise', hash, true))
  const f = hits.length > max ? hits.map(([hash, subject = '']) => `${hash.slice(0, 10)} "${snip(subject, 60)}"`) : []
  return finish('merge-commit-noise', f, `${hits.length} "Merge branch" commit(s) in the last ${rows.length} (budget ${max})`)
}

// ---- large-commits: no commit in the last 200 touches more files than the budget
function largeCommits(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const out = git(root, ['log', '-n200', '--no-merges', '--name-only', '--format=%x1e%H%x1f%s'])
  if (out === null) return notRun('could not read the commit log')
  const max = budget(root, 'maxFilesPerCommit', 200)
  const allow = allowList(root)
  const f = []
  for (const rec of out.split('\x1e').slice(1)) {
    const [head = '', ...files] = rec.replace(/^\n+/, '').split('\n')
    const [hash = '', subject = ''] = head.split('\x1f')
    const n = files.filter((x) => x.trim()).length
    if (n > max && !allowed(allow, 'large-commits', hash, true)) f.push(`${hash.slice(0, 10)} "${snip(subject, 50)}" touches ${n} files (budget ${max})`)
  }
  return finish('large-commits', f, `no commit in the last 200 touches more than ${max} files`)
}

// ---- binary-in-history: blobs over the size budget that the last 200 commits added (objects not reachable from 200 commits back)
function binaryInHistory(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const max = budget(root, 'maxBlobKb', 1024)
  const base = git(root, ['rev-parse', '--verify', '-q', 'HEAD~200'])?.trim()
  const listing = git(root, ['rev-list', '--objects', 'HEAD', ...(base ? [`^${base}`] : [])])
  if (listing === null) return notRun('could not list the objects in the history')
  const paths = new Map()
  for (const line of listing.split('\n')) {
    if (!line) continue
    const sp = line.indexOf(' ')
    const sha = sp < 0 ? line : line.slice(0, sp)
    if (!paths.has(sha)) paths.set(sha, sp < 0 ? '' : line.slice(sp + 1))
  }
  const types = git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], `${[...paths.keys()].join('\n')}\n`)
  if (types === null) return notRun('could not read the object sizes')
  const allow = allowList(root)
  const seen = new Set()
  const f = []
  for (const line of types.split('\n')) {
    const [sha, type, size] = line.split(' ')
    if (type !== 'blob' || Number(size) <= max * 1024) continue
    const path = clean(paths.get(sha) || sha.slice(0, 10))
    if (seen.has(path) || allowed(allow, 'binary-in-history', path)) continue
    seen.add(path)
    f.push(`${path} is ${Math.round(Number(size) / 1024)} KB (budget ${max} KB) and was added in the last 200 commits`)
  }
  return finish('binary-in-history', f, `no file over ${max} KB was added in the last 200 commits`)
}

// ---- long-lived-branches: remote branches with no commit for N days. Informational (passes, lists them) unless git.failStaleBranches is true.
function longLivedBranches(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const out = git(root, ['for-each-ref', '--format=%(refname)%09%(committerdate:unix)', 'refs/remotes'])
  if (out === null) return notRun('could not list the remote branches')
  const days = budget(root, 'staleBranchDays', 180)
  const enforce = budget(root, 'failStaleBranches', false) === true
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400
  const allow = allowList(root)
  const stale = out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [ref = '', when = ''] = l.split('\t')
      return { name: ref.replace(/^refs\/remotes\//, ''), when: Number(when) }
    })
    .filter((b) => !b.name.endsWith('/HEAD') && b.when < cutoff && !allowed(allow, 'long-lived-branches', b.name))
  const lines = stale.map((b) => `${clean(b.name)} last committed ${new Date(b.when * 1000).toISOString().slice(0, 10)}`)
  if (enforce) return finish('long-lived-branches', lines, `no remote branch is older than ${days} days`)
  if (!lines.length) {
    console.log(`long-lived-branches: no remote branch is older than ${days} days`)
    return 0
  }
  console.log(`long-lived-branches: ${lines.length} remote branch(es) with no commit in ${days} days (informational, passes; set git.failStaleBranches to fail on them)`)
  for (const l of lines.slice(0, 25)) console.log(`  ${l}`)
  if (lines.length > 25) console.log(`  ... and ${lines.length - 25} more`)
  return 0
}

// ---- branch-names: local branches are lowercase kebab-case, with / between parts
const KEBAB_PATH = /^[a-z0-9]+(?:[-.][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-.][a-z0-9]+)*)*$/
function branchNames(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const out = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  if (out === null) return notRun('could not list the local branches')
  const allow = allowList(root)
  const f = out
    .split('\n')
    .map((n) => n.trim())
    .filter((n) => n && !KEBAB_PATH.test(n) && !allowed(allow, 'branch-names', n))
    .map((n) => `local branch "${clean(n)}" is not lowercase kebab-case (dots allowed in version parts) with / separators`)
  return finish('branch-names', f, 'every local branch is lowercase kebab-case with / separators')
}

// ---- tags-semver: a tag that looks like a version must be vX.Y.Z (date tags such as 2026-10-31 are ignored)
const TAG_SEMVER = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const looksLikeVersion = (t) => /^v?\d/i.test(t) && !/^\d{4}-\d{2}-\d{2}/.test(t)
function tagsSemver(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const out = git(root, ['tag', '--list'])
  if (out === null) return notRun('could not list the tags')
  const allow = allowList(root)
  const tags = out.split('\n').map((t) => t.trim()).filter(Boolean)
  const f = tags
    .filter((t) => looksLikeVersion(t) && !TAG_SEMVER.test(t) && !allowed(allow, 'tags-semver', t))
    .map((t) => `tag "${clean(t)}" looks like a version but is not vX.Y.Z (for example v1.2.3)`)
  return finish('tags-semver', f, `every version-like tag is vX.Y.Z (${tags.length} tag(s) listed)`)
}

// ---- changelog-updated: source changed since the latest tag, so CHANGELOG.md should have changed too. NOT RUN without a tag.
const SOURCE_FILE = /\.(m?[jt]sx?|cjs|py|rs|go|rb|php|java|cs|kt|swift|dart|svelte|vue)$/i
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$/i
function changelogUpdated(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const tag = latestTag(root)
  if (!tag) return notRun('no tag is reachable from HEAD, so there is no release to compare the changelog with')
  const diff = git(root, ['diff', '--name-only', tag, 'HEAD'])
  if (diff === null) return notRun(`could not compare the tree with ${clean(tag)}`)
  const changed = diff.split('\n').filter(Boolean)
  const src = changed.filter((f) => SOURCE_FILE.test(f) && !TEST_FILE.test(f))
  const allow = allowList(root)
  const f = []
  if (src.length && !changed.includes('CHANGELOG.md') && !allowed(allow, 'changelog-updated', tag)) {
    f.push(`CHANGELOG.md did not change since ${clean(tag)}, but ${src.length} source file(s) did (for example ${snip(src[0])})`)
  }
  return finish('changelog-updated', f, `CHANGELOG.md is up to date with the source since ${clean(tag)}`)
}

// ---- version-tag-match: package.json version equals the latest tag. NOT RUN unless both exist.
function versionTagMatch(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const tag = latestTag(root)
  if (!tag) return notRun('no tag is reachable from HEAD, so there is no release to compare the version with')
  const pkg = readText(root, 'package.json')
  if (!pkg) return notRun('there is no package.json at the root to compare with the tag')
  let version
  try {
    version = JSON.parse(pkg).version
  } catch {
    return notRun('package.json does not parse, so its version is unknown')
  }
  if (typeof version !== 'string') return notRun('package.json has no version field')
  if (!/^v?\d/i.test(tag)) return notRun(`the latest tag "${snip(tag)}" is not a version`)
  const allow = allowList(root)
  if (version === tag.replace(/^v/i, '') || allowed(allow, 'version-tag-match', tag)) {
    return finish('version-tag-match', [], `package.json version ${clean(version)} matches the latest tag ${clean(tag)}`)
  }
  return finish('version-tag-match', [`package.json says ${clean(version)} but the latest tag is ${clean(tag)}`])
}

// ---- author-identity: no empty author name, no placeholder email (root@localhost, user@example.com, unknown, ...), in the last 200
const PLACEHOLDER_EMAIL = /^(unknown|none|null|root@localhost|user@localhost|.*@localhost|.*@example\.(com|org|net))$/i
function authorIdentity(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const rows = recent(root, 200, '%H%x1f%an%x1f%ae')
  if (!rows) return notRun('could not read the commit log')
  const allow = allowList(root)
  const groups = new Map()
  for (const [hash, name = '', email = ''] of rows) {
    const n = clean(name)
    const e = clean(email)
    if (allowed(allow, 'author-identity', e)) continue
    const emptyName = !n
    const placeholder = !e || PLACEHOLDER_EMAIL.test(e)
    if (!emptyName && !placeholder) continue
    const key = `${n}\x1f${e}`
    if (!groups.has(key)) groups.set(key, { n, e, count: 0, first: hash.slice(0, 10), emptyName, placeholder })
    groups.get(key).count++
  }
  const f = [...groups.values()].map((g) => {
    const what = g.placeholder ? 'a placeholder identity' : 'an empty author name'
    return `${g.count} commit(s) in the last 200 (first ${g.first}) authored as "${g.n}" <${g.e}>: ${what}`
  })
  return finish('author-identity', f, 'recent commits have a real author name and email')
}

// ---- signed-commits-info: share of recent commits that carry a signature. Passes unless git.requireSigned is true.
function signedCommitsInfo(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const rows = recent(root, 200, '%H%x1f%G?%x1f%h')
  if (!rows) return notRun('could not read the commit log')
  const unsigned = rows.filter(([, status = 'N']) => status === 'N' || status === 'B')
  const signed = rows.length - unsigned.length
  const allow = allowList(root)
  if (budget(root, 'requireSigned', false) !== true) {
    console.log(`signed-commits-info: ${signed} of ${rows.length} commits in the last 200 are signed (${Math.round((100 * signed) / rows.length)}%). Informational: passes unless git.requireSigned is true.`)
    return 0
  }
  const f = unsigned
    .filter(([hash]) => !allowed(allow, 'signed-commits-info', hash, true))
    .map(([, , short = hash]) => `${short} is not signed, or its signature does not verify`)
  return finish('signed-commits-info', f, `every one of the last ${rows.length} commits is signed`)
}

// ---- gitmodules-pinned: submodule urls use https; a submodule that follows a branch must have a commit pinned in the index
function gitmodulesPinned(root) {
  const skip = gate(root)
  if (skip !== null) return skip
  const text = readText(root, '.gitmodules')
  if (!text.trim()) {
    console.log('gitmodules-pinned: the repository has no submodules')
    return 0
  }
  const subs = []
  let cur = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const head = /^\[submodule\s+"([^"]+)"\]$/.exec(line)
    if (head) {
      cur = { name: head[1] }
      subs.push(cur)
      continue
    }
    const kv = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line)
    if (cur && kv) cur[kv[1].toLowerCase()] = kv[2].trim()
  }
  const allow = allowList(root)
  const f = []
  for (const s of subs) {
    if (s.url && /^http:\/\//i.test(s.url) && !allowed(allow, 'gitmodules-pinned', s.url)) {
      f.push(`submodule "${clean(s.name)}" uses http, not https: ${clean(s.url)}`)
    }
    if (s.branch && s.path && !allowed(allow, 'gitmodules-pinned', s.path)) {
      const pinned = /^160000 /m.test(git(root, ['ls-files', '-s', '--', s.path]) ?? '')
      if (!pinned) f.push(`submodule "${clean(s.name)}" follows branch "${clean(s.branch)}" and has no commit pinned at ${clean(s.path)}`)
    }
  }
  return finish('gitmodules-pinned', f, `${subs.length} submodule(s): https urls, and every branch-tracking one is pinned`)
}

// ---- fixtures: a throwaway repository. A build that fails reports NOT RUN, never a pass or a finding.
const sh = (dir, args, env = {}) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } })

function commit(dir, message, { files = {}, email = 'fixture@example.test', date } = {}) {
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body)
  }
  sh(dir, ['add', '-A'])
  const env = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}
  sh(dir, ['-c', 'user.name=Fixture', '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '--allow-empty-message', '-m', message], env)
}

const budgetFile = (git) => ({ '.meerkat-budgets.json': JSON.stringify({ git }) })

async function repoFixture(build, run) {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-git-'))
  try {
    sh(dir, ['init', '-q', '-b', 'main'])
    build(dir)
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    return notRun(`could not build the fixture repository: ${clean(e.message).slice(0, 200)}`)
  }
  try {
    return await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const fx = (build, run) => () => repoFixture(build, run)

const OLD = `${Math.floor((Date.now() - 400 * 86400e3) / 1000)} +0000`
const MANY = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}.txt`, `${i}\n`]))

main({
  'commit-message-format': {
    run: commitMessageFormat,
    fixture: fx((d) => {
      commit(d, 'Add the first file', { files: { 'a.js': '1\n' } })
      commit(d, 'WIP: this subject line is far too long for the seventy two character limit of git.')
      commit(d, 'Tidy the module.')
    }, commitMessageFormat),
  },
  'merge-commit-noise': {
    run: mergeCommitNoise,
    fixture: fx((d) => {
      commit(d, 'Add the first file', { files: { 'a.js': '1\n', ...budgetFile({ maxMergeBranchCommits: 0 }) } })
      commit(d, "Merge branch 'feature' into main")
    }, mergeCommitNoise),
  },
  'large-commits': {
    run: largeCommits,
    fixture: fx((d) => commit(d, 'Add many files', { files: MANY }), largeCommits),
  },
  'binary-in-history': {
    run: binaryInHistory,
    fixture: fx((d) => commit(d, 'Add the logo', { files: { 'logo.bin': Buffer.alloc(2 * 1024 * 1024, 1) } }), binaryInHistory),
  },
  'long-lived-branches': {
    run: longLivedBranches,
    fixture: fx((d) => {
      commit(d, 'Add the first file', { date: OLD, files: { 'a.js': '1\n', ...budgetFile({ failStaleBranches: true }) } })
      sh(d, ['update-ref', 'refs/remotes/origin/old-feature', 'HEAD'])
    }, longLivedBranches),
  },
  'branch-names': {
    run: branchNames,
    fixture: fx((d) => {
      commit(d, 'Add the first file', { files: { 'a.js': '1\n' } })
      sh(d, ['branch', 'Feature_X'])
    }, branchNames),
  },
  'tags-semver': {
    run: tagsSemver,
    fixture: fx((d) => {
      commit(d, 'Add the first file', { files: { 'a.js': '1\n' } })
      sh(d, ['tag', 'v1.2'])
    }, tagsSemver),
  },
  'changelog-updated': {
    run: changelogUpdated,
    fixture: fx((d) => {
      commit(d, 'Add the source', { files: { 'src/a.js': 'export const a = 1\n' } })
      sh(d, ['tag', 'v1.0.0'])
      commit(d, 'Change the source', { files: { 'src/b.js': 'export const b = 2\n' } })
    }, changelogUpdated),
  },
  'version-tag-match': {
    run: versionTagMatch,
    fixture: fx((d) => {
      commit(d, 'Add the package', { files: { 'package.json': '{"name":"x","version":"1.0.0"}\n' } })
      sh(d, ['tag', 'v1.0.0'])
      commit(d, 'Bump the version', { files: { 'package.json': '{"name":"x","version":"1.0.1"}\n' } })
    }, versionTagMatch),
  },
  'author-identity': {
    run: authorIdentity,
    fixture: fx((d) => commit(d, 'Add the first file', { email: 'root@localhost', files: { 'a.js': '1\n' } }), authorIdentity),
  },
  'signed-commits-info': {
    run: signedCommitsInfo,
    fixture: fx((d) => commit(d, 'Add the first file', { files: { 'a.js': '1\n', ...budgetFile({ requireSigned: true }) } }), signedCommitsInfo),
  },
  'gitmodules-pinned': {
    run: gitmodulesPinned,
    fixture: fx((d) => commit(d, 'Add the submodule', {
      files: { '.gitmodules': '[submodule "lib/x"]\n\tpath = lib/x\n\turl = http://example.test/x.git\n\tbranch = main\n' },
    }), gitmodulesPinned),
  },
})
