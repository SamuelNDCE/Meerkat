// Starts run.mjs with the terminal handed over. Apart from lib/menu.mjs so a plain run (an AI calling meerkat) does not load the menu and its screens first.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { MEERKAT_DIR } from './paths.mjs'
import { markPartial } from './cost.mjs'

// Returns its exit code.
export function spawnRun(args, { env = process.env, cwd = process.cwd() } = {}) {
  markPartial() // the child writes straight to the terminal: lib/cost.mjs records a lower bound
  const r = spawnSync(process.execPath, [join(MEERKAT_DIR, 'run.mjs'), ...args], { stdio: 'inherit', env, cwd })
  return r.status ?? (r.signal ? 130 : 1)
}
