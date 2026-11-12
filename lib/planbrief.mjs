// Plan brief (roadmap R2): one paste-ready brief for one task of a checked plan.
// Fixed sections, in this order, are never cut: Goal, Task and dependencies, Files you own, Done when, Gate, Limits, Report format.
// Over the cap (default 4000 characters): goal and notes are truncated first with a visible "[truncated]" marker,
// then the owned-file list is cut to its first N plus a count; if it still does not fit, the caller exits 2.
const MARKER = '[truncated]'
const FLOOR = 20

function transitive(task, all) {
  const byId = new Map(all.map((t) => [t.id, t]))
  const seen = []
  const walk = (t) => { for (const d of t.dependsOn ?? []) if (!seen.includes(d) && byId.has(d)) { seen.push(d); walk(byId.get(d)) } }
  walk(task)
  return seen
}

function build(task, all, goal, notes, shown) {
  const deps = transitive(task, all)
  const owns = task.owns
  const list = owns.slice(0, shown).map((p) => `- ${p}`)
  if (shown < owns.length) list.push(`- and ${owns.length - shown} more (${owns.length} in total)`)
  return [
    '## Goal',
    goal,
    '',
    '## Task and dependencies',
    `Task: ${task.id}`,
    deps.length ? `Must already be merged before you start: ${deps.join(', ')}.` : 'Depends on no other task; nothing needs to be merged first.',
    ...(notes ? ['', 'Notes:', notes] : []),
    '',
    '## Files you own (the only files you may edit)',
    ...list,
    '',
    '## Done when',
    'This command passes, run exactly as written:',
    task.done,
    '',
    '## Gate',
    `Run \`meerkat gate\` with the preset "${task.gate}" on your worktree before you commit, and report the blocking count and the log folder.`,
    '',
    '## Limits',
    `Time box: ${task.timeMinutes} minutes. Turn cap: ${task.maxTurns} turns. If you reach either, stop and report the partial state.`,
    '',
    '## Report format',
    'Under 300 words: what you changed (files), the result of the done command, the gate blocking count and log folder, the commit sha, anything left undone.',
  ].join('\n')
}

function cut(text, remove) {
  if (text.length <= FLOOR + MARKER.length) return text
  return `${text.slice(0, Math.max(FLOOR, text.length - remove - MARKER.length - 1))} ${MARKER}`
}

// task: a checked task with owns normalised; all: every checked task. Returns { ok: true, text } or { ok: false, error }.
export function renderBrief(task, all, { maxChars: cap = 4000 } = {}) {
  const maxChars = cap - 1 // the printed brief ends with a newline, which counts toward the cap
  let goal = task.goal
  let notes = task.notes ?? ''
  const len = (shown) => build(task, all, goal, notes, shown).length
  const total = task.owns.length
  if (len(total) > maxChars) {
    notes = cut(notes, len(total) - maxChars)
    if (len(total) > maxChars) goal = cut(goal, len(total) - maxChars)
  }
  let shown = total
  while (shown > 1 && len(shown) > maxChars) shown--
  const text = build(task, all, goal, notes, shown)
  if (text.length > maxChars) return { ok: false, error: `the fixed sections alone need ${text.length} characters, above the cap of ${maxChars} (--max-chars); raise the cap or shorten the done command` }
  return { ok: true, text }
}
