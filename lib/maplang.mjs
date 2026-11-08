// PowerShell and Rust support for the code map (lib/codemap.mjs). Regular expressions over comment-masked text, like the rest of the map.
// Nothing is run or imported. A purpose comes only from a leading comment (lib/mapparse.mjs), a reference only from a literal name or path.
import { posix } from 'node:path'

const blank = (s) => s.replace(/[^\n]/g, ' ')
const lineAtOffset = (text, offset) => text.slice(0, offset).split('\n').length
const dirOf = (p) => (posix.dirname(p) === '.' ? '' : posix.dirname(p))
const joinPath = (...parts) => posix.normalize(parts.filter(Boolean).join('/') || '.')

// ---- PowerShell ----

// Comments (# and <# #>) and here-string bodies are blanked; ordinary quoted strings are kept (module names and paths live there).
export function maskPs(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '<' && d === '#') {
      let j = text.indexOf('#>', i + 2)
      j = j < 0 ? n : j + 2
      out += blank(text.slice(i, j))
      i = j
    } else if (c === '#') {
      let j = text.indexOf('\n', i)
      if (j < 0) j = n
      out += blank(text.slice(i, j))
      i = j
    } else if (c === '@' && (d === '"' || d === "'") && /^[ \t]*\n/.test(text.slice(i + 2, i + 40))) {
      const close = text.indexOf(`\n${d}@`, i + 2)
      const j = close < 0 ? n : close + 3
      out += blank(text.slice(i, j))
      i = j
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && text[j] !== c) j += text[j] === '`' && c === '"' ? 2 : 1
      j = Math.min(j + 1, n)
      out += text.slice(i, j)
      i = j
    } else {
      out += c
      i += 1
    }
  }
  return out
}

// The parameter names of a param block. `from` is the offset just after the opening parenthesis. A name is taken at the start of the
// block or after a top-level comma, never from a default value.
function paramNames(masked, from) {
  const names = []
  let depth = 1
  let expecting = true
  let i = from
  while (i < masked.length && depth > 0) {
    const c = masked[i]
    if (c === '(' || c === '{') depth++
    else if (c === ')' || c === '}') depth--
    else if (c === '[' && depth === 1) {
      let b = 1
      i++
      while (i < masked.length && b > 0) {
        if (masked[i] === '[') b++
        else if (masked[i] === ']') b--
        i++
      }
      continue
    } else if (depth === 1 && c === ',') expecting = true
    else if (depth === 1 && c === '=') expecting = false
    else if (depth === 1 && c === '$' && expecting) {
      const m = masked.slice(i + 1).match(/^\w+/)
      if (m) {
        names.push(m[0])
        expecting = false
        i += m[0].length
      }
    }
    i++
  }
  return names
}

export function psSymbols(text) {
  const masked = maskPs(text)
  const lines = masked.split('\n')
  const starts = [0]
  for (let i = 0; i < masked.length; i++) if (masked[i] === '\n') starts.push(i + 1)
  const fns = []
  lines.forEach((l, i) => {
    const m = l.match(/^(?:filter|function)\s+(?:(global|script|local|private):)?([\w.-]+)/i)
    if (m) fns.push({ name: m[2], line: i + 1, scope: m[1]?.toLowerCase() ?? null })
  })
  const out = fns.map((f) => ({ name: f.name, kind: 'function', line: f.line, exported: f.scope !== 'private' }))
  const segments = [{ owner: null, from: 0, to: fns.length ? fns[0].line - 1 : lines.length }]
  fns.forEach((f, k) => segments.push({ owner: f.name, from: f.line - 1, to: k + 1 < fns.length ? fns[k + 1].line - 1 : lines.length }))
  for (const seg of segments) {
    const slice = masked.slice(starts[seg.from], seg.to < starts.length ? starts[seg.to] : masked.length)
    const m = slice.match(/(?:^|\n)[ \t]*param[ \t\r\n]*\(/i)
    if (!m) continue
    const open = starts[seg.from] + m.index + m[0].length
    out.push({ name: seg.owner ? `${seg.owner}.param` : 'param', kind: 'param-block', line: lineAtOffset(masked, open - 1), exported: false, params: paramNames(masked, open) })
  }
  return out.sort((a, b) => a.line - b.line)
}

const IMPORT_VALUE_FLAGS = new Set(['scope', 'minimumversion', 'requiredversion', 'maximumversion', 'version', 'prefix', 'argumentlist', 'cmdlet', 'function', 'alias', 'variable'])

// References: Import-Module (a name or a path) and dot-sourcing (`. $PSScriptRoot\x.ps1`). { kind, spec, line, literal }
export function extractPsRefs(text) {
  const masked = maskPs(text)
  const found = []
  for (const m of masked.matchAll(/(?<![\w-])Import-Module\b([^\n;|]*)/gi)) {
    const toks = m[1].trim().split(/\s+/).filter(Boolean)
    const names = []
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]
      if (t.startsWith('-')) {
        const flag = t.slice(1).toLowerCase()
        if (flag === 'name') {
          const v = toks[++k]
          if (v) names.push(v)
        } else if (IMPORT_VALUE_FLAGS.has(flag)) k++
      } else if (!names.length) names.push(t)
    }
    for (const raw of names.flatMap((x) => x.split(','))) {
      const spec = raw.replace(/^['"]|['"]$/g, '').trim()
      if (spec && !spec.startsWith('$') && !spec.startsWith('(')) found.push({ kind: 'ps-import-module', spec, line: lineAtOffset(masked, m.index), literal: true, at: m.index })
      else if (spec) found.push({ kind: 'ps-import-module', spec, line: lineAtOffset(masked, m.index), literal: false, at: m.index })
    }
  }
  for (const m of masked.matchAll(/^[ \t]*\.[ \t]+(['"]?)([^\s{(&'"][^\n'"]*?)\1[ \t]*(?:;|$)/gm)) {
    found.push({ kind: 'ps-dot-source', spec: m[2].trim(), line: lineAtOffset(masked, m.index), literal: true, at: m.index })
  }
  return found.sort((a, b) => a.at - b.at).map(({ at, ...rest }) => rest)
}

export function resolvePsRef(fromPath, imp, has) {
  const dir = dirOf(fromPath)
  if (!imp.literal) return { status: 'unresolved', target: null, reason: 'module name is not a string literal' }
  const spec = imp.spec.replace(/\\/g, '/')
  const isModule = imp.kind === 'ps-import-module'
  if (!isModule || spec.includes('/') || /\.(?:ps1|psm1|psd1)$/i.test(spec)) {
    const rel = spec.replace(/^\$\{?PSScriptRoot\}?\/?/i, '')
    if (rel.includes('$')) return { status: 'unresolved', target: null, reason: 'path uses a variable other than $PSScriptRoot' }
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return { status: 'unresolved', target: null, reason: 'absolute path, not followed' }
    const base = joinPath(dir, rel)
    if (base === '..' || base.startsWith('../')) return { status: 'unresolved', target: null, reason: 'points outside the app folder' }
    const cands = [base, ...(isModule ? [`${base}.psm1`, `${base}.psd1`, `${base}/${posix.basename(base)}.psm1`] : [])]
    for (const c of cands) if (has(c)) return { status: 'local', target: c }
    return { status: 'unresolved', target: null, reason: 'no matching file under the app folder' }
  }
  for (const c of [joinPath(dir, `${spec}.psm1`), joinPath(dir, `${spec}.psd1`), joinPath(dir, spec, `${spec}.psm1`), `${spec}.psm1`, `${spec}/${spec}.psm1`]) if (has(c)) return { status: 'local', target: c }
  return { status: 'external', target: null, package: spec, reason: 'module name (installed or built in)' }
}

// ---- Rust ----

export function maskRust(text) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '/' && d === '/') {
      let j = text.indexOf('\n', i)
      if (j < 0) j = n
      out += blank(text.slice(i, j))
      i = j
    } else if (c === '/' && d === '*') {
      let j = i + 2
      let depth = 1
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth++
          j += 2
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth--
          j += 2
        } else j++
      }
      out += blank(text.slice(i, Math.min(j, n)))
      i = Math.min(j, n)
    } else if (c === 'r' && !/[\w]/.test(text[i - 1] ?? ' ') && /^r#*"/.test(text.slice(i, i + 12))) {
      const hashes = text.slice(i + 1).match(/^#*/)[0]
      const close = `"${hashes}`
      const k = text.indexOf(close, i + 2 + hashes.length)
      const j = k < 0 ? n : k + close.length
      out += blank(text.slice(i, j))
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, n)
      const body = text.slice(i, j)
      out += body[0] + blank(body.slice(1, -1)) + (body.length > 1 ? body[body.length - 1] : '')
      i = j
    } else if (c === "'") {
      if (d === '\\') {
        const k = text.indexOf("'", i + 3)
        const j = k < 0 ? i + 1 : k + 1
        out += blank(text.slice(i, j))
        i = j
      } else if (text[i + 2] === "'") {
        out += '   '
        i += 3
      } else {
        out += c
        i += 1
      }
    } else {
      out += c
      i += 1
    }
  }
  return out
}

// After `impl`, skip a balanced <...> generics list and return the rest of the header up to `{` or `where`.
function implHeader(line) {
  const m = line.match(/^(\s*)(?:unsafe\s+)?impl\b\s*/)
  if (!m) return null
  let rest = line.slice(m[0].length)
  if (rest.startsWith('<')) {
    let depth = 0
    let k = 0
    for (; k < rest.length; k++) {
      if (rest[k] === '<') depth++
      else if (rest[k] === '>' && rest[k - 1] !== '-' && --depth === 0) break
    }
    rest = rest.slice(k + 1)
  }
  rest = rest.replace(/\s*(?:\{.*|where\b.*)$/, '').replace(/\s+/g, ' ').trim()
  return rest || null
}

export function rustSymbols(text) {
  const lines = maskRust(text).split('\n')
  const out = []
  let cls = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^}/.test(l)) cls = null
    let m = l.match(/^(\s*)(pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/)
    if (m) {
      out.push({ name: m[3], kind: 'mod', line: i + 1, exported: Boolean(m[2]) })
      continue
    }
    m = l.match(/^(\s*)pub(?:\([^)]*\))?\s+(?:(?:const|async|unsafe|default)\s+)*(?:extern\s*(?:"[^"]*")?\s+)?fn\s+(\w+)/)
    if (m) {
      if (m[1] === '') cls = null
      out.push({ name: cls && m[1] !== '' ? `${cls}.${m[2]}` : m[2], kind: 'function', line: i + 1, exported: true })
      continue
    }
    m = l.match(/^\s*pub(?:\([^)]*\))?\s+(?:unsafe\s+)?(struct|enum|trait|union)\s+(\w+)/)
    if (m) {
      out.push({ name: m[2], kind: m[1], line: i + 1, exported: true })
      continue
    }
    const header = /^\s*(?:unsafe\s+)?impl\b/.test(l) ? implHeader(l) : null
    if (header) {
      const parts = header.split(/\s+for\s+/)
      const type = (parts[1] ?? parts[0]).replace(/^[!&\s]+/, '')
      cls = type.replace(/<.*$/, '').split('::').pop().trim() || null
      out.push({ name: parts.length > 1 ? `${parts[0].replace(/^!/, '')} for ${parts[1]}` : parts[0], kind: 'impl', line: i + 1, exported: false })
    }
  }
  return out
}

// `mod x;` declarations: the files they pull in. { kind, spec, line, literal }
export function extractRustMods(text) {
  const masked = maskRust(text)
  const out = []
  for (const m of masked.matchAll(/^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm)) out.push({ kind: 'rust-mod', spec: m[1], line: lineAtOffset(masked, m.index), literal: true })
  return out
}

export function resolveRustMod(fromPath, imp, has) {
  const dir = dirOf(fromPath)
  const file = posix.basename(fromPath)
  const stem = file.replace(/\.rs$/, '')
  const modDir = ['lib.rs', 'main.rs', 'mod.rs'].includes(file) ? dir : joinPath(dir, stem)
  for (const c of [joinPath(modDir, `${imp.spec}.rs`), joinPath(modDir, imp.spec, 'mod.rs')]) if (has(c)) return { status: 'local', target: c }
  return { status: 'unresolved', target: null, reason: `no ${imp.spec}.rs or ${imp.spec}/mod.rs next to the declaring file (cfg-gated or #[path])` }
}

// ---- Cargo.toml: package name and workspace members, read as text ----

export function cargoEntries(path, text, has, allPaths) {
  const out = []
  const dir = dirOf(path)
  let section = ''
  let collecting = false
  const members = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    const t = line.trim()
    if (collecting) {
      for (const s of t.replace(/\s#.*$/, '').matchAll(/"([^"]+)"/g)) members.push({ pattern: s[1], line: i + 1 })
      if (t.includes(']')) collecting = false
      continue
    }
    if (t.startsWith('#') || !t) continue
    const h = t.match(/^\[+\s*([^\]]+?)\s*\]+/)
    if (h) {
      section = h[1]
      continue
    }
    if (section === 'package') {
      const n = t.match(/^name\s*=\s*"([^"]+)"/)
      if (n) out.push({ id: `${path}#cargo-package:${n[1]}`, kind: 'cargo-package', name: n[1], file: path, status: 'local', source: { file: path, line: i + 1 } })
    } else if (section === 'workspace' && /^members\s*=\s*\[/.test(t)) {
      const body = t.slice(t.indexOf('[') + 1)
      for (const s of body.replace(/\s#.*$/, '').matchAll(/"([^"]+)"/g)) members.push({ pattern: s[1], line: i + 1 })
      if (!body.includes(']')) collecting = true
    }
  }
  const manifests = allPaths.filter((p) => p === 'Cargo.toml' || p.endsWith('/Cargo.toml'))
  for (const mem of members) {
    const rel = joinPath(dir, mem.pattern.replace(/\/$/, ''))
    let hits
    if (rel.includes('*')) {
      const re = new RegExp(`^${rel.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}/Cargo\\.toml$`)
      hits = manifests.filter((p) => re.test(p))
    } else hits = has(`${rel}/Cargo.toml`) ? [`${rel}/Cargo.toml`] : []
    if (!hits.length) out.push({ id: `${path}#cargo-member:${rel}`, kind: 'cargo-member', name: rel, file: null, status: 'unresolved', reason: 'no Cargo.toml at this workspace member path', value: mem.pattern, source: { file: path, line: mem.line } })
    for (const h of hits) out.push({ id: `${path}#cargo-member:${dirOf(h)}`, kind: 'cargo-member', name: dirOf(h), file: h, status: 'local', source: { file: path, line: mem.line } })
  }
  return out
}
