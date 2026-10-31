// How a command is wrapped for its lane. The lock script paths come from env (MEERKAT_CARGO_LOCK, MEERKAT_ELECTRON_LOCK)
// with a documented default for this team's machines.
import { MEERKAT_DIR } from './paths.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { findBinary } from './which.mjs'
import { appDirOf } from './paths.mjs'
import { fileURLToPath } from 'node:url'

// A per-user settings file, outside the repo, for the lock scripts of a machine that has its own:
//   ~/.meerkat.json   { "cargoLock": "C:/path/cargo-lock.sh", "electronLock": "C:/path/electron-lock.sh" }
// Nothing machine-specific is ever written into the repo. A machine without the file uses the built-in locks.
export function userConfig(home = homedir()) {
  try {
    return JSON.parse(readFileSync(join(home, '.meerkat.json'), 'utf8'))
  } catch {
    return {}
  }
}

const CARGO_LOCK_RUN = fileURLToPath(new URL('./cargo-lock-run.mjs', import.meta.url)).split('\\').join('/')

// The layer that stops test windows opening folders, dialogs or stealing focus (electron/test-safety.cts).
// scripts/electron-run.mjs starts every driver through the boot script that applies it, so the lane only has
// to make sure the layer is built and on. A missing layer is NOT RUN, never a silent skip.
// NV_TEST_SAFETY=off turns it off, for the one self-test that proves the layer is what does the work.
export const testSafetyBoot = (env = process.env) => join(appDirOf(env), 'dist-electron', 'test-safety-boot.cjs').replace(/\\/g, '/')

export function testSafetyEnv(env = process.env, exists = existsSync) {
  if (env.NV_TEST_SAFETY === 'off') return { env: {} }
  const boot = testSafetyBoot(env)
  if (!exists(boot)) return { missing: `test safety layer not built (${boot}); run npm run build:all` }
  return { env: { NV_TEST_SAFETY: '1' } }
}

// The bash that runs a machine lock script. On Windows the word `bash` on PATH is often Microsoft's WSL launcher
// (the System32 folder's bash.exe), which fails at once when no Linux is installed (seen 2026-10-27 from PowerShell), so Git
// for Windows' own bash is looked for first: MEERKAT_BASH, then the bash next to the git on PATH, then Program Files.
// null means there is none, and the caller uses the built-in lock instead.
export function bashFor(env = process.env, exists = existsSync, platform = process.platform) {
  if (env.MEERKAT_BASH) return env.MEERKAT_BASH
  if (platform !== 'win32') return 'bash'
  const candidates = []
  const git = findBinary('git', env, platform)
  if (git) {
    candidates.push(join(dirname(dirname(git)), 'bin', 'bash.exe'))
    candidates.push(join(dirname(dirname(git)), 'usr', 'bin', 'bash.exe'))
  }
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (base) candidates.push(join(base, 'Git', 'bin', 'bash.exe'))
  }
  return candidates.find((c) => exists(c)) ?? null
}

// null means "no machine script configured": cargo then uses the built-in lock, the window lane the in-repo one.
export function cargoLockPath(env = process.env, config = userConfig()) {
  return env.MEERKAT_CARGO_LOCK || config.cargoLock || null
}
export function electronLockPath(env = process.env, config = userConfig()) {
  return env.MEERKAT_ELECTRON_LOCK || config.electronLock || null
}

// Returns { cmd, args, env } ready to spawn, or { missing: 'reason' } when the lane cannot be honoured.
export function wrapForLane(lane, cmd, args, env = process.env, exists = existsSync, config = userConfig()) {
  if (lane === 'cargo') {
    const lock = cargoLockPath(env, config)
    // A configured script that is not there is a mistake worth naming; no script at all means the built-in lock.
    const bash = lock ? bashFor(env, exists) : null
    if (!lock || !bash) return { cmd: 'node', args: [CARGO_LOCK_RUN, cmd, ...args], env: {} }
    if (!exists(lock)) return { missing: `cargo lock script not found (${lock}); fix MEERKAT_CARGO_LOCK or ~/.meerkat.json` }
    return { cmd: bash, args: [lock, cmd, ...args], env: {} }
  }
  if (lane === 'electron') {
    const lock = electronLockPath(env, config)
    const safety = testSafetyEnv(env, exists)
    if (safety.missing) return { missing: safety.missing }
    // The machine lock is optional: without it the drivers still queue through scripts/electron-lock.mjs.
    const bash = lock ? bashFor(env, exists) : null
    if (!lock || !bash || !exists(lock)) return { cmd, args, env: safety.env }
    return { cmd: bash, args: [lock, cmd, ...args], env: { ...safety.env, MEERKAT_ELECTRON_LOCK_HELD: '1' } }
  }
  return { cmd, args, env: {} }
}

export function resolveCwd(cwd, ctx) {
  // 'meerkat' is Meerkat's own folder, where the self-test fixtures are.
  return cwd === 'repo' ? ctx.repoRoot : cwd === 'meerkat' ? MEERKAT_DIR : ctx.appDir
}
