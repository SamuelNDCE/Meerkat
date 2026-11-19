// `meerkat brief --task <plan.json> <task-id> [--max-chars N] [--json]` (roadmap C4): one context pack for one task of a checked plan.
// Sections, always in this order: Task, Files the task owns, Symbols defined there, Callers outside the task, Open risks in the owned files,
// Done command. The headings, the task block and the done command are never cut. Over the cap (default 4000 characters) the lists are cut,
// symbols first, then callers, risks, owned files, each with a visible "[truncated]" line. If the fixed parts alone exceed the cap they are
// still printed whole. Stdout only; nothing is written. The plan must pass `meerkat plan check` (else exit 1, like `plan brief`).
// Exit codes: 0 done, 1 the plan does not pass plan check, 2 usage error or unknown task id, 3 no plan file or no tasks.
// Symbols are names from a simple per-language line pattern (js/ts, python, rust, go), approximate, not a parser.
// Callers come from the same import graph as `meerkat blast`: the files that import an owned file and are not themselves owned.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { cachedCodemap } from './blast.mjs'
import { VERDICT_EXIT } from './exitcodes.mjs'
import { answerLine, checkPlan } from './plan.mjs'
import { refactorCtx } from './refactorctx.mjs'
import { collectRisks } from './risks.mjs'
import { stripControl } from './tui/safe.mjs'

export const DEFAULT_MAX_CHARS = 4000
const MARKER = '[truncated]'
const MAX_FILES = 500
const MAX_BLAST_FILES = 60
const USAGE = 'usage: meerkat brief --task <plan.json> <task-id> [--max-chars N] [--json]'
const clean = (s) => stripControl(String(s ?? '')).replace(/\s+/g, ' ').trim()
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.next', '__pycache__'])
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rs', '.go'])

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

function walk(abs, rel, out) {
  if (out.length >= MAX_FILES) return
  let entries = []
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(abs, e.name), `${rel}/${e.name}`, out)
    } else if (e.isFile()) out.push(`${rel}/${e.name}`)
  }
}

// The files a task owns: a file stays itself, a folder becomes the files in it (tracked files when git answers, else a walk).
// `planned` are owned paths that are not on disk yet (the task will create them).
export function ownedFiles(top, owns) {
  const files = []
  const planned = []
  for (const p of owns) {
    const abs = resolve(top, p)
    let st = null
    try {
      st = statSync(abs)
    } catch {
      /* not on disk */
    }
    if (!st) planned.push(p)
    else if (st.isFile()) files.push(p)
    else {
      const ls = git(top, ['ls-files', '--', p])
      if (ls !== null && ls.trim()) files.push(...ls.split('\n').map((l) => l.trim()).filter(Boolean))
      else walk(abs, p, files)
    }
  }
  return { files: [...new Set(files)].sort().slice(0, MAX_FILES), planned }
}

const JS = [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, /^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/, /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/]
const PATTERNS = {
  '.js': JS, '.mjs': JS, '.cjs': JS, '.jsx': JS, '.ts': JS, '.tsx': JS,
  '.py': [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, /^\s*class\s+([A-Za-z_]\w*)/],
  '.rs': [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|mod)\s+([A-Za-z_]\w*)/],
  '.go': [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, /^type\s+([A-Za-z_]\w*)/],
}
// Names an owned file defines (first 40, in file order). Approximate: line patterns only.
export function symbolsOf(text, ext) {
  const pats = PATTERNS[ext]
  if (!pats) return []
  const names = []
  for (const line of text.split('\n')) {
    for (const re of pats) {
      const m = re.exec(line)
      if (m && !names.includes(m[1])) {
        names.push(m[1])
        break
      }
    }
    if (names.length >= 40) break
  }
  return names
}

function build(sections, keeps) {
  const out = []
  sections.forEach((s, i) => {
    if (i) out.push('')
    out.push(`## ${s.title}`, ...s.fixed)
    if (!s.body) return
    const k = keeps[s.key]
    if (!s.body.length) out.push(s.empty)
    else out.push(...s.body.slice(0, k))
    if (k < s.body.length) out.push(`${MARKER} ${s.body.length - k} more not shown`)
  })
  return out.join('\n')
}

// sections: [{ key, title, fixed: [lines never cut], body?: [lines that may be cut], empty }]. Returns the text, at most cap-1 characters when the fixed parts allow.
export function fit(sections, cap) {
  const keeps = Object.fromEntries(sections.filter((s) => s.body).map((s) => [s.key, s.body.length]))
  const order = ['symbols', 'callers', 'risks', 'owned']
  let text = build(sections, keeps)
  while (text.length > cap - 1) {
    const key = order.find((k) => keeps[k] > 0)
    if (!key) break
    keeps[key]--
    text = build(sections, keeps)
  }
  return text
}

export function packData(task, top, cwd, env) {
  const { files, planned } = ownedFiles(top, task.owns)
  const isOwned = (f) => task.owns.some((p) => f === p || f.startsWith(`${p}/`))
  const symbols = {}
  for (const f of files) {
    const ext = extname(f).toLowerCase()
    if (!CODE_EXT.has(ext)) continue
    let text = ''
    try {
      text = readFileSync(resolve(top, f), 'utf8')
    } catch {
      continue
    }
    const names = symbolsOf(text, ext)
    if (names.length) symbols[f] = names
  }
  const callers = new Set()
  let blastNote = null
  const codeFiles = files.filter((f) => CODE_EXT.has(extname(f).toLowerCase()))
  if (codeFiles.length) {
    try {
      const meta = cachedCodemap(top, { env })
      for (const f of codeFiles.slice(0, MAX_BLAST_FILES)) {
        const r = refactorCtx(top, f, { map: meta.map, catalogDir: null })
        if (!r.found) continue
        for (const i of r.importers) if (!isOwned(i.file) && !files.includes(i.file)) callers.add(i.file)
      }
      if (codeFiles.length > MAX_BLAST_FILES) blastNote = `callers were looked up for the first ${MAX_BLAST_FILES} of ${codeFiles.length} code files`
    } catch (e) {
      blastNote = `callers could not be read: ${clean(e?.message).slice(0, 100)}`
    }
  }
  // Risks: the newest run of the folder meerkat was started in; file names are made relative to the repository root, like the plan's paths.
  let risks = []
  let riskNote = null
  const rd = collectRisks(cwd, env)
  if (!rd.ok) riskNote = 'no saved run to read the risks from (run meerkat verify first)'
  else {
    for (const e of rd.open) {
      if (e.file === null) continue
      const rel = relative(top, resolve(cwd, e.file)).split('\\').join('/')
      if (!(isOwned(rel) || files.includes(rel))) continue
      for (const f of e.findings) risks.push({ file: rel, line: f.line, severity: f.severity, check: f.check, message: f.message, next: f.next })
    }
  }
  return { owned: files, planned, symbols, callers: [...callers].sort(), blastNote, risks, riskNote }
}

export function packSections(task, d) {
  const taskLines = [`${task.id}: ${task.goal}`, `Done command: ${task.done}`, `Time box: ${task.timeMinutes} minutes. Turn cap: ${task.maxTurns} turns. Gate preset: ${task.gate}.`]
  if (task.dependsOn?.length) taskLines.push(`Depends on: ${task.dependsOn.join(', ')}.`)
  return [
    { key: 'task', title: 'Task', fixed: taskLines },
    { key: 'owned', title: 'Files the task owns', fixed: [], body: [...d.owned.map((f) => `- ${f}`), ...d.planned.map((f) => `- ${f} (not on disk yet)`)], empty: '- none found on disk' },
    { key: 'symbols', title: 'Symbols defined there', fixed: ['(approximate: names from a simple per-language pattern, not a parser)'], body: Object.entries(d.symbols).map(([f, n]) => `${f}: ${n.join(', ')}`), empty: '- none found' },
    { key: 'callers', title: 'Callers outside the task', fixed: ['(files that import an owned file, from meerkat blast; the task does not own them)'], body: [...d.callers.map((f) => `- ${f}`), ...(d.blastNote ? [`- note: ${d.blastNote}`] : [])], empty: '- none found' },
    { key: 'risks', title: 'Open risks in the owned files', fixed: [], body: d.risks.map((r) => `- ${r.file}${r.line ? `:${r.line}` : ''} [${r.severity}] ${r.check}: ${r.message} (next: ${r.next})`), empty: d.riskNote ? `- ${d.riskNote}` : '- none in the newest run' },
    { key: 'done', title: 'Done command', fixed: [task.done] },
  ]
}

export function runTaskBrief(argv, { env = process.env, cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  let planFile = null
  let id = null
  let json = false
  let max = DEFAULT_MAX_CHARS
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--task') {
      planFile = argv[++i]
      if (!planFile || planFile.startsWith('--')) return (err(`brief: --task needs a plan file. ${USAGE}`), VERDICT_EXIT.usage)
    } else if (a === '--json') json = true
    else if (a === '--max-chars') {
      const v = argv[++i]
      if (!/^\d+$/.test(v ?? '') || Number(v) <= 0) return (err(`brief: --max-chars needs a whole number above 0. ${USAGE}`), VERDICT_EXIT.usage)
      max = Number(v)
    } else if (a.startsWith('--')) return (err(`brief: unknown option ${clean(a).slice(0, 60)}. ${USAGE}`), VERDICT_EXIT.usage)
    else if (id === null) id = a
    else return (err(`brief: give one task id. ${USAGE}`), VERDICT_EXIT.usage)
  }
  if (!id) return (err(`brief: say the task id. ${USAGE}`), VERDICT_EXIT.usage)
  const r = checkPlan(planFile, { cwd })
  if (r.exitCode === VERDICT_EXIT.noResult) return (err(answerLine(r)), VERDICT_EXIT.noResult)
  if (r.exitCode !== VERDICT_EXIT.pass) {
    err(`meerkat brief --task: refused, the plan does not pass plan check\n${answerLine(r)}`)
    for (const e of r.errors) err(`  - ${e.text}`)
    return VERDICT_EXIT.fail
  }
  const task = r.tasks.find((t) => t.id === id)
  if (!task) return (err(`brief: no task "${clean(id)}" in the plan (tasks: ${r.tasks.map((t) => t.id).join(', ')})`), VERDICT_EXIT.usage)
  const top = r.top ?? cwd
  const d = packData(task, top, cwd, env)
  if (json) {
    out(JSON.stringify({ version: 1, task: { id: task.id, goal: task.goal, done: task.done, timeMinutes: task.timeMinutes, maxTurns: task.maxTurns, gate: task.gate, dependsOn: task.dependsOn }, owned: d.owned, plannedNotOnDisk: d.planned, symbols: d.symbols, symbolsNote: 'approximate: a simple per-language pattern, not a parser', callers: d.callers, risks: d.risks, done: task.done }, null, 2))
    return VERDICT_EXIT.pass
  }
  out(fit(packSections(task, d), max))
  return VERDICT_EXIT.pass
}
