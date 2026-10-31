// Monorepo consistency and publish readiness: workspaces, npm, PyPI, crates.io and versions that must agree. Reads only the files git
// tracks (plus a stat of a build output path). Run through the packaging pack, or by hand:
//   node thorough/packaging.mjs <check> [--root <dir>]      node thorough/packaging.mjs <check> --fixtures   (must exit 1)
// Settings in .meerkat-budgets.json under "packaging": requireAligned and requireProvenance (both false by default, so those two only report).
// A finding you accept goes in .meerkat-packaging-allow, one "check-id path" per line.
import { existsSync } from 'node:fs'
import { join, posix } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const SKIP = /(^|\/)(node_modules|dist|build|vendor|target)\//i
const JUNK = /(^|\/)(tests?|__tests__|__fixtures__|fixtures?|__snapshots__|coverage|\.cache)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)\.env(\.|$)/i

const cfg = (root) => readBudgets(root)?.packaging ?? {}
const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

// Tracked files, cached per folder. "raw" keeps fixture folders (a package that would publish tests is the point of npm-pack-junk).
const rawCache = new Map()
const raw = (root) => {
  if (!rawCache.has(root)) rawCache.set(root, trackedFiles(root).filter((x) => !SKIP.test(x)))
  return rawCache.get(root)
}
const tracked = (root) => raw(root).filter((x) => !isFixture(x))
const trackedSet = (root) => new Set(tracked(root))
const files = (root, re) => tracked(root).filter((x) => re.test(x))
const named = (root, name) => files(root, new RegExp(`(^|/)${esc(name)}$`))
const dirOf = (x) => (posix.dirname(x) === '.' ? '' : posix.dirname(x))
const at = (dir, name) => (dir ? `${dir}/${name}` : name)
const json = (root, x) => {
  try {
    return JSON.parse(readText(root, x))
  } catch {
    return null
  }
}

// "check-id path" lines the project accepts on purpose.
const allowed = (root) =>
  new Set(
    readText(root, '.meerkat-packaging-allow')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split(/\s+/).slice(0, 2).join(' ')),
  )

// Findings are {path, msg}. An allowed path drops out before the count.
const report = (id, root, items, note) => {
  const ok = allowed(root)
  return finish(id, items.filter((i) => !ok.has(`${id} ${i.path}`)).map((i) => i.msg), note)
}

// Checks that only report unless the budget (packaging.<key>) makes them fail.
const soft = (id, root, key, items, why, note) => {
  const ok = allowed(root)
  const kept = items.filter((i) => !ok.has(`${id} ${i.path}`))
  if (!kept.length) {
    console.log(`${id}: ${note}`)
    return 0
  }
  if (cfg(root)[key] === true) return finish(id, kept.map((i) => i.msg), note)
  console.log(`${id}: ${kept.length} ${why} (informational; set packaging.${key} to true in .meerkat-budgets.json to fail on them)`)
  for (const i of kept.slice(0, 20)) console.log(`  ${i.msg}`)
  if (kept.length > 20) console.log(`  ... and ${kept.length - 20} more`)
  return 0
}

const na = (id, why) => {
  console.log(`${id}: not applicable: ${why}`)
  return 0
}

// A small TOML reader: the body text of each [table] (and [[table]]), keyed by its header with spaces removed.
const tomlSections = (text) => {
  const out = new Map()
  let name = null
  let body = []
  const flush = () => {
    if (name !== null) out.set(name, (out.get(name) ?? '') + body.join('\n'))
  }
  for (const line of text.split('\n')) {
    const m = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(line)
    if (m) {
      flush()
      name = m[1].replace(/\s+/g, '')
      body = []
    } else body.push(line)
  }
  flush()
  return out
}
const tomlKey = (section, key) => new RegExp(`^\\s*${esc(key)}(\\.workspace)?\\s*=`, 'm').test(section)
const tomlString = (section, key) => new RegExp(`^\\s*${esc(key)}\\s*=\\s*"([^"]+)"`, 'm').exec(section)?.[1] ?? null

// ---- workspaces: the root package.json's "workspaces" globs, matched against the folders git tracks

const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
const depsOf = (pkg) => DEP_KEYS.flatMap((kind) => Object.entries(pkg?.[kind] ?? {}).map(([name, spec]) => ({ name, spec: String(spec), kind })))

// Path-segment matching: "*" matches within one segment, "**" matches any number of segments.
const segMatch = (pat, seg) => new RegExp(`^${pat.split('*').map(esc).join('[^/]*')}$`).test(seg)
const pathMatch = (p, s) => {
  if (!p.length) return !s.length
  if (p[0] === '**') return pathMatch(p.slice(1), s) || (s.length > 0 && pathMatch(p, s.slice(1)))
  return s.length > 0 && segMatch(p[0], s[0]) && pathMatch(p.slice(1), s.slice(1))
}

// Null when the root declares no workspaces (so the project is not a monorepo).
const workspaces = (root) => {
  const declared = json(root, 'package.json')?.workspaces
  if (!declared) return null
  const globs = (Array.isArray(declared) ? declared : declared.packages ?? []).map(String)
  const dirs = new Set()
  for (const x of raw(root)) for (let d = dirOf(x); d; d = dirOf(d)) dirs.add(d)
  const withPkg = new Set(named(root, 'package.json').map(dirOf))
  const problems = []
  const included = new Set()
  for (const g of globs) {
    const neg = g.startsWith('!')
    const body = (neg ? g.slice(1) : g).replace(/^\.\//, '').replace(/\/+$/, '')
    const hits = [...dirs].filter((d) => pathMatch(body.split('/'), d.split('/')))
    if (neg) {
      for (const d of hits) included.delete(d)
      continue
    }
    if (!hits.length) problems.push({ path: 'package.json', msg: `package.json: workspace pattern "${g}" matches no folder` })
    for (const d of hits) {
      if (!withPkg.has(d)) problems.push({ path: at(d, 'package.json'), msg: `${at(d, 'package.json')}: workspace folder "${d}" (from "${g}") has no package.json` })
      else included.add(d)
    }
  }
  const members = []
  for (const d of included) {
    const file = at(d, 'package.json')
    const pkg = json(root, file)
    if (!pkg) problems.push({ path: file, msg: `${file}: package.json does not parse` })
    else members.push({ dir: d, file, pkg })
  }
  return { rootPkg: json(root, 'package.json'), members, problems }
}

const workspacesResolve = (root) => {
  const ws = workspaces(root)
  if (!ws) return na('workspaces-resolve', 'the root package.json declares no workspaces')
  return report('workspaces-resolve', root, ws.problems, 'every workspace pattern resolves to a folder with a package.json')
}

const workspaceNameUnique = (root) => {
  const ws = workspaces(root)
  if (!ws) return na('workspace-name-unique', 'the root package.json declares no workspaces')
  const byName = new Map()
  for (const m of ws.members) {
    if (typeof m.pkg.name !== 'string') continue
    byName.set(m.pkg.name, [...(byName.get(m.pkg.name) ?? []), m])
  }
  const items = []
  for (const [name, list] of byName) {
    if (list.length > 1) items.push({ path: list[0].file, msg: `"${name}" is the name of ${list.length} workspaces: ${list.map((m) => m.dir || '.').join(' and ')}` })
  }
  return report('workspace-name-unique', root, items, 'every workspace has its own package name')
}

const workspaceVersionAlignment = (root) => {
  const ws = workspaces(root)
  if (!ws) return na('workspace-version-alignment', 'the root package.json declares no workspaces')
  const siblings = new Set(ws.members.map((m) => m.pkg.name))
  const byDep = new Map()
  for (const m of ws.members) {
    for (const d of depsOf(m.pkg)) {
      if (!['dependencies', 'devDependencies'].includes(d.kind) || siblings.has(d.name)) continue
      if (!byDep.has(d.name)) byDep.set(d.name, new Map())
      const specs = byDep.get(d.name)
      specs.set(d.spec, [...(specs.get(d.spec) ?? []), m.dir || '.'])
    }
  }
  const items = []
  for (const [name, specs] of byDep) {
    if (specs.size < 2) continue
    const where = [...specs].map(([spec, dirs]) => `${spec} (${dirs.join(', ')})`).join(' vs ')
    items.push({ path: 'package.json', msg: `${name} is at different versions across workspaces: ${where}` })
  }
  return soft('workspace-version-alignment', root, 'requireAligned', items, 'dependencies at different versions across workspaces', 'every shared dependency names one version range')
}

// The version a range admits. True or false for the ranges this check reads (exact, ^ and ~), null for anything else.
const parseVersion = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v))
  return m ? m.slice(1).map(Number) : null
}
const cmpVersion = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}
const inRange = (spec, version) => {
  const v = parseVersion(version)
  if (!v) return null
  const exact = /^=?(\d+\.\d+\.\d+)$/.exec(spec)
  if (exact) return cmpVersion(v, parseVersion(exact[1])) === 0
  const m = /^([\^~])(\d+\.\d+\.\d+)$/.exec(spec)
  if (!m) return null
  const lo = parseVersion(m[2])
  if (cmpVersion(v, lo) < 0) return false
  let hi
  if (m[1] === '~') hi = [lo[0], lo[1] + 1, 0]
  else if (lo[0] > 0) hi = [lo[0] + 1, 0, 0]
  else if (lo[1] > 0) hi = [0, lo[1] + 1, 0]
  else hi = [0, 0, lo[2] + 1]
  return cmpVersion(v, hi) < 0
}

const workspaceInternalRanges = (root) => {
  const ws = workspaces(root)
  if (!ws) return na('workspace-internal-ranges', 'the root package.json declares no workspaces')
  const versions = new Map(ws.members.map((m) => [m.pkg.name, m.pkg.version]))
  const items = []
  for (const m of ws.members) {
    for (const d of depsOf(m.pkg)) {
      const v = versions.get(d.name)
      if (v === undefined || v === null) continue
      if (inRange(d.spec, v) === false) items.push({ path: m.file, msg: `${m.file}: ${m.pkg.name} depends on ${d.name} ${d.spec}, but that workspace is at ${v}` })
    }
  }
  return report('workspace-internal-ranges', root, items, 'every sibling dependency range admits the sibling version')
}

const workspaceCycles = (root) => {
  const ws = workspaces(root)
  if (!ws) return na('workspace-cycles', 'the root package.json declares no workspaces')
  const siblings = new Set(ws.members.map((m) => m.pkg.name))
  const fileOf = new Map(ws.members.map((m) => [m.pkg.name, m.file]))
  const graph = new Map()
  for (const m of ws.members) {
    graph.set(
      m.pkg.name,
      depsOf(m.pkg)
        .filter((d) => ['dependencies', 'devDependencies'].includes(d.kind) && siblings.has(d.name))
        .map((d) => d.name),
    )
  }
  const state = new Map()
  const stack = []
  const cycles = new Map()
  const visit = (n) => {
    state.set(n, 1)
    stack.push(n)
    for (const t of graph.get(n) ?? []) {
      if (state.get(t) === 1) {
        const loop = stack.slice(stack.indexOf(t))
        const key = [...loop].sort().join(',')
        if (!cycles.has(key)) cycles.set(key, [...loop, t])
      } else if (!state.get(t)) visit(t)
    }
    stack.pop()
    state.set(n, 2)
  }
  for (const n of graph.keys()) if (!state.get(n)) visit(n)
  const items = [...cycles.values()].map((path) => ({ path: fileOf.get(path[0]), msg: `circular dependency between workspaces: ${path.join(' -> ')}` }))
  return report('workspace-cycles', root, items, 'no workspaces depend on each other in a circle')
}

const rootPrivate = (root) => {
  const ws = workspaces(root)
  if (!ws) return na('root-private', 'the root package.json declares no workspaces')
  const items = ws.rootPkg?.private === true ? [] : [{ path: 'package.json', msg: 'package.json: the monorepo root is not "private": true, so npm could publish the root by mistake' }]
  return report('root-private', root, items, 'the monorepo root is marked private')
}

// ---- npm: packages that look publishable (not private, with an entry point)

const publishable = (root) =>
  named(root, 'package.json')
    .map((file) => ({ file, dir: dirOf(file), pkg: json(root, file) }))
    .filter((p) => p.pkg && p.pkg.private !== true && (p.pkg.main || p.pkg.module || p.pkg.bin || p.pkg.exports))
const NO_NPM = 'no package looks publishable (none is non-private with main, module, exports or bin)'

const npmPublishFiles = (root) => {
  const list = publishable(root)
  if (!list.length) return na('npm-publish-files', NO_NPM)
  const set = trackedSet(root)
  const items = list
    .filter((p) => !Array.isArray(p.pkg.files) && !set.has(at(p.dir, '.npmignore')))
    .map((p) => ({ path: p.file, msg: `${p.file}: publishable with no "files" field and no .npmignore, so npm publishes everything git does not ignore` }))
  return report('npm-publish-files', root, items, 'every publishable package says what to ship')
}

// Every entry point an npm package names: main, module, types, bin and the "./" targets of exports.
const entryTargets = (pkg) => {
  const out = []
  for (const k of ['main', 'module', 'types', 'typings']) if (typeof pkg[k] === 'string') out.push(pkg[k])
  if (typeof pkg.bin === 'string') out.push(pkg.bin)
  else if (pkg.bin && typeof pkg.bin === 'object') out.push(...Object.values(pkg.bin).filter((v) => typeof v === 'string'))
  const walk = (v) => {
    if (typeof v === 'string') {
      if (v.startsWith('./')) out.push(v)
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(pkg.exports)
  return out
}

const npmEntryExist = (root) => {
  const list = publishable(root)
  if (!list.length) return na('npm-entry-exist', NO_NPM)
  const set = trackedSet(root)
  const items = []
  for (const p of list) {
    for (const t of entryTargets(p.pkg)) {
      const rel = t.replace(/^\.\//, '')
      if (rel.includes('*')) continue
      const full = posix.normalize(at(p.dir, rel))
      // A target is fine when git tracks it, or when a build has already written it (a stat only, nothing is read).
      if (!set.has(full) && !existsSync(join(root, full))) items.push({ path: p.file, msg: `${p.file}: ${t} is neither tracked nor on disk (build it first, or fix the path)` })
    }
  }
  return report('npm-entry-exist', root, items, 'every npm entry point exists')
}

const npmPackJunk = (root) => {
  const list = publishable(root)
  if (!list.length) return na('npm-pack-junk', NO_NPM)
  const items = []
  for (const p of list) {
    if (Array.isArray(p.pkg.files)) {
      for (const e of p.pkg.files) {
        if (typeof e === 'string' && JUNK.test(e)) items.push({ path: p.file, msg: `${p.file}: "files" lists "${e}", so tests, fixtures or env files would be published` })
      }
      continue
    }
    const ignore = trackedSet(root).has(at(p.dir, '.npmignore')) ? readText(root, at(p.dir, '.npmignore')) : ''
    const covered = /tests?|fixtures?|\.env|\.test|\.spec|__tests__/i.test(ignore)
    const junk = raw(root).filter((x) => (p.dir ? x.startsWith(`${p.dir}/`) : true) && JUNK.test(x))
    if (junk.length && !covered) items.push({ path: p.file, msg: `${p.file}: no "files" list and no .npmignore that leaves them out, so ${junk.length} test or env file(s) would be published (first: ${junk[0]})` })
  }
  return report('npm-pack-junk', root, items, 'no publishable package would ship tests, fixtures or env files')
}

// ---- PyPI

const pyprojects = (root) => named(root, 'pyproject.toml')

const pypiMetadata = (root) => {
  const items = []
  let found = false
  for (const file of pyprojects(root)) {
    const sec = tomlSections(readText(root, file)).get('project')
    if (sec === undefined) continue
    found = true
    for (const k of ['name', 'version', 'description', 'readme', 'license', 'requires-python', 'classifiers']) {
      if (k === 'version' && /dynamic\s*=\s*\[[^\]]*"version"/.test(sec)) continue
      if (!tomlKey(sec, k)) items.push({ path: file, msg: `${file}: [project] has no ${k}` })
    }
  }
  if (!found) return na('pypi-metadata', 'no pyproject.toml has a [project] table')
  return report('pypi-metadata', root, items, 'every PyPI project has its metadata')
}

const pypiEntryPoints = (root) => {
  const pyprojectFiles = pyprojects(root).filter((f) => tomlSections(readText(root, f)).has('project'))
  if (!pyprojectFiles.length) return na('pypi-entry-points', 'no pyproject.toml has a [project] table')
  const set = trackedSet(root)
  const items = []
  for (const file of pyprojectFiles) {
    const dir = dirOf(file)
    const prefixes = [dir ? `${dir}/` : '', dir ? `${dir}/src/` : 'src/']
    for (const [h, body] of tomlSections(readText(root, file))) {
      if (!/^project\.(scripts|gui-scripts|entry-points)(\.|$)/.test(h)) continue
      for (const line of body.split('\n')) {
        const m = /^\s*"?[^=\s"]+"?\s*=\s*["']([\w.]+):/.exec(line)
        if (!m) continue
        const base = m[1].replace(/\./g, '/')
        const found = prefixes.some((pre) => [`${base}.py`, `${base}/__init__.py`].some((c) => set.has(pre + c)))
        if (!found) items.push({ path: file, msg: `${file}: entry point "${line.trim()}" names module ${m[1]}, which has no .py file in the repository` })
      }
    }
  }
  return report('pypi-entry-points', root, items, 'every script and entry point names a module that exists')
}

// ---- crates.io

const crateReady = (root) => {
  const crates = named(root, 'Cargo.toml')
    .map((file) => ({ file, secs: tomlSections(readText(root, file)) }))
    .filter((c) => c.secs.has('package'))
  if (!crates.length) return na('crate-publish-ready', 'no Cargo.toml has a [package] table')
  const items = []
  for (const c of crates) {
    const pkg = c.secs.get('package')
    if (/^\s*publish\s*=\s*false/m.test(pkg)) continue
    const missing = []
    for (const k of ['description', 'repository']) if (!tomlKey(pkg, k)) missing.push(k)
    if (!tomlKey(pkg, 'license') && !tomlKey(pkg, 'license-file')) missing.push('license')
    if (!['readme', 'documentation', 'homepage'].some((k) => tomlKey(pkg, k))) missing.push('readme, documentation or homepage')
    for (const m of missing) items.push({ path: c.file, msg: `${c.file}: [package] has no ${m}` })
    for (const [h, body] of c.secs) {
      if (h === 'dependencies' || h === 'build-dependencies') {
        for (const line of body.split('\n')) {
          const d = /^\s*([\w-]+)\s*=\s*\{([^}]*)\}/.exec(line)
          if (d && /\bpath\s*=/.test(d[2]) && !/\bversion\s*=/.test(d[2])) items.push({ path: c.file, msg: `${c.file}: dependency "${d[1]}" is path-only, so crates.io would refuse it` })
        }
      }
      const t = /^(?:build-)?dependencies\.([\w-]+)$/.exec(h)
      if (t && /\bpath\s*=/.test(body) && !/\bversion\s*=/.test(body)) items.push({ path: c.file, msg: `${c.file}: dependency "${t[1]}" is path-only, so crates.io would refuse it` })
    }
  }
  return report('crate-publish-ready', root, items, 'every published crate has its metadata and no path-only dependency')
}

// ---- versions that must agree within one folder

const normVersion = (v) =>
  String(v)
    .toLowerCase()
    .replace(/\+.*$/, '')
    .replace(/^v/, '')
    .replace(/[-._]?(alpha|beta|rc|post|dev|a|b|c)[-._]?/g, '$1')

const versionSync = (root) => {
  const byDir = new Map()
  const add = (file, kind, version) => {
    if (!version) return
    const d = dirOf(file)
    byDir.set(d, [...(byDir.get(d) ?? []), { file, kind, version: String(version) }])
  }
  for (const file of named(root, 'package.json')) {
    const v = json(root, file)?.version
    if (typeof v === 'string') add(file, 'package.json', v)
  }
  for (const file of named(root, 'Cargo.toml')) {
    const pkg = tomlSections(readText(root, file)).get('package')
    if (pkg !== undefined) add(file, 'Cargo.toml', tomlString(pkg, 'version'))
  }
  for (const file of pyprojects(root)) {
    const sec = tomlSections(readText(root, file)).get('project')
    if (sec !== undefined && !/dynamic\s*=\s*\[[^\]]*"version"/.test(sec)) add(file, 'pyproject.toml', tomlString(sec, 'version'))
  }
  for (const file of named(root, 'pubspec.yaml')) {
    add(file, 'pubspec.yaml', /^version:\s*['"]?([^\s'"]+)/m.exec(readText(root, file))?.[1])
  }
  const multi = [...byDir].filter(([, list]) => list.length > 1)
  if (!multi.length) return na('version-sync', 'no folder has two manifests that both carry a version')
  const items = []
  for (const [dir, list] of multi) {
    if (new Set(list.map((m) => normVersion(m.version))).size > 1) {
      items.push({ path: list[0].file, msg: `${dir || '.'}: the manifests disagree: ${list.map((m) => `${m.kind} says ${m.version}`).join(', ')}` })
    }
  }
  return report('version-sync', root, items, 'the manifests in each folder agree on the version')
}

// ---- release workflows

const provenanceHints = (root) => {
  const pubs = publishable(root)
  if (!pubs.length) return na('provenance-hints', NO_NPM)
  const release = files(root, /^\.github\/workflows\/[^/]+\.ya?ml$/).filter((f) => /\b(npm|pnpm)\s+publish\b|\byarn\s+npm\s+publish\b/.test(readText(root, f)))
  if (!release.length) return na('provenance-hints', 'no release workflow runs npm publish')
  if (pubs.every((p) => p.pkg.publishConfig?.provenance === true)) return na('provenance-hints', 'every publishable package sets publishConfig.provenance')
  const items = []
  for (const f of release) {
    const t = readText(root, f)
    const missing = []
    if (!/id-token:\s*write/.test(t)) missing.push('id-token: write')
    if (!/--provenance\b/.test(t)) missing.push('--provenance')
    if (missing.length) items.push({ path: f, msg: `${f}: the npm release has no ${missing.join(' and no ')}, so it gets no provenance attestation` })
  }
  return soft('provenance-hints', root, 'requireProvenance', items, 'npm release workflows without provenance', 'every npm release workflow asks for provenance')
}

// ---- fixtures: one deliberate violation per check, built in a throwaway folder
const J = (o) => `${JSON.stringify(o, null, 2)}\n`
const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })
const RELEASE_BAD = 'name: release\non: push\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n'
const PRIVATE_ROOT = (globs) => J({ name: 'mono', private: true, workspaces: globs })

main({
  'workspaces-resolve': {
    run: workspacesResolve,
    ...fx({ 'package.json': PRIVATE_ROOT(['packages/*', 'tools/missing']), 'packages/a/package.json': J({ name: 'a', version: '1.0.0' }) }, workspacesResolve),
  },
  'workspace-name-unique': {
    run: workspaceNameUnique,
    ...fx(
      { 'package.json': PRIVATE_ROOT(['packages/*']), 'packages/a/package.json': J({ name: 'dup', version: '1.0.0' }), 'packages/b/package.json': J({ name: 'dup', version: '1.0.0' }) },
      workspaceNameUnique,
    ),
  },
  'workspace-version-alignment': {
    run: workspaceVersionAlignment,
    ...fx(
      {
        '.meerkat-budgets.json': J({ packaging: { requireAligned: true } }),
        'package.json': PRIVATE_ROOT(['packages/*']),
        'packages/a/package.json': J({ name: 'a', version: '1.0.0', dependencies: { lodash: '4.17.0' } }),
        'packages/b/package.json': J({ name: 'b', version: '1.0.0', dependencies: { lodash: '^4.18.0' } }),
      },
      workspaceVersionAlignment,
    ),
  },
  'workspace-internal-ranges': {
    run: workspaceInternalRanges,
    ...fx(
      {
        'package.json': PRIVATE_ROOT(['packages/*']),
        'packages/a/package.json': J({ name: 'a', version: '1.0.0', dependencies: { b: '^2.0.0' } }),
        'packages/b/package.json': J({ name: 'b', version: '1.0.0' }),
      },
      workspaceInternalRanges,
    ),
  },
  'workspace-cycles': {
    run: workspaceCycles,
    ...fx(
      {
        'package.json': PRIVATE_ROOT(['packages/*']),
        'packages/a/package.json': J({ name: 'a', version: '1.0.0', dependencies: { b: '1.0.0' } }),
        'packages/b/package.json': J({ name: 'b', version: '1.0.0', dependencies: { a: '1.0.0' } }),
      },
      workspaceCycles,
    ),
  },
  'root-private': {
    run: rootPrivate,
    ...fx({ 'package.json': J({ name: 'mono', workspaces: ['packages/*'] }), 'packages/a/package.json': J({ name: 'a', version: '1.0.0' }) }, rootPrivate),
  },
  'npm-publish-files': {
    run: npmPublishFiles,
    ...fx({ 'package.json': J({ name: 'solo', version: '1.0.0', main: 'index.js' }), 'index.js': 'module.exports = 1\n' }, npmPublishFiles),
  },
  'npm-entry-exist': {
    run: npmEntryExist,
    ...fx({ 'package.json': J({ name: 'solo', version: '1.0.0', main: 'lib/missing.js', files: ['lib'] }), 'index.js': 'module.exports = 1\n' }, npmEntryExist),
  },
  'npm-pack-junk': {
    run: npmPackJunk,
    ...fx(
      {
        'package.json': J({ name: 'solo', version: '1.0.0', main: 'index.js', files: ['index.js', 'tests/'] }),
        'index.js': 'module.exports = 1\n',
        'tests/a.test.js': "test('a', () => {})\n",
      },
      npmPackJunk,
    ),
  },
  'pypi-metadata': {
    run: pypiMetadata,
    ...fx({ 'pyproject.toml': '[build-system]\nrequires = ["setuptools"]\n\n[project]\nname = "tool"\nversion = "1.0.0"\n' }, pypiMetadata),
  },
  'pypi-entry-points': {
    run: pypiEntryPoints,
    ...fx(
      {
        'pyproject.toml':
          '[project]\nname = "tool"\nversion = "1.0.0"\n\n[project.scripts]\ntool = "tool.cli:main"\n',
      },
      pypiEntryPoints,
    ),
  },
  'crate-publish-ready': {
    run: crateReady,
    ...fx({ 'Cargo.toml': '[package]\nname = "crate"\nversion = "0.1.0"\nedition = "2021"\n' }, crateReady),
  },
  'version-sync': {
    run: versionSync,
    ...fx(
      {
        'package.json': J({ name: 'solo', version: '1.0.0', main: 'index.js' }),
        'Cargo.toml': '[package]\nname = "solo"\nversion = "1.0.1"\n',
      },
      versionSync,
    ),
  },
  'provenance-hints': {
    run: provenanceHints,
    ...fx(
      {
        '.meerkat-budgets.json': J({ packaging: { requireProvenance: true } }),
        'package.json': J({ name: 'solo', version: '1.0.0', main: 'index.js' }),
        'index.js': 'module.exports = 1\n',
        '.github/workflows/release.yml': RELEASE_BAD,
      },
      provenanceHints,
    ),
  },
})
