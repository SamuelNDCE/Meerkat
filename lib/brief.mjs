// `meerkat brief <file>[#symbol] [--app <dir>] [--json]`: what an AI (or a person) needs before editing a file or a symbol, in one fast call.
// Callers and tests come from the existing blast logic (lib/blast.mjs -> lib/refactorctx.mjs, the import graph); this file only locates the
// usage line inside files blast already named as importers, it does not find callers a second way. Findings are read from the LAST saved run
// only (no scan is started). Churn comes from a bounded `git log`. The whole brief is cached by content hash under <cache>/brief/.
// Exit codes: 0 done, 2 usage error or unknown symbol, 3 the file is not in the code map (nothing to judge).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, resolve } from 'node:path'
import { maskJs, maskPy } from './codemap.mjs'
import { cachedCodemap, mapRefreshLine } from './blast.mjs'
import { refactorCtx, parseTarget, TEST_RE } from './refactorctx.mjs'
import { cacheHome } from './resultcache.mjs'
import { writeAtomic } from './findingshistory.mjs'
import { loadRunFindings } from './findingscmd.mjs'
import { latestRunDir } from './runlog.mjs'
import { VERSION } from './version.mjs'
import { folderBanner, folderInfo } from './folderbanner.mjs'

export const BRIEF_VERSION = 1
export const EXIT_NOT_FOUND = 3 // nothing could be judged: the file is not in the code map
const MAX_CALLERS = 10
const CHURN_DAYS = 90
const CHURN_CAP = 500
const MAX_DIRTY = 300
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sha = (x) => createHash('sha256').update(x).digest('hex')

const git = (dir, args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

// ---- symbol declaration ------------------------------------------------------------------------------------------------------------------

const CONTROL = /^\s*(if|for|while|switch|return|catch|else|do|try|await|new|throw|typeof|function)\b/

// The declaration of `symbol` in `text`: { line, kind, signature, endLine } or null when the name does not occur at all.
export function findDeclaration(text, symbol, language) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n')
  const masked = (language === 'python' ? maskPy(raw.join('\n')) : maskJs(raw.join('\n'))).split('\n')
  const n = esc(symbol)
  const word = new RegExp(`(?<![\\w$])${n}(?![\\w$])`)
  const rules = language === 'python'
    ? [['function', new RegExp(`^\\s*(?:async\\s+)?def\\s+${n}\\b`)], ['class', new RegExp(`^\\s*class\\s+${n}\\b`)], ['variable', new RegExp(`^${n}\\s*(?::[^=]+)?=`)]]
    : [
        ['function', new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${n}\\b`)],
        ['class', new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${n}\\b`)],
        ['variable', new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`)],
        ['type', new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:interface|type|enum)\\s+${n}\\b`)],
        ['method', new RegExp(`^\\s+(?:static\\s+)?(?:async\\s+)?(?:get\\s+|set\\s+)?\\*?${n}\\s*\\(`)],
      ]
  let at = -1
  let kind = null
  for (const [k, re] of rules) {
    const i = masked.findIndex((l, ix) => re.test(l) && !(k === 'method' && CONTROL.test(l)) && ix >= 0)
    if (i >= 0 && (at < 0 || i < at)) {
      at = i
      kind = k
      if (k !== 'method') break
    }
  }
  if (at < 0) {
    at = masked.findIndex((l) => word.test(l))
    if (at < 0) return null
    kind = 'mention'
  }
  // Approximate end: the line before the next declaration that starts in column 0 (or the end of the file).
  const top = language === 'python' ? /^(?:async\s+def|def|class)\s/ : /^(?:export\s|function\s|async\s+function\s|class\s|const\s|let\s|var\s|interface\s|type\s|enum\s)/
  let end = raw.length
  for (let i = at + 1; i < masked.length; i++) {
    if (top.test(masked[i])) {
      end = i
      break
    }
  }
  while (end > at + 1 && !raw[end - 1].trim()) end--
  return { line: at + 1, kind, signature: raw[at].trim().replace(/\s+/g, ' ').slice(0, 200), endLine: end }
}

// ---- callers: usage lines inside the files blast named as importers --------------------------------------------------------------------

const IMPORT_LINE = /^\s*(?:import\b|export\b[^=]*\bfrom\b|from\s+\S+\s+import\b)|\brequire\s*\(|^\s*(?:const|let|var)\s+[^=]*=\s*(?:await\s+)?import\s*\(/
const DECL_HEAD = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/,
  /^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([\w$]+)\s*\([^)]*\)\s*(?::[^{]+)?\{\s*$/,
  /^\s*(?:async\s+)?def\s+(\w+)/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([\w$]+)/,
]

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'with', 'function'])

// The nearest declaration above `lineNo` that is indented less than the usage line: the function or class the usage sits in.
function enclosingName(maskedLines, lineNo) {
  const indentOf = (l) => l.match(/^\s*/)[0].length
  const want = indentOf(maskedLines[lineNo - 1] ?? '')
  if (want === 0) return '(no named function)'
  for (let i = lineNo - 2; i >= 0; i--) {
    const l = maskedLines[i]
    if (!l.trim() || indentOf(l) >= want) continue
    for (const re of DECL_HEAD) {
      const m = l.match(re)
      if (m && !KEYWORDS.has(m[1])) return m[1]
    }
  }
  return '(no named function)'
}

function usageIn(text, language, word) {
  const masked = (language === 'python' ? maskPy(text) : maskJs(text)).split('\n')
  let importLine = null
  for (let i = 0; i < masked.length; i++) {
    if (!word.test(masked[i])) continue
    if (IMPORT_LINE.test(masked[i])) {
      importLine ??= i + 1
      continue
    }
    return { line: i + 1, fn: enclosingName(masked, i + 1), usage: true }
  }
  return importLine ? { line: importLine, fn: '(import only, no call found)', usage: false } : null
}

// ---- cache key ---------------------------------------------------------------------------------------------------------------------------

function dirtySignature(appDir) {
  const status = git(appDir, ['status', '--porcelain', '--untracked-files=all', '-z', '--', '.'])
  if (status === null) return { sig: null, ok: false } // no git: nothing says which other files changed, so the brief is not cached
  const entries = status.split('\0').filter(Boolean)
  if (entries.length > MAX_DIRTY) return { sig: null, ok: false }
  const parts = entries.map((e) => {
    const p = e.slice(3)
    try {
      const st = statSync(join(appDir, p))
      return `${e.slice(0, 2)}${p}:${st.size}:${Math.round(st.mtimeMs)}`
    } catch {
      return `${e.slice(0, 2)}${p}:gone`
    }
  })
  return { sig: sha(parts.join('\n')), ok: true }
}

const briefCacheDir = (env) => join(cacheHome(env), 'brief')

function runStamp(env, appDir = null) {
  try {
    const dir = latestRunDir(env, appDir)
    if (!dir) return 'norun'
    const f = join(dir, 'findings.json')
    return `${dir}:${existsSync(f) ? Math.round(statSync(f).mtimeMs) : 'nofindings'}`
  } catch {
    return 'norun'
  }
}

// ---- the facts ---------------------------------------------------------------------------------------------------------------------------

function churnFor(appDir, file) {
  if (git(appDir, ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') return { available: false, note: 'not a git repository, so no churn figure' }
  const log = git(appDir, ['log', `--since=${CHURN_DAYS} days ago`, '--format=%aI', '-n', String(CHURN_CAP + 1), '--', file])
  if (log === null) return { available: false, note: 'git log failed, so no churn figure' }
  const dates = log.split('\n').filter(Boolean)
  const capped = dates.length > CHURN_CAP
  let last = dates[0] ?? null
  if (!last) last = git(appDir, ['log', '-1', '--format=%aI', '--', file])?.trim() || null
  return { available: true, days: CHURN_DAYS, commits: capped ? CHURN_CAP : dates.length, capped, lastAuthorDate: last }
}

function findingsFor(env, appDir, file, decl) {
  const r = loadRunFindings(env, undefined, { folder: appDir })
  if (!r.ok) return { available: false, note: 'no saved run, so no findings (Meerkat did not start a scan; run meerkat verify first to get them)' }
  const proj = r.doc.run?.project?.path
  const same = (a, b) => {
    try {
      return realpathSync(a).replace(/\\/g, '/').toLowerCase() === realpathSync(b).replace(/\\/g, '/').toLowerCase()
    } catch {
      return String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase()
    }
  }
  if (typeof proj === 'string' && proj && !same(proj, appDir)) return { available: false, note: `the last saved run was of another project (${proj.replace(/\\/g, '/').split('/').slice(-2).join('/')}), so no findings for this one (run meerkat verify here first to get them)` }
  const runName = posix.basename(String(r.dir).replace(/\\/g, '/'))
  const mine = (r.doc.findings ?? []).filter((f) => f.file && posix.normalize(String(f.file).replace(/\\/g, '/')).replace(/^\.\//, '') === file)
  const rows = mine.map((f) => ({ id: f.id, severity: f.severity, check: f.check, rule: f.rule ?? null, line: f.line ?? null, message: String(f.message ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 160), inSymbol: decl && Number.isInteger(f.line) && f.line > 0 ? f.line >= decl.line && f.line <= decl.endLine : null }))
  return { available: true, run: runName, onFile: rows.length, inSymbol: decl ? rows.filter((x) => x.inSymbol).length : null, items: rows.slice(0, 10) }
}

const SEV_HIGH = new Set(['critical', 'high'])

export function assessRisk(f) {
  const reasons = []
  let score = 0
  const cf = f.callers.files
  if (cf === 0) {
    reasons.push(f.callers.unresolved > 0 ? `0 callers found, but ${f.callers.unresolved} unresolved imports could be importers, so "no callers" is not proven (+0)` : '0 callers found (+0)')
  } else {
    const pts = cf >= 10 ? 3 : cf >= 3 ? 2 : 1
    score += pts
    reasons.push(`${cf} calling file${cf === 1 ? '' : 's'} (+${pts})`)
  }
  if (f.target.exported) {
    score += 1
    reasons.push('exported, so other code can depend on it (+1)')
  } else reasons.push('not exported (+0)')
  if (f.churn.available) {
    const c = f.churn.commits
    const pts = c >= 10 ? 2 : c >= 3 ? 1 : 0
    score += pts
    reasons.push(`${f.churn.capped ? `${c}+` : c} commit${c === 1 ? '' : 's'} in ${f.churn.days} days (+${pts})`)
  } else reasons.push(`churn unknown: ${f.churn.note} (+0)`)
  if (f.tests.count === 0) {
    score += 2
    reasons.push('no test references it (+2)')
  } else reasons.push(`${f.tests.count} test file${f.tests.count === 1 ? '' : 's'} reference it (+0)`)
  if (f.findings.available && f.findings.onFile > 0) {
    const sev = f.findings.items.some((x) => SEV_HIGH.has(x.severity))
    const pts = sev ? 2 : 1
    score += pts
    reasons.push(`${f.findings.onFile} existing finding${f.findings.onFile === 1 ? '' : 's'} on the file${sev ? ', including high or critical' : ''} (+${pts})`)
  } else if (f.findings.available) reasons.push('no findings on the file in the last run (+0)')
  else reasons.push('findings unknown: no usable saved run (+0)')
  const tier = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low'
  return { tier, score, reasons, scale: 'low 0-2, medium 3-5, high 6+' }
}

export function buildChecklist(f) {
  const L = []
  const sym = f.target.symbol ?? f.target.file
  if (f.callers.files > 0) {
    const other = f.callers.list.filter((c) => c.file !== f.target.file).length
    L.push(`${f.callers.files} calling file${f.callers.files === 1 ? '' : 's'}${other ? '' : ' (all in this file)'}: update them or keep the signature of ${sym} unchanged`)
  } else if (f.callers.unresolved > 0) L.push(`0 callers found, but ${f.callers.unresolved} unresolved imports could be importers: search for the name by hand before deleting or renaming`)
  else L.push(`no callers found: ${f.target.exported ? 'it is exported, so check for users outside this project before removing it' : 'safe to change its signature'}`)
  if (f.target.symbol && f.target.exported === false) L.push('not exported: callers outside this file cannot reach it by name')
  if (f.tests.count === 0) L.push('no test references this ' + (f.target.symbol ? 'symbol or file' : 'file') + ': write one before changing behaviour')
  else L.push(`run the ${f.tests.count} referencing test file${f.tests.count === 1 ? '' : 's'} after the edit (first: ${f.tests.files[0].file})`)
  if (f.findings.available && f.findings.onFile > 0) L.push(`${f.findings.onFile} existing finding${f.findings.onFile === 1 ? '' : 's'} on this file: read them first (meerkat findings), do not add to them`)
  if (f.churn.available && f.churn.commits >= 10) L.push(`changed ${f.churn.capped ? `${f.churn.commits}+` : f.churn.commits} times in ${f.churn.days} days: expect merge conflicts, keep the edit small and pull first`)
  if (f.callers.modules.length > 1) L.push(`callers span ${f.callers.modules.length} modules (${f.callers.modules.join(', ')}): check each module's tests`)
  L.push('after the edit: meerkat gate --staged')
  return L
}

// Pure builder: everything except the cache and the clock.
export function buildBrief(appDir, target, { env = process.env, map = null, readText = null } = {}) {
  const root = resolve(appDir)
  const { file: rawFile, symbol } = parseTarget(target)
  const r = refactorCtx(root, target, { map, catalogDir: null, readText })
  if (!r.found) return { found: false, version: BRIEF_VERSION, target: r.target, reason: r.reason }
  const file = r.target.file
  const rd = readText ?? ((p) => {
    try {
      return readFileSync(join(root, p), 'utf8').replace(/\r\n?/g, '\n')
    } catch {
      return null
    }
  })
  const own = rd(file) ?? ''
  const lang = r.target.language
  let decl = null
  if (symbol) {
    decl = findDeclaration(own, symbol, lang)
    if (!decl) return { found: true, symbolFound: false, version: BRIEF_VERSION, target: { file, symbol }, reason: `"${symbol}" does not occur in ${file}` }
  }
  const exported = symbol ? r.symbol.exported : r.exports.length > 0
  const word = symbol ? new RegExp(`(?<![\\w$])${esc(symbol)}(?![\\w$])`) : null

  // Callers: the importers blast found. With a symbol, only those that mention it by name.
  const pool = symbol ? r.importers.filter((i) => i.mentionsSymbol === true) : r.importers
  const unknownMention = symbol ? r.importers.filter((i) => typeof i.mentionsSymbol === 'string').length : 0
  const byFile = new Map()
  for (const i of pool) {
    if (byFile.has(i.file)) continue
    if (word) {
      const text = rd(i.file)
      const u = text === null ? null : usageIn(text, langOf(i.file), word)
      byFile.set(i.file, u ? { file: i.file, line: u.line, function: u.fn, call: u.usage } : { file: i.file, line: i.line, function: '(unknown)', call: false })
    } else byFile.set(i.file, { file: i.file, line: i.line, function: '(import)', call: false })
  }
  const all = [...byFile.values()]
  const modOf = (p) => (map ?? null)?.modules?.find((m) => m.files.includes(p))?.id
  const callers = {
    files: all.length,
    sources: 'import graph from the code map (same as meerkat blast); the line and function are the first non-import use inside each importing file',
    list: all.slice(0, MAX_CALLERS),
    more: Math.max(0, all.length - MAX_CALLERS),
    unresolved: r.blastRadius.unresolvedCouldBeImporters,
    unknownMention,
    modules: [...new Set(all.map((c) => modOf(c.file)).filter(Boolean))].sort(),
  }

  // Tests: tests that reach the file through imports (blast), plus test files whose text names the symbol (or the file).
  const testMap = new Map(r.tests.map((t) => [t.file, { file: t.file, how: t.matched === 'direct' ? 'imports the file' : 'reaches the file through imports' }]))
  const cm = map
  const stem = posix.basename(file).replace(/\.[^.]+$/, '')
  const nameRe = word ?? new RegExp(`(?<![\\w$])${esc(stem)}(?![\\w$])`)
  for (const f of cm?.files ?? []) {
    if (!TEST_RE.test(f.path) || testMap.has(f.path) || f.path === file) continue
    const t = rd(f.path)
    if (t !== null && nameRe.test(t)) testMap.set(f.path, { file: f.path, how: symbol ? 'names the symbol in its text' : 'names the file in its text' })
  }
  const tests = { count: testMap.size, method: 'tests that import the file (code map, direct or through other files) plus test files in the code map whose text names ' + (symbol ? `"${symbol}"` : `"${stem}"`) + ' as a whole word', files: [...testMap.values()].sort((a, b) => (a.file < b.file ? -1 : 1)).slice(0, 20) }

  const facts = {
    version: BRIEF_VERSION,
    meerkat: VERSION,
    found: true,
    symbolFound: true,
    target: { file, symbol, language: lang, lines: r.target.lines, module: r.target.module, exported, kind: decl?.kind ?? null, line: decl?.line ?? null, endLine: decl?.endLine ?? null, signature: decl?.signature ?? null },
    callers,
    tests,
    findings: findingsFor(env, root, file, decl),
    churn: churnFor(root, file),
  }
  facts.risk = assessRisk(facts)
  facts.checklist = buildChecklist(facts)
  return facts
}

const langOf = (p) => (/\.py$/i.test(p) ? 'python' : 'javascript')

// ---- text --------------------------------------------------------------------------------------------------------------------------------

export function briefText(b, meta) {
  if (!b.found) return `brief: ${b.target.file}\n  not found: ${b.reason}\n`
  if (b.symbolFound === false) return `brief: ${b.target.file}#${b.target.symbol}\n  unknown symbol: ${b.reason}\n`
  const t = b.target
  const L = [`# brief: ${t.file}${t.symbol ? `#${t.symbol}` : ''}`]
  L.push(`risk: ${b.risk.tier.toUpperCase()} (score ${b.risk.score}; ${b.risk.scale})`)
  for (const r of b.risk.reasons) L.push(`- ${r}`)
  L.push('', `target: ${t.language}, ${t.lines} lines, module ${t.module}${t.symbol ? `, ${t.kind} at line ${t.line}, ${t.exported ? 'exported' : 'not exported'}` : `, ${t.exported ? 'has exports' : 'no exports'}`}`)
  if (t.signature) L.push(`signature: \`${t.signature}\``)
  L.push('', `callers: ${b.callers.files}${b.callers.unknownMention ? ` (${b.callers.unknownMention} importers could not be read)` : ''}`)
  for (const c of b.callers.list) L.push(`- ${c.file}:${c.line}  ${c.function}`)
  if (b.callers.more) L.push(`- ... ${b.callers.more} more (meerkat blast ${t.file}${t.symbol ? `#${t.symbol}` : ''})`)
  if (!b.callers.files) L.push('- none found in the import graph')
  L.push('', `tests: ${b.tests.count}${b.tests.count ? '' : ' (none found)'}`)
  for (const x of b.tests.files.slice(0, 8)) L.push(`- ${x.file}  (${x.how})`)
  if (b.tests.count > 8) L.push(`- ... ${b.tests.count - 8} more`)
  if (!b.findings.available) L.push('', `findings: ${b.findings.note}`)
  else {
    L.push('', `findings (last run ${b.findings.run}): ${b.findings.onFile}${b.findings.inSymbol !== null ? `, ${b.findings.inSymbol} inside the symbol (line range is approximate)` : ''}`)
    for (const f of b.findings.items.slice(0, 5)) L.push(`- ${f.severity} ${f.check}${f.line ? `:${f.line}` : ''}  ${f.message}`)
  }
  L.push('', b.churn.available ? `churn: ${b.churn.capped ? `${b.churn.commits}+` : b.churn.commits} commits in ${b.churn.days} days, last author date ${b.churn.lastAuthorDate ?? 'none'}` : `churn: ${b.churn.note}`)
  L.push('', 'before you edit:')
  b.checklist.forEach((c, i) => L.push(`${i + 1}. ${c}`))
  if (meta) L.push('', `brief: ${meta.source} in ${meta.ms} ms`)
  if (meta?.mapLine) L.push(meta.mapLine)
  return `${L.join('\n')}\n`
}

// ---- --ref: read a file as it is on another branch, tag or commit ---------------------------------------------------------------------------

// When the file is missing from the checked-out tree, name the ref it IS on (if any) so the next command is obvious.
function missingHint(appDir, rel) {
  const checked = git(appDir, ['branch', '--show-current'])?.trim()
  const where = checked ? ` (checked out: ${checked})` : ''
  const sha1 = git(appDir, ['log', '--all', '-1', '--format=%H', '--', rel])?.trim()
  if (!sha1) return where
  const refs = (git(appDir, ['branch', '-a', '--contains', sha1, '--format=%(refname:short)']) ?? '').split('\n').map((x) => x.trim()).filter((x) => x && x !== checked && !x.startsWith('('))
  return refs.length ? `${where}. It exists on ${refs[0]}: run again with --ref ${refs[0]}` : where
}

// Runs the brief inside a temporary detached worktree at `ref`, so the file text and the callers (import graph) both come from that ref.
function runBriefAtRef({ ref, appDir, target, rel, symbol, json, env, out, err, banner = true }) {
  const sha1 = git(appDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])?.trim()
  if (!sha1) {
    err(`brief: --ref ${ref.slice(0, 80)} is not a branch, tag or commit in ${appDir}`)
    return 2
  }
  const label = `ref ${ref} (${sha1.slice(0, 7)})`
  if (git(appDir, ['cat-file', '-e', `${sha1}:${rel}`]) === null && !git(appDir, ['ls-tree', '--name-only', sha1, '--', rel])?.trim()) {
    out(json ? JSON.stringify({ found: false, version: BRIEF_VERSION, ref, folder: appDir, target: { file: rel, symbol }, reason: `the file does not exist at ${label}` }, null, 2) : `${banner ? `${folderBanner(appDir)}\n` : ''}# ${label}\nbrief: ${rel}\n  not found: the file does not exist at ${label}`)
    return 2 // a file that is not there is a usage error; 75 stays for a file the code map does not know
  }
  const tmp = mkdtempSync(join(tmpdir(), 'meerkat-brief-ref-'))
  const wt = join(tmp, 'wt')
  try {
    if (git(appDir, ['worktree', 'add', '--detach', '-q', wt, sha1]) === null) {
      err(`brief: could not check out ${ref} into a temporary folder`)
      return 2
    }
    const lines = []
    const code = runBrief([target, '--app', wt, ...(json ? ['--json'] : [])], { env, cwd: wt, out: (l) => lines.push(l), err, banner: false })
    const text = lines.join('\n')
    if (json) {
      try {
        out(JSON.stringify({ ...JSON.parse(text), ref, refSha: sha1, folder: appDir }, null, 2))
      } catch {
        out(text)
      }
    } else out(`${banner ? `${folderBanner(appDir)}\n` : ''}# ${label}\n${text}`)
    return code
  } finally {
    git(appDir, ['worktree', 'remove', '--force', wt])
    git(appDir, ['worktree', 'prune'])
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ---- run ---------------------------------------------------------------------------------------------------------------------------------

const USAGE = 'Use: meerkat brief <file>[#symbol] [--app <folder>] [--ref <branch|tag|sha>] [--json]'

export function runBrief(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`), banner = true } = {}) {
  const t0 = process.hrtime.bigint()
  let app = null
  let json = false
  let target = null
  let ref = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ref') {
      ref = argv[++i]
      if (!ref || ref.startsWith('-')) {
        err('--ref needs a branch, tag or commit, for example: meerkat brief src/a.js --ref feat')
        return 2
      }
    } else if (a === '--app') {
      app = argv[++i]
      if (!app) {
        err('--app needs a folder, for example: meerkat brief src/a.js --app ./my-app')
        return 2
      }
    } else if (a === '--json') json = true
    else if (a.startsWith('--')) {
      err(`brief: unknown option ${a.slice(0, 60)}. ${USAGE}`)
      return 2
    } else if (target === null) target = a
    else {
      err(`brief: give one target. ${USAGE}`)
      return 2
    }
  }
  if (!target || target.startsWith('#')) {
    err('brief: say which file, for example: meerkat brief src/a.js or meerkat brief src/a.js#name')
    return 2
  }
  const appDir = resolve(cwd, app ?? '.')
  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    err(`brief: ${app ?? '.'} is not a folder`)
    return 2
  }
  const { file, symbol } = parseTarget(target)
  const rel = posix.normalize(file.replace(/\\/g, '/')).replace(/^\.\//, '')
  if (ref) return runBriefAtRef({ ref, appDir, target, rel, symbol, json, env, out, err, banner })
  let content = null
  try {
    content = readFileSync(join(appDir, rel))
  } catch {
    /* handled below */
  }
  const ms = () => Math.round(Number(process.hrtime.bigint() - t0) / 1e6)
  const emit = (b, source, exit, mapMeta = null) => {
    const meta = { source, ms: ms(), ...(mapMeta ? { map: { source: mapMeta.source, refreshed: mapMeta.refreshed }, mapLine: mapRefreshLine(mapMeta) } : {}) }
    out(json ? JSON.stringify({ ...b, folder: appDir, checkout: banner ? folderInfo(appDir) : undefined, cache: meta }, null, 2) : `${banner ? `${folderBanner(appDir)}\n` : ''}${briefText(b, meta).trimEnd()}`)
    return exit
  }
  if (content === null) {
    // A bare word with no folder and no extension (`meerkat brief run`) was most likely a symbol name: say what a target is. Both cases are a usage error (exit 2).
    const bare = !/[\/.]/.test(rel)
    const reason = bare ? 'not a file: pass a path, or path#symbol' : `file not found${missingHint(appDir, rel)}`
    return emit({ found: false, version: BRIEF_VERSION, target: { file: rel, symbol }, reason }, 'none', 2)
  }

  const head = git(appDir, ['rev-parse', 'HEAD'])?.trim() ?? 'nogit'
  const dirty = dirtySignature(appDir)
  const key = dirty.ok ? sha(JSON.stringify([BRIEF_VERSION, VERSION, sha(content), rel, symbol, head, dirty.sig, runStamp(env, appDir)])).slice(0, 40) : null
  const cacheFile = key ? join(briefCacheDir(env), `${key}.json`) : null
  if (cacheFile && existsSync(cacheFile)) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, 'utf8'))
      if (c?.version === BRIEF_VERSION && c.found) return emit(c, 'cache', 0)
    } catch {
      /* unreadable cache: rebuild */
    }
  }
  const meta = cachedCodemap(appDir, { env })
  const b = buildBrief(appDir, target, { env, map: meta.map })
  if (!b.found) return emit(b, 'built', EXIT_NOT_FOUND, meta)
  if (b.symbolFound === false) return emit(b, 'built', 2, meta)
  if (cacheFile) {
    try {
      mkdirSync(briefCacheDir(env), { recursive: true })
      writeAtomic(cacheFile, JSON.stringify(b))
    } catch {
      /* a cache that cannot be written is only slower */
    }
  }
  return emit(b, cacheFile ? 'built' : 'built-uncached', 0, meta)
}
