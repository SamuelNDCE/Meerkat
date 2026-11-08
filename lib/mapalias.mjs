// Resolves non-relative JS and TS imports through the project's own configuration, so they are not all "unresolved":
// tsconfig/jsconfig `paths` and `baseUrl` (with `extends`), and workspace packages (package.json `workspaces`, pnpm-workspace.yaml,
// and a package's `exports`, `module`, `main`). Reads the config text the scan already cached. Nothing is run; nothing is guessed:
// a workspace package whose source file cannot be found stays unresolved with the reason.
import { posix } from 'node:path'

const norm = (p) => {
  const n = posix.normalize(p || '.')
  return n === '.' ? '' : n.replace(/\/$/, '')
}
const dirOf = (p) => (posix.dirname(p) === '.' ? '' : posix.dirname(p))
const j = (...a) => norm(a.filter((x) => x !== '' && x != null).join('/'))

export function stripJsonc(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '"') {
      let k = i + 1
      while (k < n && text[k] !== '"') k += text[k] === '\\' ? 2 : 1
      out += text.slice(i, k + 1)
      i = k + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const k = text.indexOf('*/', i + 2)
      i = k < 0 ? n : k + 2
    } else {
      out += c
      i++
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export const parseJsonc = (text) => {
  try {
    return JSON.parse(stripJsonc(String(text).replace(/^\uFEFF/, '')))
  } catch {
    return null
  }
}

const globToRe = (pat) => new RegExp(`^${pat.split('**').map((seg) => seg.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`)

// entries: Map path -> { rec }. Returns (fromPath, spec) => resolution | null.
export function buildAliasResolver({ entries, allPaths, has, candidates }) {
  const configs = new Map()
  const packages = new Map()
  const pnpm = []
  for (const [p, e] of entries) {
    if (e.rec?.cfg !== undefined) configs.set(p, e.rec.cfg)
    if (e.rec?.pkg !== undefined) {
      const doc = parseJsonc(e.rec.pkg)
      if (doc && typeof doc === 'object') packages.set(p, doc)
    }
    if (e.rec?.pnpm !== undefined) pnpm.push([p, e.rec.pnpm])
  }

  // ---- tsconfig ----
  const loaded = new Map()
  const loadCfg = (path, depth = 0) => {
    if (loaded.has(path)) return loaded.get(path)
    const empty = { baseUrl: null, paths: null, pathsDir: null, from: path }
    loaded.set(path, empty)
    const doc = parseJsonc(configs.get(path))
    if (!doc || typeof doc !== 'object') return empty
    let res = { ...empty }
    if (typeof doc.extends === 'string' && doc.extends.startsWith('.') && depth < 8) {
      const base = j(dirOf(path), doc.extends)
      const hit = [base, `${base}.json`].find((c) => configs.has(c))
      if (hit) res = { ...loadCfg(hit, depth + 1) }
    }
    const co = doc.compilerOptions ?? {}
    if (typeof co.baseUrl === 'string') res.baseUrl = j(dirOf(path), co.baseUrl)
    if (co.paths && typeof co.paths === 'object') {
      res.paths = co.paths
      res.pathsDir = dirOf(path)
    }
    res.from = path
    loaded.set(path, res)
    return res
  }
  const cfgPaths = [...configs.keys()].sort((a, b) => b.split('/').length - a.split('/').length)
  const cfgFor = new Map()
  const configOf = (from) => {
    const d = dirOf(from)
    if (cfgFor.has(d)) return cfgFor.get(d)
    let hit = null
    for (const c of cfgPaths) {
      const cd = dirOf(c)
      if (cd !== '' && d !== cd && !d.startsWith(`${cd}/`)) continue
      const cfg = loadCfg(c)
      if (cfg.baseUrl !== null || cfg.paths) {
        hit = cfg
        break
      }
    }
    cfgFor.set(d, hit)
    return hit
  }
  const viaTs = (from, spec) => {
    const cfg = configOf(from)
    if (!cfg) return null
    if (cfg.paths) {
      const keys = Object.keys(cfg.paths).sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length)
      for (const pat of keys) {
        const star = pat.indexOf('*')
        let sub = ''
        if (star < 0) {
          if (spec !== pat) continue
        } else {
          const pre = pat.slice(0, star)
          const suf = pat.slice(star + 1)
          if (!spec.startsWith(pre) || !spec.endsWith(suf) || spec.length < pre.length + suf.length) continue
          sub = spec.slice(pre.length, spec.length - suf.length)
        }
        const targets = Array.isArray(cfg.paths[pat]) ? cfg.paths[pat] : []
        for (const t of targets) {
          const cand = j(cfg.baseUrl ?? cfg.pathsDir ?? '', String(t).replace('*', sub))
          for (const c of candidates(cand)) if (has(c)) return { status: 'local', target: c, via: 'tsconfig-paths', note: `via tsconfig paths in ${cfg.from}` }
        }
      }
    }
    if (cfg.baseUrl !== null && !spec.startsWith('.')) {
      for (const c of candidates(j(cfg.baseUrl, spec))) if (has(c)) return { status: 'local', target: c, via: 'baseUrl', note: `via baseUrl in ${cfg.from}` }
    }
    return null
  }

  // ---- workspace packages ----
  const patterns = []
  const negations = []
  const addPattern = (dir, pat) => {
    const neg = pat.startsWith('!')
    const full = j(dir, (neg ? pat.slice(1) : pat).replace(/^\.\//, '').replace(/\/$/, ''))
    ;(neg ? negations : patterns).push(globToRe(full))
  }
  for (const [p, doc] of packages) {
    const w = Array.isArray(doc.workspaces) ? doc.workspaces : Array.isArray(doc.workspaces?.packages) ? doc.workspaces.packages : []
    for (const pat of w) if (typeof pat === 'string') addPattern(dirOf(p), pat)
  }
  for (const [p, text] of pnpm) {
    let inList = false
    for (const line of String(text).split('\n')) {
      if (/^packages\s*:/.test(line)) inList = true
      else if (/^\S/.test(line)) inList = false
      else if (inList) {
        const m = line.match(/^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*(?:#.*)?$/)
        if (m) addPattern(dirOf(p), m[1])
      }
    }
  }
  const workspace = new Map()
  if (patterns.length) {
    for (const [p, doc] of packages) {
      const d = dirOf(p)
      if (typeof doc.name === 'string' && patterns.some((r) => r.test(d)) && !negations.some((r) => r.test(d))) workspace.set(doc.name, { dir: d, doc, file: p })
    }
  }
  const pickTarget = (v) => {
    if (typeof v === 'string') return [v]
    if (Array.isArray(v)) return v.flatMap(pickTarget)
    if (v && typeof v === 'object') {
      const order = ['types', 'import', 'module', 'default', 'require', 'node', 'browser']
      const keys = [...order.filter((k) => k in v), ...Object.keys(v).filter((k) => !order.includes(k) && !k.startsWith('.'))]
      return keys.flatMap((k) => pickTarget(v[k]))
    }
    return []
  }
  const fileForTarget = (dir, t) => {
    const rel = String(t).replace(/^\.\//, '').replace(/\.d\.([cm]?)ts$/, '')
    const tries = [j(dir, rel)]
    if (/^(?:dist|build|out|lib)\//.test(rel)) tries.push(j(dir, 'src', rel.replace(/^[^/]+\//, '')))
    for (const b of tries) for (const c of candidates(b)) if (has(c)) return c
    return null
  }
  const exportsFor = (ex, key) => {
    if (ex == null) return []
    if (typeof ex === 'string' || Array.isArray(ex)) return key === '.' ? pickTarget(ex) : []
    if (typeof ex !== 'object') return []
    const keys = Object.keys(ex)
    if (!keys.some((k) => k.startsWith('.'))) return key === '.' ? pickTarget(ex) : []
    if (key in ex) return pickTarget(ex[key])
    for (const k of keys) {
      const star = k.indexOf('*')
      if (star < 0 || !key.startsWith(k.slice(0, star)) || !key.endsWith(k.slice(star + 1))) continue
      const sub = key.slice(star, key.length - (k.length - star - 1))
      return pickTarget(ex[k]).map((t) => t.replace('*', sub))
    }
    return []
  }
  const viaWorkspace = (spec) => {
    if (!workspace.size) return null
    const parts = spec.split('/')
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    const pkg = workspace.get(name)
    if (!pkg) return null
    const subPath = spec.slice(name.length).replace(/^\//, '')
    const key = subPath ? `./${subPath}` : '.'
    const wanted = []
    for (const t of exportsFor(pkg.doc.exports, key)) wanted.push(t)
    if (!subPath) for (const k of ['module', 'main', 'types']) if (typeof pkg.doc[k] === 'string') wanted.push(pkg.doc[k])
    for (const t of wanted) {
      const f = fileForTarget(pkg.dir, t)
      if (f) return { status: 'local', target: f, via: 'workspace', note: `via workspace package ${name}` }
    }
    const direct = subPath ? [j(pkg.dir, subPath), j(pkg.dir, 'src', subPath)] : [j(pkg.dir, 'src', 'index'), j(pkg.dir, 'index')]
    for (const b of direct) for (const c of candidates(b)) if (has(c)) return { status: 'local', target: c, via: 'workspace', note: `via workspace package ${name}` }
    return { status: 'unresolved', target: null, reason: `workspace package ${name}: no source file found for ${subPath || 'its entry'} (built output is not mapped)` }
  }

  return (from, spec) => viaTs(from, spec) ?? viaWorkspace(spec)
}
