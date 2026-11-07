// Which run a read tool means. Every tool that reads a saved run takes the same three optional arguments: `folder` (the project, checked like
// the write tools' folder), `run` (a run folder name or the start of one) and `preset` (the newest run of that preset in that folder).
// Without them the tool reads the newest run of any project, as it always did, and says which project and run that was.
const RUN_ID = /^[0-9A-Za-z._-]+$/

export const READ_FOLDER = { type: 'string', description: 'The project folder whose run to read. Must be inside the folder the server was started in or one added with `meerkat root add`. Pass it on every call: without it the newest run of ANY project is read.' }
export const READ_SCOPE_PROPS = {
  folder: READ_FOLDER,
  run: { type: 'string', pattern: '^[0-9A-Za-z._-]+$', description: 'A run folder name (or the start of one) from meerkat_run_list. With folder, the run must belong to that folder. Beats preset.' },
  preset: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', description: 'Read the newest run of this preset or command (full, security, quick, self-test); with folder, the newest of that preset in that folder.' },
}
export const SCOPE_KEYS = ['folder', 'run', 'preset']

// { pickFolder } -> readScope(args, ctx) -> { error } | { pick, info, folder }. `pick` is what the readers of lib/runlog.mjs take; `info` says which project and run.
export function makeReadScope({ pickFolder }) {
  return function readScope(args, ctx) {
    const pick = {}
    for (const k of ['run', 'preset']) {
      if (args[k] === undefined) continue
      if (typeof args[k] !== 'string' || !RUN_ID.test(args[k])) return { error: `${k} must be a run folder name or preset name (letters, digits, dots, dashes)` }
      pick[k] = args[k]
    }
    if (args.folder === undefined) return { pick, info: ctx.runInfo?.(pick) ?? null, folder: null }
    const f = pickFolder({ folder: args.folder }, ctx)
    if (f.error) return { error: f.error }
    if (typeof ctx.resolveRun !== 'function') return { error: 'this server cannot look up the runs of a folder' }
    const r = ctx.resolveRun({ folder: f.folder, run: pick.run, preset: pick.preset })
    if (!r?.ok) return { error: r?.text ?? 'No run has been saved for that folder yet.' }
    return { pick: { run: r.id }, info: r, folder: f.folder }
  }
}

// The small block every result carries so a reader knows which project and run were read.
export function contextOf(info, doc = null) {
  const project = info?.project?.name ?? doc?.run?.project?.name ?? null
  const path = info?.project?.path ?? doc?.run?.project?.path ?? null
  const run = info?.id ?? doc?.run?.id ?? null
  return { project, projectPath: path, run, preset: info?.preset ?? null }
}
