// The built-in cargo lock: `node cargo-lock-run.mjs cargo build ...` waits until no other cargo job started this
// way is running on the machine, runs the command, and lets go. Used when no machine lock script is configured
// (NV_CARGO_LOCK or ~/.nv-verify.json), so a fresh machine needs no setup. Same protocol as the Electron lock: an
// atomic mkdir, a holder that has gone is cleared at once, waiting too long exits 75 ("NOT RUN, stop and report").
// Cargo's own -j only limits one invocation; several worktrees or agents building at once froze a machine once,
// which is why every cargo job takes this lock.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appDirOf, importFromApp } from './paths.mjs'

// The lock code lives with the app (scripts/electron-lock.mjs); the cargo lock reuses it with its own folder.
const { runLocked } = await importFromApp(appDirOf(), 'scripts/electron-lock.mjs')

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: node cargo-lock-run.mjs <command> [args]')
  process.exit(2)
}
const dir = process.env.NV_CARGO_LOCK_DIR || join(tmpdir(), 'nv-cargo.lock')
const code = await runLocked(command, args, {
  env: { ...process.env, NV_ELECTRON_LOCK_DIR: dir, NV_ELECTRON_LOCK_HELD: '', NV_ELECTRON_LOCK_SH: '' },
  cwd: process.cwd(),
  maxWaitMs: Number(process.env.CARGO_LOCK_MAX_WAIT ?? 900) * 1000,
})
process.exit(code)
