// Advisory alerts: public vulnerabilities in the stack a project declares. Advice only: it reads manifests and a local snapshot,
// prints what it found and what to do in plain words, and never changes, stops or updates anything.
//
// Feed: OSV (https://osv.dev), the open multi-ecosystem vulnerability database. The scan itself is OFFLINE: it matches the project's
// packages against a snapshot file (see SNAPSHOT_FORMAT). Only refreshSnapshot() talks to the network, with a timeout, and only when
// the caller asks for it and passes a fetch function (tests pass a fake one).
//
//   detectStack(dir)                       -> { languages, packages, notes }   reads manifests, runs nothing
//   loadSnapshot(path)                     -> snapshot | null
//   matchAdvisories(packages, snapshot)    -> findings (pure)
//   scanAdvisories(dir, { snapshotPath })  -> { stack, findings, snapshot, report }   offline
//   renderReport(result)                   -> text, serious matches first
//   refreshSnapshot(packages, { fetch })   -> snapshot (the only network use; saveSnapshot() writes it)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SNAPSHOT_FORMAT = 'meerkat-advisory-snapshot'
export const SNAPSHOT_VERSION = 1
export const OSV_API = 'https://api.osv.dev'
export const OSV_LICENCE_NOTE = 'Records come from OSV.dev, an aggregator. Each record keeps the licence of its source database (for example GitHub Advisory Database is CC-BY 4.0). Keep the credit and the record id when you republish. https://google.github.io/osv.dev/data/'
export const STALE_AFTER_DAYS = 14
const BATCH = 500 // queries per querybatch call; kept well under any documented size
const TIMEOUT_MS = 20000

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const readJson = (p) => { const t = read(p); if (t === null) return null; try { return JSON.parse(t) } catch { return null } }

// ---- versions -------------------------------------------------------------------------------------------------------------------

// First dotted number in a constraint string such as "^7.2.5", ">=1.4,<2", "~> 3.1", "1.2". null when there is none.
export function lowerBound(spec) {
  const m = /(\d+(?:\.\d+){0,3}(?:[-.]?(?:alpha|beta|rc|dev|a|b)\.?\d*)?)/i.exec(String(spec ?? ''))
  return m ? m[1] : null
}

const PRE = /^(dev|alpha|a|beta|b|pre|rc|snapshot)$/i
const tokens = (v) => String(v).trim().replace(/^[vV=]/, '').match(/\d+|[A-Za-z]+/g) ?? []
// Generic comparison across ecosystems: numbers compare as numbers, a pre-release word sorts below the release it precedes.
export function compareVersions(a, b) {
  const x = tokens(a), y = tokens(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i], q = y[i]
    // A missing part counts as 0, so keep comparing the rest: '1' is below '1.0.5' but equal to '1.0'.
    if (p === undefined) { if (PRE.test(q)) return 1; if (/^\d+$/.test(q) && Number(q) === 0) continue; return -1 }
    if (q === undefined) { if (PRE.test(p)) return -1; if (/^\d+$/.test(p) && Number(p) === 0) continue; return 1 }
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q)
    if (pn && qn) { if (Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1; continue }
    if (pn !== qn) return pn ? 1 : -1
    const pp = PRE.test(p), qp = PRE.test(q)
    if (pp !== qp) return pp ? -1 : 1
    if (p.toLowerCase() !== q.toLowerCase()) return p.toLowerCase() < q.toLowerCase() ? -1 : 1
  }
  return 0
}

// ---- reading manifests ----------------------------------------------------------------------------------------------------------

// A package: { ecosystem, name, version, exact, source }. exact=false means the version is only the lowest one the manifest allows.
const pkg = (ecosystem, name, version, exact, source) => ({ ecosystem, name, version, exact, source })

function fromComposer(dir, out) {
  const j = readJson(join(dir, 'composer.json'))
  if (!j) return
  const req = { ...(j.require ?? {}) }
  const php = req.php
  if (php) out.languages.push({ language: 'PHP', version: lowerBound(php), declared: php, source: 'composer.json', exactVersion: false })
  const lock = readJson(join(dir, 'composer.lock'))
  const locked = new Map([...(lock?.packages ?? []), ...(lock?.['packages-dev'] ?? [])].map((p) => [p.name, p.version]))
  for (const [name, spec] of Object.entries({ ...req, ...(j['require-dev'] ?? {}) })) {
    if (name === 'php' || name.startsWith('ext-') || name.startsWith('lib-')) continue
    if (locked.has(name)) out.packages.push(pkg('Packagist', name, String(locked.get(name)).replace(/^v/, ''), true, 'composer.lock'))
    else if (lowerBound(spec)) out.packages.push(pkg('Packagist', name, lowerBound(spec), false, 'composer.json'))
  }
  if (!lock) out.notes.push('composer.lock not found: versions are the lowest each constraint allows, so matches are marked "may be affected".')
}

function fromPackageJson(dir, out) {
  const j = readJson(join(dir, 'package.json'))
  if (!j) return
  if (j.engines?.node) out.languages.push({ language: 'Node.js', version: lowerBound(j.engines.node), declared: j.engines.node, source: 'package.json', exactVersion: false })
  const lock = readJson(join(dir, 'package-lock.json'))
  for (const [name, spec] of Object.entries({ ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) })) {
    const exact = lock?.packages?.['node_modules/' + name]?.version ?? lock?.dependencies?.[name]?.version
    if (exact) out.packages.push(pkg('npm', name, exact, true, 'package-lock.json'))
    else if (lowerBound(spec)) out.packages.push(pkg('npm', name, lowerBound(spec), false, 'package.json'))
  }
}

function fromPython(dir, out) {
  const files = readdirSync(dir).filter((f) => /^requirements.*\.txt$/i.test(f))
  for (const f of files) {
    for (const raw of (read(join(dir, f)) ?? '').split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim()
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(==|>=|~=|>|<=|<|!=)?\s*([0-9][^\s,;]*)?/.exec(line)
      if (!m || !m[3] || m[2] === '<' || m[2] === '<=' || m[2] === '!=') continue
      out.packages.push(pkg('PyPI', m[1], m[3], m[2] === '==', f))
    }
  }
  const py = read(join(dir, 'pyproject.toml'))
  if (py) {
    const rp = /requires-python\s*=\s*["']([^"']+)["']/.exec(py)
    if (rp) out.languages.push({ language: 'Python', version: lowerBound(rp[1]), declared: rp[1], source: 'pyproject.toml', exactVersion: false })
    const dep = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(py)
    for (const m of (dep?.[1] ?? '').matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(==|>=|~=|>)?\s*([0-9][^"',;\s]*)?/g)) {
      if (m[3]) out.packages.push(pkg('PyPI', m[1], m[3], m[2] === '==', 'pyproject.toml'))
    }
  }
}

function fromGo(dir, out) {
  const t = read(join(dir, 'go.mod'))
  if (!t) return
  const g = /^go\s+(\d[\d.]*)/m.exec(t)
  if (g) out.languages.push({ language: 'Go', version: g[1], declared: g[1], source: 'go.mod', exactVersion: false })
  for (const m of t.matchAll(/^\s*(?:require\s+)?([\w.\-]+\.[\w.\-]+\/[^\s]+)\s+v(\d[^\s]*)/gm)) out.packages.push(pkg('Go', m[1], m[2], true, 'go.mod'))
}

function fromCargo(dir, out) {
  const t = read(join(dir, 'Cargo.toml'))
  if (!t) return
  const ed = /^rust-version\s*=\s*"([^"]+)"/m.exec(t)
  if (ed) out.languages.push({ language: 'Rust', version: lowerBound(ed[1]), declared: ed[1], source: 'Cargo.toml', exactVersion: false })
  const lock = read(join(dir, 'Cargo.lock'))
  const locked = new Map()
  for (const m of (lock ?? '').matchAll(/\[\[package\]\]\s*name = "([^"]+)"\s*version = "([^"]+)"/g)) locked.set(m[1], m[2])
  const sec = /\[(?:dev-|build-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g
  for (const s of t.matchAll(sec)) {
    for (const m of s[1].matchAll(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) {
      if (locked.has(m[1])) out.packages.push(pkg('crates.io', m[1], locked.get(m[1]), true, 'Cargo.lock'))
      else if (lowerBound(m[2] ?? m[3])) out.packages.push(pkg('crates.io', m[1], lowerBound(m[2] ?? m[3]), false, 'Cargo.toml'))
    }
  }
}

function fromGems(dir, out) {
  const t = read(join(dir, 'Gemfile'))
  if (!t) return
  const rb = /^\s*ruby\s+["']([^"']+)["']/m.exec(t)
  if (rb) out.languages.push({ language: 'Ruby', version: lowerBound(rb[1]), declared: rb[1], source: 'Gemfile', exactVersion: false })
  const locked = new Map()
  for (const m of (read(join(dir, 'Gemfile.lock')) ?? '').matchAll(/^ {4}([A-Za-z0-9_.-]+) \((\d[^)\s]*)\)/gm)) locked.set(m[1], m[2])
  for (const m of t.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)) {
    if (locked.has(m[1])) out.packages.push(pkg('RubyGems', m[1], locked.get(m[1]), true, 'Gemfile.lock'))
    else if (lowerBound(m[2])) out.packages.push(pkg('RubyGems', m[1], lowerBound(m[2]), false, 'Gemfile'))
  }
}

function fromJava(dir, out) {
  const pom = read(join(dir, 'pom.xml'))
  if (pom) {
    const jv = /<(?:maven\.compiler\.(?:source|release)|java\.version)>([\d.]+)</.exec(pom)
    if (jv) out.languages.push({ language: 'Java', version: jv[1], declared: jv[1], source: 'pom.xml', exactVersion: false })
    const props = Object.fromEntries([...pom.matchAll(/<([\w.\-]+)>([^<]+)<\/\1>/g)].map((m) => [m[1], m[2].trim()]))
    for (const m of pom.matchAll(/<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/g)) {
      const v = m[3].trim().replace(/^\$\{([^}]+)\}$/, (_, k) => props[k] ?? '')
      if (lowerBound(v)) out.packages.push(pkg('Maven', `${m[1].trim()}:${m[2].trim()}`, lowerBound(v), true, 'pom.xml'))
    }
  }
  for (const f of ['build.gradle', 'build.gradle.kts']) {
    for (const m of (read(join(dir, f)) ?? '').matchAll(/["']([\w.\-]+):([\w.\-]+):(\d[^"':@]*)["']/g)) out.packages.push(pkg('Maven', `${m[1]}:${m[2]}`, m[3], true, f))
  }
}

// What language, version and packages the project declares. Reads files only.
export function detectStack(dir) {
  const out = { languages: [], packages: [], notes: [] }
  for (const f of [fromComposer, fromPackageJson, fromPython, fromGo, fromCargo, fromGems, fromJava]) {
    try { f(dir, out) } catch (e) { out.notes.push(`${f.name} could not read this project: ${e.message}`) }
  }
  const seen = new Set()
  out.packages = out.packages.filter((p) => { const k = `${p.ecosystem}|${p.name}|${p.version}`; if (seen.has(k)) return false; seen.add(k); return true })
  return out
}

// ---- the snapshot ---------------------------------------------------------------------------------------------------------------
// SNAPSHOT_FORMAT, one JSON file:
// { format: 'meerkat-advisory-snapshot', version: 1, source: 'osv.dev', fetchedAt: ISO time, licenceNote, queried: [{ecosystem,name}],
//   advisories: [ trimmed OSV records: { id, aliases, summary, published, modified, severity, database_specific:{severity},
//                 affected:[{ package:{ecosystem,name}, ranges:[{type,events}], versions? }], references:[{type,url}] } ] }
// `queried` records which packages the snapshot has been asked about, so "no advisory" can be told apart from "never looked".

export function trimRecord(r) {
  return {
    id: r.id,
    aliases: r.aliases ?? [],
    summary: r.summary ?? '',
    published: r.published,
    modified: r.modified,
    severity: r.severity ?? [],
    database_specific: r.database_specific?.severity ? { severity: r.database_specific.severity } : {},
    affected: (r.affected ?? []).map((a) => {
      const ranges = (a.ranges ?? []).filter((x) => x.type === 'SEMVER' || x.type === 'ECOSYSTEM')
      return { package: { ecosystem: a.package?.ecosystem, name: a.package?.name }, ranges, ...(ranges.length ? {} : { versions: a.versions ?? [] }) }
    }).filter((a) => a.package.name),
    references: (r.references ?? []).filter((x) => x.type === 'ADVISORY' || x.type === 'WEB').slice(0, 4),
  }
}

export function loadSnapshot(path) {
  const j = readJson(path)
  if (!j || j.format !== SNAPSHOT_FORMAT || j.version !== SNAPSHOT_VERSION || !Array.isArray(j.advisories)) return null
  return j
}

export function saveSnapshot(path, snapshot) { writeFileSync(path, JSON.stringify(snapshot, null, 1) + '\n') }

const normName = (eco, n) => (eco === 'PyPI' ? String(n).toLowerCase().replace(/[-_.]+/g, '-') : String(n).toLowerCase())

// The only code that uses the network. `fetch` is passed in; every call has a timeout. Nothing is retried silently: a failure throws.
export async function refreshSnapshot(packages, { fetch: f = globalThis.fetch, now = new Date(), previous = null } = {}) {
  const uniq = [...new Map(packages.map((p) => [`${p.ecosystem}|${normName(p.ecosystem, p.name)}`, { ecosystem: p.ecosystem, name: p.name }])).values()]
  const ids = new Map() // advisory id -> the `modified` time OSV reports for it now (null when it does not say)
  const call = async (path, body) => {
    const res = await f(OSV_API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`OSV ${path} answered ${res.status}`)
    return res.json()
  }
  for (let i = 0; i < uniq.length; i += BATCH) {
    let queries = uniq.slice(i, i + BATCH).map((u) => ({ package: { name: u.name, ecosystem: u.ecosystem } }))
    while (queries.length) {
      const res = await call('/v1/querybatch', { queries })
      const next = []
      res.results.forEach((r, k) => {
        for (const v of r.vulns ?? []) ids.set(v.id, v.modified ?? null)
        if (r.next_page_token) next.push({ ...queries[k], page_token: r.next_page_token })
      })
      queries = next
    }
  }
  const have = new Map((previous?.advisories ?? []).map((a) => [a.id, a]))
  const advisories = []
  // A cached record is reused only when OSV's modified time is known and no newer than the cached one; otherwise it is downloaded again.
  const fresh = (cached, now) => { const c = Date.parse(cached?.modified ?? ''), n = Date.parse(now ?? ''); return Number.isFinite(c) && Number.isFinite(n) && c >= n }
  for (const id of [...ids.keys()].sort()) advisories.push(fresh(have.get(id), ids.get(id)) ? have.get(id) : trimRecord(await call('/v1/vulns/' + encodeURIComponent(id))))
  return { format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, source: 'osv.dev', fetchedAt: now.toISOString(), licenceNote: OSV_LICENCE_NOTE, queried: uniq, advisories }
}

// ---- matching -------------------------------------------------------------------------------------------------------------------

function rangeHits(range, v) {
  // events are walked in order: introduced opens a window, fixed or last_affected closes it.
  let open = false
  let hit = false
  let fixed = null
  const events = [...range.events].sort((a, b) => compareVersions(a.introduced ?? a.fixed ?? a.last_affected ?? '0', b.introduced ?? b.fixed ?? b.last_affected ?? '0'))
  for (const e of events) {
    if (e.introduced !== undefined) { if (e.introduced === '0' || compareVersions(v, e.introduced) >= 0) open = true }
    else if (e.fixed !== undefined) { if (open && compareVersions(v, e.fixed) < 0) { hit = true; fixed = e.fixed } open = false }
    else if (e.last_affected !== undefined) { if (open && compareVersions(v, e.last_affected) <= 0) hit = true; open = false }
  }
  if (open) hit = true // introduced and never closed: still affected
  return { hit, fixed }
}

const clean = (v) => String(v).replace(/^[vV]/, '')

function affects(a, p) {
  if (a.package.ecosystem !== p.ecosystem || normName(p.ecosystem, a.package.name) !== normName(p.ecosystem, p.name)) return null
  // The lowest fixed version above the one in use, over every range of this package: the nearest upgrade that removes the problem.
  const fixes = (a.ranges ?? []).flatMap((r) => r.events.filter((e) => e.fixed !== undefined).map((e) => e.fixed)).filter((x) => compareVersions(x, p.version) > 0).sort(compareVersions)
  for (const r of a.ranges ?? []) { if (rangeHits(r, p.version).hit) return { fixed: fixes[0] ?? null } }
  if ((a.versions ?? []).some((x) => clean(x) === clean(p.version))) return { fixed: null }
  return null
}

// CVSS v3 base score from a vector, used only when the record has no stated severity word.
export function cvss3Score(vector) {
  const m = Object.fromEntries(String(vector).split('/').slice(1).map((s) => s.split(':')))
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV], AC = { L: 0.77, H: 0.44 }[m.AC]
  const changed = m.S === 'C'
  const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR], UI = { N: 0.85, R: 0.62 }[m.UI]
  const cia = (k) => ({ H: 0.56, L: 0.22, N: 0 }[m[k]])
  if ([AV, AC, PR, UI, cia('C'), cia('I'), cia('A')].some((x) => x === undefined)) return null
  const iss = 1 - (1 - cia('C')) * (1 - cia('I')) * (1 - cia('A'))
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss
  const expl = 8.22 * AV * AC * PR * UI
  if (impact <= 0) return 0
  const raw = changed ? Math.min(1.08 * (impact + expl), 10) : Math.min(impact + expl, 10)
  return Math.ceil(raw * 10 - 1e-9) / 10
}

// CRITICAL, HIGH, MODERATE, LOW or UNRATED for one record. UNRATED means the severity could not be worked out (for example a CVSS v4
// vector), which is never treated as low.
export function severityOf(rec) {
  const w = String(rec.database_specific?.severity ?? '').toUpperCase()
  if (w === 'MEDIUM') return 'MODERATE'
  if (['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].includes(w)) return w
  for (const s of rec.severity ?? []) {
    const n = /^CVSS:3/.test(s.score ?? '') ? cvss3Score(s.score) : Number(s.score)
    if (Number.isFinite(n)) return n >= 9 ? 'CRITICAL' : n >= 7 ? 'HIGH' : n >= 4 ? 'MODERATE' : 'LOW'
  }
  return 'UNRATED'
}

const RANK = { UNRATED: 0, CRITICAL: 1, HIGH: 2, MODERATE: 3, LOW: 4 }
export const UNRATED_NOTE = 'severity not determined, check the advisory at osv.dev'

// Pure. One finding per (package, advisory). `serious` = CRITICAL or HIGH on a version the project really uses (exact).
export function matchAdvisories(packages, snapshot) {
  const findings = []
  for (const p of packages) {
    for (const rec of snapshot.advisories) {
      let fixed = null, hit = false
      for (const a of rec.affected) { const x = affects(a, p); if (x) { hit = true; fixed = x.fixed ?? fixed; break } }
      if (!hit) continue
      const severity = severityOf(rec)
      const cve = (rec.aliases ?? []).find((x) => /^CVE-/.test(x)) ?? null
      findings.push({
        package: p.name, ecosystem: p.ecosystem, version: p.version, exact: p.exact, source: p.source,
        id: rec.id, cve, summary: rec.summary, severity, fixedIn: fixed,
        serious: (severity === 'CRITICAL' || severity === 'HIGH' || severity === 'UNRATED') && p.exact,
        url: `https://osv.dev/vulnerability/${rec.id}`,
      })
    }
  }
  return findings.sort((a, b) => Number(b.serious) - Number(a.serious) || RANK[a.severity] - RANK[b.severity] || a.package.localeCompare(b.package) || a.id.localeCompare(b.id))
}

// ---- the report -----------------------------------------------------------------------------------------------------------------

export function snapshotAge(snapshot, now = new Date()) {
  const t = Date.parse(snapshot?.fetchedAt ?? '')
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86400000) : null
}

export function renderReport({ stack, findings, snapshot, now = new Date() }) {
  const L = []
  const serious = findings.filter((f) => f.serious)
  const rest = findings.filter((f) => !f.serious)
  if (serious.length) {
    L.push('SERIOUS SECURITY ALERT: ' + serious.length + ' known vulnerabilit' + (serious.length === 1 ? 'y' : 'ies') + ' in software this project uses.')
    L.push('Action: update the packages below to the fixed version soon, after testing the update on a copy. Meerkat has changed nothing and will not take anything down.')
    for (const f of serious) L.push(`  [${f.severity}] ${f.package} ${f.version} (${f.source}): ${f.severity === 'UNRATED' ? UNRATED_NOTE + '. ' : ''}${f.summary}. ${f.fixedIn ? 'Fixed in ' + f.fixedIn + '.' : 'No fixed version is listed; check the advisory.'} ${f.cve ?? f.id} ${f.url}`)
  } else if (findings.length) L.push('No serious known vulnerabilities found. Lesser or uncertain matches are listed below.')
  else L.push('No known vulnerabilities found in the declared packages.')
  if (rest.length) {
    L.push('')
    L.push('Other advisories (review when convenient):')
    for (const f of rest) L.push(`  [${f.severity}] ${f.package} ${f.version}${f.exact ? '' : ' (lowest version the manifest allows; the installed one may be newer, so this MAY be affected)'}: ${f.severity === 'UNRATED' ? UNRATED_NOTE + '. ' : ''}${f.summary}. ${f.fixedIn ? 'Fixed in ' + f.fixedIn + '.' : ''} ${f.cve ?? f.id} ${f.url}`)
  }
  L.push('')
  L.push('Detected stack: ' + ([...stack.languages.map((l) => `${l.language} ${l.version ?? '?'}`), `${stack.packages.length} package${stack.packages.length === 1 ? '' : 's'}`].join(', ')))
  if (!snapshot) L.push('No advisory snapshot found, so nothing could be checked. Refresh one while online.')
  else {
    const age = snapshotAge(snapshot, now)
    L.push(`Advisory data: OSV snapshot from ${snapshot.fetchedAt}` + (age !== null && age > STALE_AFTER_DAYS ? `, ${age} days old: STALE, new vulnerabilities since then are not shown. Refresh it while online.` : '.'))
    const asked = new Set((snapshot.queried ?? []).map((q) => `${q.ecosystem}|${normName(q.ecosystem, q.name)}`))
    const unknown = stack.packages.filter((p) => !asked.has(`${p.ecosystem}|${normName(p.ecosystem, p.name)}`)).length
    if (unknown) L.push(`${unknown} package${unknown === 1 ? ' was' : 's were'} not in the snapshot when it was made, so they could not be checked.`)
  }
  for (const n of stack.notes) L.push('Note: ' + n)
  return L.join('\n')
}

// The whole offline scan. Never touches the network.
export function scanAdvisories(dir, { snapshotPath, now = new Date() } = {}) {
  const stack = detectStack(dir)
  const snapshot = snapshotPath && existsSync(snapshotPath) ? loadSnapshot(snapshotPath) : null
  const findings = snapshot ? matchAdvisories(stack.packages, snapshot) : []
  const result = { stack, findings, snapshot, serious: findings.some((f) => f.serious) }
  return { ...result, report: renderReport({ ...result, now }) }
}
