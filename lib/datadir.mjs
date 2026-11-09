// The folder Meerkat keeps its own small state files in (timings, run history): MEERKAT_LOG_DIR when set, else ~/.meerkat.
// Never the bare home folder, so a run with MEERKAT_LOG_DIR set (a test, a CI job, an agent) leaves nothing in HOME.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const dataDir = (env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? resolve(env.MEERKAT_LOG_DIR) : join(home, '.meerkat'))
