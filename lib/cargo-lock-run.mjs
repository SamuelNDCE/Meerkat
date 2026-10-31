// The built-in cargo lock: `node cargo-lock-run.mjs cargo build ...` waits until no other cargo job started this way is running on the
// machine, runs the command, and lets go. Used when no machine lock script is configured (MEERKAT_CARGO_LOCK or ~/.meerkat.json), so a
// fresh machine needs no setup. The lock is lib/lock.mjs: an atomic mkdir, a holder that has gone is cleared at once, and waiting too
// long exits 75 ("NOT RUN, stop and report"). Cargo's own -j only limits one invocation; several worktrees or agents building at once
// froze a machine once, which is why every cargo job takes this lock.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLocked } from './lock.mjs'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: node cargo-lock-run.mjs <command> [args]')
  process.exit(2)
}
const dir = process.env.MEERKAT_CARGO_LOCK_DIR || join(tmpdir(), 'meerkat-cargo.lock')
const code = await runLocked(command, args, {
  dir,
  env: process.env,
  cwd: process.cwd(),
  maxWaitMs: Number(process.env.CARGO_LOCK_MAX_WAIT ?? 900) * 1000,
})
process.exit(code)
