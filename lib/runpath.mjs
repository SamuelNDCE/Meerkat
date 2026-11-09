// Where a run's logs are, and for how long they stay. Printed at the end of a run (run.mjs) so nobody has to hunt for the folder.
// Run folders live under the log folder (MEERKAT_LOG_DIR, else ~/.meerkat/logs), never inside the project. Meerkat does not delete them by itself:
// a normal run's folder stays until you remove it. The one exception is `meerkat gate` and `meerkat smoke`, which keep only the newest run of each
// kind per project. The newest run of each preset is also remembered in latest-by-preset.json (lib/runlog.mjs), so `meerkat run show --preset <name>` finds it.
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { logRoot } from './runlog.mjs'

export const RETENTION_TEXT = 'Run folders are kept until you delete them (Meerkat removes none, except that gate and smoke keep only their newest run per project).'

const under = (child, parent) => {
  const c = resolve(child).toLowerCase()
  const p = resolve(parent).toLowerCase()
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}

// One or two lines: the folder of this run, how long it is kept, and a warning when it sits in the operating system's temp folder (which the system may empty).
export function runPathLines({ dir, env = process.env, temp = tmpdir() } = {}) {
  if (!dir) return []
  const lines = [`Logs of this run: ${dir}`, `${RETENTION_TEXT} Newest run per preset: ${join(logRoot(env), 'latest-by-preset.json')}`]
  if (under(dir, temp)) lines.push(`Warning: that folder is inside the temp folder (${temp}), which the system may empty. Set MEERKAT_LOG_DIR to a folder you keep.`)
  return lines
}
