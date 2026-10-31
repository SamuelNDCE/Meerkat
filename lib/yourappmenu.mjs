// The interactive side of the "Your app" menu rows: the list of your checks, a check's details, adding, editing, removing, and the ideas.
// The screens are lib/yourappscreen.mjs (pure). Writing a check is the same code as `meerkat check new|edit|remove` and `meerkat recommend --add`
// (lib/yourapp.mjs), so the menu and the commands cannot disagree. Project code (.meerkat/checks, extraChecks) is never loaded here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadProject } from './projectchecks.mjs'
import { recommend } from './recommend.mjs'
import { latestRunDir } from './runlog.mjs'
import { mineRows, yourAppCommand } from './yourapp.mjs'
import { checkDetailLines, checkItems, checksHint, ideaDetailLines, ideaItems, ideasHint, listStep, renderDetailScreen } from './yourappscreen.mjs'

// What the menu needs to know about the project's own checks. Config-defined checks are data, so they are listed; files of code are not loaded.
export async function yourAppInfo(path, env = process.env) {
  const safe = { ...env, MEERKAT_NO_PROJECT_CODE: '1' }
  const project = await loadProject(path, { env: safe })
  return { project, rows: mineRows(project, { env: safe }), ideas: recommend(project.appDir, { checks: project.checks }).ideas }
}

// The newest run's result for each check: Map id -> { status, ms }.
export function lastResults(env = process.env) {
  const out = new Map()
  try {
    const dir = latestRunDir(env)
    if (!dir) return out
    const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
    for (const r of s.results ?? []) if (r && typeof r.id === 'string') out.set(r.id, { status: r.status, ms: r.ms })
  } catch {
    /* no run yet */
  }
  return out
}

// io = { drawList(items, cursor, { question, hint }), anyKey(), askLine(question), yesNo(question) } from lib/menu.mjs.
function commandContext(term, project, env, io) {
  const lines = []
  const out = (t) => lines.push(String(t))
  return {
    lines,
    ctx: { out, err: out, env, cwd: project, interactive: true, ask: async (q) => (await io.askLine(q)) ?? '' },
    h: {
      canAsk: () => true,
      confirm: async (_c, f, q) => (f.yes ? true : io.yesNo(q)),
      needYes: () => 2,
      defaultAsk: async (q) => (await io.askLine(q)) ?? '',
    },
  }
}

async function runCommand(term, key, plan, project, env, io) {
  const { ctx, h, lines } = commandContext(term, project, env, io)
  const code = await yourAppCommand(key, { folder: project, ...plan }, ctx, h)
  if (lines.length) {
    term.print(lines.join('\n'))
    await io.anyKey()
  }
  return code
}

const draw = (term, lines, extra = {}) => term.draw(renderDetailScreen(lines, { project: extra.project, version: term.version, question: extra.question ?? '', width: term.width(), rows: term.rows(), color: term.color, level: term.level, env: term.env, isTTY: Boolean(term.stdout.isTTY), hint: extra.hint }))

// The list of your checks. Returns { runArgs } to run one, { abort: true } on Ctrl+C, or null to go back to the menu.
export async function checksScreen(term, project, env, io) {
  let cursor = 0
  for (;;) {
    const info = await yourAppInfo(project, env)
    if (!info.rows.length) {
      term.print("No checks of your own yet. Choose 'Add a test for this app' on the menu to add one.")
      await io.anyKey()
      return null
    }
    const items = checkItems(info.rows, lastResults(env))
    let state = { items, cursor: Math.min(cursor, items.length - 1), multi: false }
    io.drawList(items, state.cursor, { question: "Your app's checks", hint: checksHint })
    const step = listStep(state, await term.key(), 'checks')
    state = step.state
    cursor = state.cursor
    // redraw loop for plain moves: draw again with the new cursor
    let action = step.action
    while (!action) {
      io.drawList(items, state.cursor, { question: "Your app's checks", hint: checksHint })
      const s = listStep(state, await term.key(), 'checks')
      state = s.state
      cursor = state.cursor
      action = s.action
    }
    term.clear()
    if (action.type === 'abort') return { abort: true }
    if (action.type === 'back') return null
    const row = action.item ? info.rows.find((r) => r.id === action.item.value) : null
    const runIt = (r) => ({ runArgs: ['--app', project, '--only', r.id, '--all'] })
    if (action.type === 'run') return runIt(row)
    if (action.type === 'add') await runCommand(term, 'check new', {}, project, env, io)
    else if (action.type === 'edit') await runCommand(term, 'check edit', { id: row.id, flags: {} }, project, env, io)
    else if (action.type === 'remove') await runCommand(term, 'check remove', { id: row.id, flags: {} }, project, env, io)
    else if (action.type === 'open') {
      draw(term, checkDetailLines(row, lastResults(env).get(row.id)), { project })
      const k = await term.key()
      term.clear()
      if (k === 'ctrl-c') return { abort: true }
      if (k === 'r') return runIt(row)
      if (k === 'e') await runCommand(term, 'check edit', { id: row.id, flags: {} }, project, env, io)
      if (k === 'x') await runCommand(term, 'check remove', { id: row.id, flags: {} }, project, env, io)
    }
  }
}

// "Add a test for this app": the same questions as `meerkat check new`.
export async function addTestScreen(term, project, env, io) {
  await runCommand(term, 'check new', { flags: {} }, project, env, io)
}

// The ideas: Enter shows why, a adds the highlighted one, A adds all of them (after a question).
export async function ideasScreen(term, project, env, io) {
  let cursor = 0
  for (;;) {
    const info = await yourAppInfo(project, env)
    if (!info.ideas.length) {
      term.print('No more ideas: everything this folder could run is already a check.')
      await io.anyKey()
      return null
    }
    const items = ideaItems(info.ideas)
    let state = { items, cursor: Math.min(cursor, items.length - 1), multi: false }
    let action = null
    while (!action) {
      io.drawList(items, state.cursor, { question: `Ideas: tests this app could run (${items.length})`, hint: ideasHint })
      const s = listStep(state, await term.key(), 'ideas')
      state = s.state
      cursor = state.cursor
      action = s.action
    }
    term.clear()
    if (action.type === 'abort') return { abort: true }
    if (action.type === 'back') return null
    if (action.type === 'open') {
      const idea = info.ideas.find((i) => i.id === action.item.value)
      draw(term, ideaDetailLines(idea), { project, hint: '  a add it   any other key goes back' })
      const k = await term.key()
      term.clear()
      if (k === 'ctrl-c') return { abort: true }
      if (k === 'a') await runCommand(term, 'recommend list', { flags: { add: idea.id } }, project, env, io)
    } else if (action.type === 'add') await runCommand(term, 'recommend list', { flags: { add: action.item.value } }, project, env, io)
    else if (action.type === 'addall') await runCommand(term, 'recommend list', { flags: { add: 'all' } }, project, env, io)
  }
}
