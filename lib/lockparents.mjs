// Who pulls a package in? Reads a package-lock.json (v2/v3 "packages", or the v1 "dependencies" tree) and answers, for any locked package, whether the
// project depends on it directly or which direct dependency brings it in. Used by the lockfile findings (deprecated-deps, wh-supply) so a finding about a
// package nobody chose says who to talk to. When the lockfile does not make the parent clear the answer is "transitive, parent unknown", never a guess.

const NODE_MODULES = 'node_modules/'
const nameOfKey = (key) => (key.includes(NODE_MODULES) ? key.slice(key.lastIndexOf(NODE_MODULES) + NODE_MODULES.length) : key)
const DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

// v1 trees ("dependencies" nested, "requires" for the edges) are rewritten as v2-style keyed entries so one walker serves both.
function flattenV1(deps, prefix, out) {
  for (const [name, d] of Object.entries(deps ?? {})) {
    if (!d || typeof d !== 'object') continue
    const key = `${prefix}${NODE_MODULES}${name}`
    out[key] = { version: d.version, dependencies: d.requires && typeof d.requires === 'object' ? d.requires : undefined, dev: d.dev, deprecated: d.deprecated, resolved: d.resolved, integrity: d.integrity }
    flattenV1(d.dependencies, `${key}/`, out)
  }
}

// Node's resolution: the dependency D of the package at key K is the nearest node_modules/D going up from K.
function resolve(packages, fromKey, dep) {
  let base = fromKey
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}${NODE_MODULES}${dep}`
    if (candidate in packages) return candidate
    if (!base) return null
    const i = base.lastIndexOf(`/${NODE_MODULES}`)
    base = i < 0 ? '' : base.slice(0, i)
  }
}

// lockText: the lockfile's text. pkgText: the sibling package.json (needed to know the direct dependencies of a v1 lockfile; optional otherwise).
export function lockGraph(lockText, pkgText = null) {
  let j
  try { j = JSON.parse(lockText) } catch { return null }
  if (!j || typeof j !== 'object') return null
  let packages
  if (j.packages && typeof j.packages === 'object') packages = { ...j.packages }
  else if (j.dependencies && typeof j.dependencies === 'object') {
    packages = {}
    flattenV1(j.dependencies, '', packages)
  } else return null
  let rootDeps = null
  if (packages['']) rootDeps = { ...(packages[''].dependencies ?? {}), ...(packages[''].devDependencies ?? {}), ...(packages[''].optionalDependencies ?? {}), ...(packages[''].peerDependencies ?? {}) }
  else if (pkgText) {
    try {
      const p = JSON.parse(pkgText)
      rootDeps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}), ...(p.optionalDependencies ?? {}), ...(p.peerDependencies ?? {}) }
    } catch { /* unreadable package.json */ }
  }
  const direct = new Set()
  // reverse edges: target key -> set of parent keys ('' is the project itself)
  const parents = new Map()
  const add = (target, from) => parents.set(target, (parents.get(target) ?? new Set()).add(from))
  let edges = 0
  for (const name of Object.keys(rootDeps ?? {})) {
    const t = resolve(packages, '', name)
    if (t) { direct.add(t); add(t, ''); edges++ }
  }
  for (const [key, p] of Object.entries(packages)) {
    if (key === '' || !p || typeof p !== 'object') continue
    for (const field of DEP_FIELDS) {
      for (const dep of Object.keys(p[field] ?? {})) {
        const t = resolve(packages, key, dep)
        if (t) { add(t, key); edges++ }
      }
    }
  }
  const label = (key) => {
    const p = packages[key]
    return p?.version ? `${nameOfKey(key)}@${p.version}` : nameOfKey(key)
  }
  // A path from a direct dependency down to `key` (shortest, found breadth first), as keys. null when the lockfile shows none.
  const pathTo = (key) => {
    const seen = new Set([key])
    let level = [[key]]
    while (level.length) {
      const next = []
      for (const path of level) {
        const head = path[0]
        if (direct.has(head)) return path
        for (const parent of parents.get(head) ?? []) {
          if (parent === '' || seen.has(parent)) continue
          seen.add(parent)
          next.push([parent, ...path])
        }
      }
      level = next
    }
    return null
  }
  return { packages, direct, edges, rootDeps, label, pathTo, hasKey: (k) => k in packages }
}

// The words for a finding: "a direct dependency", "transitive, pulled in by foo (foo > glob > rimraf)", or "transitive, parent unknown".
// `key` is the lockfile key (node_modules/rimraf, node_modules/foo/node_modules/rimraf); `graph` comes from lockGraph.
export function parentNote(graph, key) {
  if (!graph || !graph.hasKey(key)) return 'transitive, parent unknown'
  if (graph.direct.has(key)) return 'a direct dependency'
  if (!graph.rootDeps || !graph.edges) return 'transitive, parent unknown'
  const path = graph.pathTo(key)
  if (!path) return 'transitive, parent unknown'
  const names = path.map((k) => nameOfKey(k))
  return `transitive, pulled in by ${names[0]} (${names.join(' > ')})`
}

export { nameOfKey }
