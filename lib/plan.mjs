// Plan file for orchestrated work (roadmap R1): meerkat plan check <file.json> [--json]
// A plan lists tasks, each with the paths it owns, a done-check, a time box and a turn cap. `plan check` lists every error in one pass.
//   exit 0 PASS      the plan is sound
//   exit 1 FAIL      no done-check or no limit, a dependency cycle, or two tasks owning the same files with no dependsOn between them
//   exit 2 USAGE     invalid JSON, unknown field, wrong type, duplicate id, unknown dependsOn id, a path outside the repository
//   exit 3 NO_RESULT the file is missing or has no tasks
// Defaults taken for this phase (not settled): JSON only; a missing done or limit is FAIL; overlap is allowed only along a dependsOn chain.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizePath, overlaps, locate } from './claims.mjs'
import { VERDICT_EXIT, exitName, statusFields } from './exitcodes.mjs'
import { renderBrief } from './planbrief.mjs'

const TOP_FIELDS = ['version', 'name', 'base', 'tasks']
const TASK_FIELDS = ['id', 'goal', 'owns', 'done', 'timeMinutes', 'maxTurns', 'dependsOn', 'gate', 'notes']
const ID_RE = /^[a-z0-9-]+$/
const clean = (s) => String(s).replace(/[\u0000-\u001f]/g, '?')
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim())

// Returns { exitCode, errors: [{ kind: 'usage' | 'fail', text }], notes: [text], plan, tasks } where each task has `owns` normalised to repo-relative paths.
export function checkPlan(file, { cwd = process.cwd() } = {}) {
  const errors = []
  const notes = []
  const usage = (text) => errors.push({ kind: 'usage', text })
  const fail = (text) => errors.push({ kind: 'fail', text })
  const done = (exitCode, extra = {}) => ({ exitCode, errors, notes, plan: null, tasks: [], ...extra })

  let raw
  try {
    raw = readFileSync(resolve(cwd, file), 'utf8')
  } catch (e) {
    return done(VERDICT_EXIT.noResult, { missing: true, message: `cannot read plan file ${clean(file)}: ${e.code ?? e.message}` })
  }
  let plan
  try {
    plan = JSON.parse(raw)
  } catch (e) {
    usage(`invalid JSON: ${clean(e.message)}`)
    return done(VERDICT_EXIT.usage)
  }
  if (!isObj(plan)) {
    usage('the plan must be a JSON object')
    return done(VERDICT_EXIT.usage)
  }
  for (const k of Object.keys(plan)) if (!TOP_FIELDS.includes(k)) usage(`unknown field "${clean(k)}" at the top level`)
  if (plan.version !== 1) usage('version must be 1')
  for (const k of ['name', 'base']) if (plan[k] !== undefined && typeof plan[k] !== 'string') usage(`${k} must be a string`)
  if (!Array.isArray(plan.tasks)) {
    usage('tasks must be an array')
    return done(VERDICT_EXIT.usage)
  }
  if (!plan.tasks.length && !errors.length) return done(VERDICT_EXIT.noResult, { plan, message: 'the plan has no tasks' })

  const loc = locate(cwd)
  if (loc.error) {
    usage(loc.error)
    return done(VERDICT_EXIT.usage)
  }

  // ---- per task schema ----
  const ids = new Set()
  const valid = [] // tasks whose id is usable for the graph checks
  plan.tasks.forEach((t, i) => {
    const label = isObj(t) && typeof t.id === 'string' && t.id ? `task ${clean(t.id)}` : `task #${i + 1}`
    if (!isObj(t)) return usage(`${label}: must be an object`)
    for (const k of Object.keys(t)) if (!TASK_FIELDS.includes(k)) usage(`${label}: unknown field "${clean(k)}"`)
    if (typeof t.id !== 'string' || !ID_RE.test(t.id)) usage(`${label}: id must match [a-z0-9-]+`)
    else if (ids.has(t.id)) usage(`${label}: duplicate id`)
    else ids.add(t.id)
    if (isEmpty(t.goal)) usage(`${label}: goal must be a non-empty string`)
    else if (typeof t.goal !== 'string') usage(`${label}: goal must be a string`)
    if (!Array.isArray(t.owns) || !t.owns.length || t.owns.some((p) => typeof p !== 'string' || !p.trim())) usage(`${label}: owns must be a list of at least one path`)
    if (t.done === undefined || t.done === null || (typeof t.done === 'string' && !t.done.trim())) fail(`${label}: no done-check (the command that proves it done)`)
    else if (typeof t.done !== 'string') usage(`${label}: done must be a shell command string`)
    for (const [k, word] of [['timeMinutes', 'time box in minutes'], ['maxTurns', 'turn cap']]) {
      if (t[k] === undefined || t[k] === null) fail(`${label}: no ${k} (${word})`)
      else if (!Number.isInteger(t[k]) || t[k] <= 0) usage(`${label}: ${k} must be an integer above 0`)
    }
    if (t.dependsOn !== undefined && (!Array.isArray(t.dependsOn) || t.dependsOn.some((d) => typeof d !== 'string'))) usage(`${label}: dependsOn must be a list of task ids`)
    if (t.gate !== undefined && (typeof t.gate !== 'string' || !t.gate.trim())) usage(`${label}: gate must be a preset name`)
    if (t.notes !== undefined && typeof t.notes !== 'string') usage(`${label}: notes must be a string`)
    if (typeof t.id === 'string' && ID_RE.test(t.id)) valid.push(t)
  })

  // ---- dependsOn ----
  const byId = new Map(valid.map((t) => [t.id, t]))
  for (const t of valid) {
    if (!Array.isArray(t.dependsOn)) continue
    for (const d of t.dependsOn) if (!ids.has(d)) usage(`task ${t.id}: dependsOn names unknown task "${clean(d)}"`)
  }
  const deps = (t) => (Array.isArray(t.dependsOn) ? t.dependsOn.filter((d) => byId.has(d)) : [])

  // ---- cycles (each reported once, named) ----
  const state = new Map()
  const stack = []
  const seenCycles = new Set()
  const visit = (id) => {
    state.set(id, 1)
    stack.push(id)
    for (const d of deps(byId.get(id))) {
      if (state.get(d) === 1) {
        const cyc = [...stack.slice(stack.indexOf(d)), d]
        const key = [...cyc.slice(0, -1)].sort().join(',')
        if (!seenCycles.has(key)) {
          seenCycles.add(key)
          fail(`dependency cycle: ${cyc.join(' -> ')}`)
        }
      } else if (!state.has(d)) visit(d)
    }
    stack.pop()
    state.set(id, 2)
  }
  for (const t of valid) if (!state.has(t.id)) visit(t.id)

  // ---- ownership ----
  const owned = new Map()
  for (const t of valid) {
    if (!Array.isArray(t.owns)) continue
    const paths = []
    for (const p of t.owns) {
      if (typeof p !== 'string' || !p.trim()) continue
      const n = normalizePath(p, cwd, loc.top)
      if (!n) usage(`task ${t.id}: path "${clean(p)}" is outside this repository`)
      else if (!paths.includes(n)) paths.push(n)
    }
    owned.set(t.id, paths)
  }
  const ancestors = (id) => {
    const out = new Set()
    const walk = (x) => { for (const d of deps(byId.get(x))) if (!out.has(d)) { out.add(d); walk(d) } }
    walk(id)
    return out
  }
  const anc = new Map(valid.map((t) => [t.id, ancestors(t.id)]))
  const ownIds = [...owned.keys()]
  for (let i = 0; i < ownIds.length; i++) {
    for (let j = i + 1; j < ownIds.length; j++) {
      const a = ownIds[i]
      const b = ownIds[j]
      const hits = []
      for (const pa of owned.get(a)) for (const pb of owned.get(b)) if (overlaps(pa, pb)) hits.push(pa === pb ? pa : `${pa} / ${pb}`)
      if (!hits.length) continue
      const shown = hits.slice(0, 3).join(', ') + (hits.length > 3 ? `, and ${hits.length - 3} more` : '')
      if (anc.get(a).has(b)) notes.push(`overlap allowed: ${a} depends on ${b} (${shown})`)
      else if (anc.get(b).has(a)) notes.push(`overlap allowed: ${b} depends on ${a} (${shown})`)
      else fail(`tasks ${a} and ${b} own overlapping paths with no dependsOn between them: ${shown}`)
    }
  }

  const exitCode = errors.some((e) => e.kind === 'usage') ? VERDICT_EXIT.usage : errors.length ? VERDICT_EXIT.fail : VERDICT_EXIT.pass
  const tasks = valid.map((t) => ({ ...t, owns: owned.get(t.id) ?? [], gate: t.gate ?? 'quick', dependsOn: deps(t) }))
  return done(exitCode, { plan, tasks, top: loc.top })
}

// The answer, line 1 first: "FAIL (status 422): 2 errors: task b: no done-check ...".
export function answerLine(r) {
  const word = { 0: 'PASS', 1: 'FAIL', 2: 'USAGE', 3: 'NO-RESULT' }[r.exitCode] ?? 'NO-RESULT'
  const { status } = statusFields({ exitCode: r.exitCode, notFound: r.missing })
  if (r.exitCode === VERDICT_EXIT.noResult) return `${word} (status ${status}): ${r.message}`
  if (r.exitCode === VERDICT_EXIT.pass) return `PASS (status ${status}): ${r.tasks.length} task${r.tasks.length === 1 ? '' : 's'}, no errors, no overlapping ownership${r.notes.length ? ` (${r.notes.length} overlap${r.notes.length === 1 ? '' : 's'} allowed by dependsOn)` : ''}`
  const n = r.errors.length
  const shown = r.errors.slice(0, 3).map((e) => e.text).join('; ')
  return `${word} (status ${status}): ${n} error${n === 1 ? '' : 's'}: ${shown}${n > 3 ? `; and ${n - 3} more` : ''}`
}

const USE_CHECK = 'usage: meerkat plan check <file.json> [--json]'
const USE_BRIEF = 'usage: meerkat plan brief <file.json> <task-id> [--max-chars N]'

export function runPlan(args, { cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  const [sub, ...rest] = args
  if (sub === 'check') {
    const words = rest.filter((a) => !a.startsWith('--'))
    const bad = rest.find((a) => a.startsWith('--') && a !== '--json')
    if (bad) { err(`meerkat plan check: unknown option ${clean(bad)}\n${USE_CHECK}`); return VERDICT_EXIT.usage }
    if (words.length !== 1) { err(`meerkat plan check: say which plan file\n${USE_CHECK}`); return VERDICT_EXIT.usage }
    const r = checkPlan(words[0], { cwd })
    if (rest.includes('--json')) {
      out(JSON.stringify({ exitCode: r.exitCode, exitName: exitName(r.exitCode), ...statusFields({ exitCode: r.exitCode, notFound: r.missing }), answer: answerLine(r), errors: r.errors, notes: r.notes, tasks: r.tasks.length }, null, 2))
      return r.exitCode
    }
    out(answerLine(r))
    for (const e of r.errors) out(`  - ${e.text}`)
    for (const n of r.notes) out(`  - ${n}`)
    return r.exitCode
  }
  if (sub === 'brief') {
    const words = []
    let max = 4000
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]
      if (a === '--max-chars') {
        const v = rest[++i]
        if (!/^\d+$/.test(v ?? '') || Number(v) <= 0) { err(`meerkat plan brief: --max-chars needs a whole number above 0\n${USE_BRIEF}`); return VERDICT_EXIT.usage }
        max = Number(v)
      } else if (a.startsWith('--')) { err(`meerkat plan brief: unknown option ${clean(a)}\n${USE_BRIEF}`); return VERDICT_EXIT.usage }
      else words.push(a)
    }
    if (words.length !== 2) { err(`meerkat plan brief: say the plan file and the task id\n${USE_BRIEF}`); return VERDICT_EXIT.usage }
    const r = checkPlan(words[0], { cwd })
    if (r.exitCode === VERDICT_EXIT.noResult) { err(answerLine(r)); return VERDICT_EXIT.noResult }
    if (r.exitCode !== VERDICT_EXIT.pass) {
      err(`meerkat plan brief: refused, the plan does not pass plan check\n${answerLine(r)}`)
      for (const e of r.errors) err(`  - ${e.text}`)
      return VERDICT_EXIT.fail
    }
    const task = r.tasks.find((t) => t.id === words[1])
    if (!task) { err(`meerkat plan brief: no task "${clean(words[1])}" in the plan (tasks: ${r.tasks.map((t) => t.id).join(', ')})`); return VERDICT_EXIT.usage }
    const b = renderBrief(task, r.tasks, { maxChars: max })
    if (!b.ok) { err(`meerkat plan brief: ${b.error}`); return VERDICT_EXIT.usage }
    out(b.text)
    return VERDICT_EXIT.pass
  }
  err(`meerkat plan: say check or brief\n${USE_CHECK}\n${USE_BRIEF}`)
  return VERDICT_EXIT.usage
}
