// Helpers for thorough/mutation.mjs that need no mutator knowledge: diff ranges, coverage hints, equivalent-mutant heuristics, the nearest
// function, test suggestions, failing-test names, run history, result files, and which tests to run for a changed file. Zero dependencies.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'

export const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
const norm = (p) => String(p).split('\\').join('/').replace(/^\.\//, '')

// ------------------------------------------------------------ git diff
const REF_OK = /^[A-Za-z0-9_][\w./~^@{}-]{0,200}$/
function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 2 ** 20 }).trim()
  } catch {
    return null
  }
}
const commitOf = (root, ref) => git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || null

// The base a diff run compares against. { ref, sha, how, fallback } | { error } | null when there is no git base.
export function resolveBase(root, ref = null) {
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null
  const head = commitOf(root, 'HEAD')
  if (!head) return null
  if (ref) {
    if (!REF_OK.test(ref)) return { error: `the git ref "${clean(ref).slice(0, 60)}" is not a valid ref name` }
    const sha = commitOf(root, ref)
    return sha ? { ref: String(ref), sha, how: `the given ref ${ref}` } : { error: `the git ref "${clean(ref).slice(0, 60)}" does not exist here` }
  }
  for (const b of ['origin/main', 'main', 'origin/master', 'master']) {
    const mb = git(root, ['merge-base', 'HEAD', b])
    if (mb && mb !== head) return { ref: b, sha: mb, how: `merge-base with ${b}`, fallback: commitOf(root, 'HEAD~10') }
  }
  const prev = commitOf(root, 'HEAD~1')
  return prev ? { ref: 'HEAD~1', sha: prev, how: 'HEAD~1', fallback: commitOf(root, 'HEAD~10') } : null
}

// Reads `git diff -U0` text: Map<file, Array<[firstLine, lastLine]>> for the NEW side. Pure.
export function parseDiffRanges(text) {
  const out = new Map()
  let file = null
  for (const l of String(text).split('\n')) {
    if (l.startsWith('+++ ')) {
      const p = l.slice(4).replace(/\r$/, '').replace(/\t.*$/, '')
      file = p === '/dev/null' ? null : norm(p.replace(/^"?b\//, '').replace(/"$/, ''))
      if (file && !out.has(file)) out.set(file, [])
    } else if (file && l.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l)
      if (m) {
        const s = Number(m[1])
        const n = m[2] === undefined ? 1 : Number(m[2])
        if (n > 0) out.get(file).push([s, s + n - 1])
      }
    }
  }
  return out
}

// The changed lines against a base commit, working tree included. Map<file, ranges | 'all'> ('all' for files git does not track yet).
export function changedLines(root, sha) {
  const text = git(root, ['-c', 'core.quotepath=off', 'diff', '-U0', '--no-color', '--no-ext-diff', sha, '--'])
  const map = text === null ? new Map() : parseDiffRanges(text)
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard'])
  for (const f of (untracked ?? '').split('\0').filter(Boolean)) map.set(norm(f), 'all')
  return map
}
export const lineChanged = (map, file, line) => {
  const e = map.get(file)
  return e === 'all' || (Array.isArray(e) && e.some(([a, b]) => line >= a && line <= b))
}

// ------------------------------------------------------------ coverage hints (a free speed-up: uncovered lines need no test run)
const relCov = (root, p) => norm(isAbsolute(p) ? relative(root, p) : p)
export function parseLcov(text, root) {
  const map = new Map()
  let cur = null
  for (const raw of String(text).split('\n')) {
    const l = raw.trim()
    if (l.startsWith('SF:')) {
      cur = { covered: new Set(), uncovered: new Set() }
      map.set(relCov(root, l.slice(3)), cur)
    } else if (cur && l.startsWith('DA:')) {
      const [ln, hits] = l.slice(3).split(',').map(Number)
      if (Number.isFinite(ln)) (hits > 0 ? cur.covered : cur.uncovered).add(ln)
    } else if (l === 'end_of_record') cur = null
  }
  return map
}
export function parseCoverageJson(obj, root) {
  const map = new Map()
  for (const [p, v] of Object.entries(obj ?? {})) {
    if (!v || typeof v !== 'object' || !v.statementMap || !v.s) continue
    const e = { covered: new Set(), uncovered: new Set() }
    for (const [id, loc] of Object.entries(v.statementMap)) {
      const hit = Number(v.s[id]) > 0
      for (let ln = loc.start.line; ln <= Math.min(loc.end.line, loc.start.line + 200); ln++) (hit ? e.covered : e.uncovered).add(ln)
    }
    map.set(relCov(root, v.path ?? p), e)
  }
  return map
}
export function loadCoverage(root, hint = null) {
  for (const c of [hint, 'coverage/lcov.info', 'lcov.info', 'coverage/coverage-final.json'].filter(Boolean)) {
    const p = isAbsolute(c) ? c : join(root, c)
    try {
      const st = statSync(p)
      if (!st.isFile() || st.size > 64 * 2 ** 20) continue
      const text = readFileSync(p, 'utf8')
      const map = p.endsWith('.json') ? parseCoverageJson(JSON.parse(text), root) : parseLcov(text, root)
      if (map.size) return { map, file: norm(relative(root, p)), mtimeMs: st.mtimeMs }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}
// True only when the coverage file is newer than the source file (a stale report would point at the wrong lines) and says the line never ran.
export function lineUncovered(cov, root, file, line) {
  const e = cov?.map.get(file)
  if (!e || !e.uncovered.has(line) || e.covered.has(line)) return false
  try {
    return cov.mtimeMs >= statSync(join(root, file)).mtimeMs
  } catch {
    return false
  }
}

// ------------------------------------------------------------ equivalent mutants (likely no observable change)
// Lines that sit inside `if (false) {` blocks (or `if False:` in Python).
export function deadLines(masked, lang) {
  const dead = new Set()
  if (lang === 'py') {
    for (let i = 0; i < masked.length; i++) {
      const m = /^(\s*)if\s+(False|0)\s*:\s*$/.exec(masked[i])
      if (!m) continue
      for (let j = i + 1; j < masked.length && (!masked[j].trim() || masked[j].search(/\S/) > m[1].length); j++) dead.add(j + 1)
    }
    return dead
  }
  const text = masked.join('\n')
  const starts = [0]
  for (let i = 0; i < masked.length; i++) starts.push(starts[i] + masked[i].length + 1)
  const lineAt = (idx) => {
    let lo = 0
    let hi = masked.length
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (starts[mid] <= idx) lo = mid
      else hi = mid
    }
    return lo + 1
  }
  for (const m of text.matchAll(/\bif\s*\(\s*(?:false|0|!true|!1)\s*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1
    let depth = 0
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) {
        for (let ln = lineAt(open) + 1; ln < lineAt(i); ln++) dead.add(ln)
        break
      }
    }
  }
  return dead
}
// Is line `i` (0-based) a continuation of a multi-line log call?
function inLogCall(masked, i, noise) {
  for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
    const m = noise.exec(masked[j])
    if (!m) continue
    let depth = 0
    for (let k = j; k < i; k++) for (const c of k === j ? masked[k].slice(m.index) : masked[k]) depth += c === '(' ? 1 : c === ')' ? -1 : 0
    return depth > 0
  }
  return false
}
export function equivalentReason(site, ctx) {
  const raw = ctx.lines[site.line - 1] ?? ''
  const mark = /meerkat-mutation-ignore|istanbul ignore|c8 ignore|pragma:\s*no cover|Stryker disable|nocov/i.exec(raw)
  // Only a marker after the last code character counts: the same words inside a regex or a string are code.
  if (mark && mark.index >= (ctx.masked[site.line - 1] ?? '').trimEnd().length) return 'the line is marked as ignored by a comment'
  const after = raw.slice(site.col + site.len)
  if ((site.mutator === 'arith-plus-minus' || site.mutator === 'arith-minus-plus') && /^\s*0(?![\w.])/.test(after)) return 'x + 0 and x - 0 are the same'
  if (site.mutator === 'arith-times-divide' && /^\s*1(?![\w.])/.test(after)) return 'x * 1 and x / 1 are the same'
  if (ctx.dead?.has(site.line)) return 'the line is inside a branch that never runs'
  if (ctx.noise && inLogCall(ctx.masked, site.line - 1, ctx.noise)) return 'the line only feeds a log call'
  return null
}

// ------------------------------------------------------------ the nearest function, and a templated suggestion
const FN_WORDS = /^(if|for|while|switch|catch|else|function|return|do|try|using|lock|foreach|elif|with|match)$/
const FN_PATTERNS = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[([]/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/,
  /^\s*(?:(?:public|private|protected|internal|static|async|final|override|virtual|abstract|synchronized|get|set)\s+)*(?:[\w<>[\],.?]+\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::\s*[\w<>[\]|, .?]+)?\s*(?:throws [\w, ]+)?\{\s*$/,
]
export function enclosingFunction(masked, lineNo) {
  for (let i = Math.min(lineNo, masked.length) - 1; i >= Math.max(0, lineNo - 400); i--) {
    for (const re of FN_PATTERNS) {
      const m = re.exec(masked[i])
      if (m && !FN_WORDS.test(m[1])) return m[1]
    }
  }
  return '(top level)'
}

const BEHAVIOUR = {
  'arith-plus-minus': 'the computed value for inputs where adding and subtracting differ',
  'arith-minus-plus': 'the computed value for inputs where subtracting and adding differ',
  'arith-times-divide': 'the computed value for inputs other than 1',
  'arith-modulo-times': 'the remainder for a value that is not a multiple',
  'boundary-less': 'the result at the exact boundary value (equal operands)',
  'boundary-greater': 'the result at the exact boundary value (equal operands)',
  'compare-reversed': 'the result for operands on each side of the comparison',
  'equality-flip': 'both outcomes of the comparison (equal and not equal)',
  'logical-and-or': 'a case where only one side of the condition is true',
  'logical-or-and': 'a case where only one side of the condition is true',
  'logical-not-removed': 'both outcomes of the negated condition',
  'literal-boolean': 'the behaviour that depends on this flag being true and being false',
  'literal-zero-one': 'the behaviour when this value is exactly 0',
  'literal-empty-string': 'the behaviour for an empty string',
  'literal-array-emptied': 'the behaviour when this list is not empty',
  'literal-string-emptied': 'that the exact text is produced, not just any text',
  'numeric-negated': 'the behaviour for this exact number, not just its size',
  'conditional-true': 'the behaviour when the condition is false',
  'conditional-false': 'the behaviour when the condition is true',
  'conditional-negated': 'the behaviour on both sides of the condition',
  'return-nulled': 'the returned value itself, not only that the call finishes',
  'statement-removed': 'the side effect of this call',
  'increment-flip': 'the count or position after this step',
  'string-method-swap': 'a string that starts but does not end with the part (and the reverse)',
  'args-swap': 'the result when the two arguments are different values',
  'await-removed': 'that the awaited result is used (and a rejection is seen)',
  'return-guard-removed': 'the early return for the input that triggers this guard',
  'index-shift': 'the element at an index in the middle of the list',
  'minmax-swap': 'a case where the smaller and the larger value differ',
  'collection-contains-negated': 'both a present and an absent member',
  'assign-logical-flip': 'both the set and the already-set case',
  'default-param-changed': 'the call that relies on the default value',
  'optional-chain-removed': 'the case where the left side is missing',
  'nullish-to-or': 'a falsy but present value such as 0 or an empty string',
  'loop-control-swap': 'a loop that has items after the one that stops or skips',
  'loop-bound-shrunk': 'that the last item of the loop is processed',
  'else-removed': 'the case that takes the else branch',
  'py-is-flip': 'both the None and the not-None case',
  'py-in-flip': 'a member and a non-member',
  'py-range-extended': 'that exactly n items are produced, not n + 1',
  'py-return-keyword-removed': 'the returned value itself',
  'go-err-flip': 'both the error and the no-error path',
  'plusone-removed': 'the exact result including the + 1 or - 1',
  'rs-some-none': 'the Some case and its value',
  'rs-try-removed': 'the failing case that the ? passes up',
}
export const suggestionFor = (row, fn, rawLine) => {
  const cond = clean(String(rawLine ?? '').trim()).slice(0, 70)
  return `in ${fn}() at ${row.file}:${row.line} (${cond}): add a test that asserts ${BEHAVIOUR[row.mutator] ?? 'the behaviour this line controls'}`
}

// ------------------------------------------------------------ which test failed
export function parseFailingTest(tail) {
  const t = String(tail ?? '').replace(/\u001b\[[0-9;]*m/g, '')
  const tries = [
    /^\s*(?:FAIL|×|✗|✕|❯)\s+(\S.*?)(?:\s+\d+ms)?\s*$/m,
    /^\s*●\s+(\S.*?)\s*$/m,
    /^FAILED\s+(\S+)/m,
    /^\s*--- FAIL:\s+(\S+)/m,
    /^test\s+(\S+)\s+\.\.\.\s+FAILED/m,
    /^\s*not ok \d+ - (.+?)\s*$/m,
    /^\s*✖\s+(\S.*?)(?:\s+\(\d[\d.]*ms\))?\s*$/m,
  ]
  for (const re of tries) {
    const m = re.exec(t)
    if (m) return clean(m[1]).slice(0, 120)
  }
  return ''
}

// ------------------------------------------------------------ history: ~/.meerkat/mutation/<slug>.json (or <MEERKAT_LOG_DIR>/mutation/)
export const HISTORY_RUNS = 20
export const HISTORY_MAX_BYTES = 64 * 1024
export const historyHome = (env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? join(resolve(env.MEERKAT_LOG_DIR), 'mutation') : join(home, '.meerkat', 'mutation'))
export const slugOf = (root) => `${basename(resolve(root)).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'project'}-${createHash('sha1').update(resolve(root).toLowerCase()).digest('hex').slice(0, 8)}`
const historyPath = (root, env) => join(historyHome(env), `${slugOf(root)}.json`)
export function readHistory(root, env = process.env) {
  try {
    const v = JSON.parse(readFileSync(historyPath(root, env), 'utf8'))
    return Array.isArray(v) ? v.filter((e) => e && Number.isFinite(e.score) && typeof e.date === 'string').slice(-HISTORY_RUNS) : []
  } catch {
    return []
  }
}
export function appendHistory(root, entry, env = process.env) {
  const file = historyPath(root, env)
  let list = [...readHistory(root, env), { date: String(entry.date), score: entry.score, mutants: entry.mutants, killed: entry.killed, survived: entry.survived, mode: entry.mode === 'diff' ? 'diff' : 'full', ...(entry.base ? { base: clean(entry.base).slice(0, 60) } : {}) }].slice(-HISTORY_RUNS)
  while (list.length > 1 && JSON.stringify(list).length > HISTORY_MAX_BYTES) list = list.slice(1)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, `${JSON.stringify(list)}\n`)
    renameSync(tmp, file)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch {
      /* nothing to remove */
    }
    throw e
  }
  return list
}
// "trend: 72.5% (up 3.1 since 2026-10-30, a diff run)" from the runs BEFORE this one (compares like with like when it can).
export function trendLine(previous, score, mode) {
  const prev = [...previous].reverse().find((e) => e.mode === mode) ?? previous[previous.length - 1]
  if (!prev) return `trend: ${score}% (the first recorded ${mode} run for this project)`
  const d = Math.round((score - prev.score) * 10) / 10
  const word = d > 0 ? `up ${d}` : d < 0 ? `down ${Math.abs(d)}` : 'unchanged'
  return `trend: ${score}% (${word} since ${clean(prev.date).slice(0, 10)}, when it was ${prev.score}%${prev.mode === mode ? '' : `, a ${prev.mode} run`}; ${previous.length} earlier run${previous.length === 1 ? '' : 's'} kept)`
}

// ------------------------------------------------------------ result files
export const RESULT_STATES = ['killed', 'survived', 'timeout', 'error', 'equivalent']
export function validateResults(o) {
  const p = []
  if (!o || typeof o !== 'object') return ['not an object']
  if (o.schema !== 1) p.push('schema must be 1')
  for (const k of ['mode', 'command']) if (typeof o[k] !== 'string') p.push(`${k} must be a string`)
  if (!(o.score === null || Number.isFinite(o.score))) p.push('score must be a number or null')
  if (!o.counts || typeof o.counts !== 'object') p.push('counts missing')
  if (!Array.isArray(o.mutants)) return [...p, 'mutants must be a list']
  o.mutants.forEach((m, i) => {
    const w = `mutants[${i}]`
    for (const k of ['id', 'file', 'mutator', 'from', 'to']) if (typeof m[k] !== 'string') p.push(`${w}.${k} must be a string`)
    if (!Number.isInteger(m.line) || m.line < 1) p.push(`${w}.line must be a positive integer`)
    if (!RESULT_STATES.includes(m.result)) p.push(`${w}.result "${m.result}" is not one of ${RESULT_STATES.join('|')}`)
    if (!Number.isFinite(m.durationMs)) p.push(`${w}.durationMs must be a number`)
    if (typeof m.killedBy !== 'string') p.push(`${w}.killedBy must be a string`)
  })
  return p
}
export function buildResults(r, extra = {}) {
  const stateOf = (m) => m.status || { KILLED: 'killed', SURVIVED: 'survived', EQUIVALENT: 'equivalent', ERROR: 'error' }[m.result] || 'error'
  return {
    schema: 1,
    tool: 'meerkat-mutation',
    generatedAt: new Date().toISOString(),
    mode: r.mode ?? 'full',
    base: r.base?.ref ?? null,
    command: clean(r.command ?? ''),
    score: r.score ?? null,
    minScore: r.cfg?.minScore ?? null,
    counts: { killed: r.killed ?? 0, survived: r.survived ?? 0, notCovered: r.notCovered ?? 0, equivalent: r.equivalent ?? 0, errors: r.errors ?? 0 },
    stoppedEarly: r.stoppedEarly || null,
    ...extra,
    mutants: (r.mutants ?? []).map((m, i) => ({
      id: m.id ?? `m${String(i + 1).padStart(3, '0')}`,
      file: clean(m.file),
      line: m.line,
      mutator: m.mutator,
      from: clean(m.from),
      to: clean(m.to),
      result: stateOf(m),
      durationMs: Math.round(m.durationMs ?? 0),
      killedBy: clean(m.killedBy ?? ''),
      ...(m.notCovered ? { notCovered: true } : {}),
      ...(m.why ? { why: clean(m.why) } : {}),
      ...(m.fn ? { fn: clean(m.fn) } : {}),
    })),
  }
}
export function summaryMarkdown(results, lines = []) {
  const c = results.counts
  const out = [`# Mutation testing summary`, '', `- mode: ${results.mode}${results.base ? ` (base ${results.base})` : ''}`, `- command: ${results.command}`, `- score: ${results.score === null ? 'none' : `${results.score}%`} (minimum ${results.minScore}%)`, `- killed ${c.killed}, survived ${c.survived} (${c.notCovered} not covered), likely equivalent ${c.equivalent}, ignored ${c.errors}`, '']
  const surv = results.mutants.filter((m) => m.result === 'survived')
  if (surv.length) {
    out.push('## Survived mutants', '')
    for (const m of surv.slice(0, 100)) out.push(`- ${m.file}:${m.line} '${m.from}' -> '${m.to}' (${m.mutator})${m.notCovered ? ' not covered' : ''}`)
    out.push('')
  }
  const killed = results.mutants.filter((m) => m.result === 'killed' && m.killedBy)
  if (killed.length) {
    out.push('## Killed by', '')
    for (const m of killed.slice(0, 100)) out.push(`- ${m.file}:${m.line} ${m.mutator}: ${m.killedBy}`)
    out.push('')
  }
  return `${[...out, ...lines].join('\n')}\n`
}
export function writeResults(dir, results, markdown) {
  mkdirSync(dir, { recursive: true })
  const put = (name, body) => {
    const p = join(dir, name)
    const tmp = `${p}.tmp-${process.pid}`
    writeFileSync(tmp, body)
    renameSync(tmp, p)
  }
  put('mutation.json', `${JSON.stringify(results, null, 2)}\n`)
  put('mutation.md', markdown)
  return join(dir, 'mutation.json')
}

// ------------------------------------------------------------ which tests to run for a changed file
const JS_EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']
function resolveSpec(from, spec, set) {
  const base = posix.normalize(posix.join(posix.dirname(from), spec))
  const stem = base.replace(/\.(m|c)?[jt]sx?$/, '')
  const cands = [base, ...JS_EXTS.map((e) => base + e), ...JS_EXTS.map((e) => stem + e), ...JS_EXTS.map((e) => `${base}/index${e}`)]
  return cands.find((c) => set.has(c)) ?? null
}
// Map<file, Set<file>> of relative imports among the given JavaScript and TypeScript files.
export function buildImportGraph(dir, files) {
  const js = files.filter((f) => JS_EXTS.some((e) => f.endsWith(e)))
  const set = new Set(js)
  const graph = new Map()
  for (const f of js.slice(0, 4000)) {
    let text = ''
    try {
      text = readFileSync(join(dir, f), 'utf8')
    } catch {
      continue
    }
    const deps = new Set()
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](\.{1,2}(?:\/[^'"]*)?)['"]/g)) {
      const r = resolveSpec(f, m[1], set)
      if (r) deps.add(r)
    }
    graph.set(f, deps)
  }
  return graph
}
export function testsReaching(graph, tests, target) {
  const out = []
  for (const t of tests) {
    const seen = new Set([t])
    const stack = [t]
    let hit = false
    while (stack.length && !hit) {
      const cur = stack.pop()
      for (const d of graph.get(cur) ?? []) {
        if (d === target) {
          hit = true
          break
        }
        if (!seen.has(d)) {
          seen.add(d)
          stack.push(d)
        }
      }
    }
    if (hit) out.push(t)
  }
  return out
}
// The package name of the Cargo crate that owns a file, or null when it is the root package.
export function cargoCrateOf(dir, file) {
  let d = posix.dirname(file)
  for (let i = 0; i < 12; i++) {
    const p = join(dir, d === '.' ? '' : d, 'Cargo.toml')
    if (existsSync(p)) {
      if (d === '.') return null
      const m = /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/s.exec(readFileSync(p, 'utf8'))
      return m ? m[1] : null
    }
    if (d === '.') return null
    d = posix.dirname(d)
  }
  return null
}
