// Is this machine ready to run Meerkat, the validation tool? Prints one line per requirement, in the order to fix them,
// each with the exact command that fixes it, and exits 1 when something REQUIRED is missing.
//   npm --prefix apps/desktop-electron run verify:doctor
// It is also the first thing an AI assistant should run when asked to set the tool up
// (docs/testing/validation-tool-setup.md). It changes nothing: every fix is a command it prints, not one it runs.
// Every command it starts has a hard timeout and a line is printed before each, so a hang names itself.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cpus, freemem, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { bashFor, cargoLockPath } from './lib/lanes.mjs'
import { findBinary } from './lib/which.mjs'
import { resolveWidth } from './click-shards.mjs'
import { appDirOf, repoRootOf } from './lib/paths.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = appDirOf()
const repoRoot = repoRootOf(appDir)
const WIN = process.platform === 'win32'

// Run a short command; null when it is missing, fails or takes more than `seconds`.
function probe(cmd, args, seconds = 15) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: seconds * 1000, windowsHide: true })
  return r.status === 0 ? `${r.stdout}${r.stderr}`.trim().split(/\r?\n/)[0] : null
}

// Each requirement: id, whether the tool can run without it, how to tell, and the exact fix.
export function requirements(env = process.env) {
  const targetDir = env.CARGO_TARGET_DIR || join(repoRoot, 'target')
  const sidecar = join(targetDir, 'debug', WIN ? 'nv-sidecar.exe' : 'nv-sidecar')
  const nodeMajor = Number(process.versions.node.split('.')[0])
  return [
    { id: 'node', need: 'required', ok: () => (nodeMajor >= 20 ? `v${process.versions.node}` : null), fix: 'Install Node 20 or newer (the repo uses 24): https://nodejs.org' },
    { id: 'git-origin', need: 'required', ok: () => probe('git', ['-C', repoRoot, 'remote', 'get-url', 'origin']), fix: 'Run this inside a clone of the repo that has an "origin" remote.' },
    { id: 'origin-dev', need: 'required', ok: () => probe('git', ['-C', repoRoot, 'rev-parse', '--short', 'origin/dev']), fix: 'git fetch origin   (the tool compares your branch with origin/dev)' },
    { id: 'npm-install', need: 'required', ok: () => (existsSync(join(appDir, 'node_modules', '.bin')) ? 'node_modules present' : null), fix: 'npm --prefix apps/desktop-electron ci' },
    { id: 'axe-core', need: 'required', ok: () => (existsSync(join(appDir, 'node_modules', 'axe-core')) ? 'installed' : null), fix: 'npm --prefix apps/desktop-electron ci   (axe-core is a dev dependency of the accessibility check)' },
    {
      id: 'electron-binary',
      need: 'required',
      ok: () => {
        try {
          const p = createRequire(join(appDir, 'package.json'))('electron')
          return typeof p === 'string' && existsSync(p) ? 'downloaded' : null
        } catch {
          return null
        }
      },
      fix: 'npm --prefix apps/desktop-electron ci   (it downloads the Electron binary; if it stopped half way, delete node_modules/electron and run it again)',
    },
    { id: 'cargo', need: 'required', ok: () => probe('cargo', ['--version']), fix: 'Install Rust with rustup (stable toolchain): https://rustup.rs' },
    { id: 'rustfmt', need: 'required', ok: () => probe('cargo', ['fmt', '--version']), fix: 'rustup component add rustfmt' },
    { id: 'clippy', need: 'required', ok: () => probe('cargo', ['clippy', '--version']), fix: 'rustup component add clippy' },
    { id: 'cargo-audit', need: 'required', ok: () => probe('cargo', ['audit', '--version']), fix: 'cargo install cargo-audit --locked' },
    { id: 'cargo-mutants', need: 'thorough', ok: () => probe('cargo', ['mutants', '--version']), fix: 'cargo install cargo-mutants --locked   (only the thorough tier needs it)' },
    { id: 'built-renderer', need: 'required', ok: () => (existsSync(join(appDir, 'dist', 'index.html')) ? 'dist/index.html' : null), fix: 'npm --prefix apps/desktop-electron run build:all' },
    { id: 'built-electron', need: 'required', ok: () => (existsSync(join(appDir, 'dist-electron', 'test-safety-boot.cjs')) ? 'dist-electron built' : null), fix: 'npm --prefix apps/desktop-electron run build:all   (also builds the test safety layer)' },
    { id: 'built-sidecar', need: 'optional', ok: () => (existsSync(sidecar) ? sidecar : null), fix: 'not built yet in CARGO_TARGET_DIR or the repo target folder. The verify command builds it itself; npm --prefix apps/desktop-electron run build:sidecar only saves the first wait' },
    { id: 'gh', need: 'optional', ok: () => probe('gh', ['auth', 'status'], 20) && 'logged in', fix: 'Install GitHub CLI and run gh auth login (only for promotion work and filing issues)' },
    { id: 'k6', need: 'optional', ok: () => (findBinary('k6') ? 'found' : null), fix: 'Install k6 (only the opt-in sync load test)' },
    { id: 'docker', need: 'optional', ok: () => (findBinary('docker') ? 'found' : null), fix: 'Install Docker (only the opt-in ZAP scan)' },
    { id: 'nuclei', need: 'optional', ok: () => (findBinary('nuclei') ? 'found' : null), fix: 'Install Nuclei (only the opt-in staging scan)' },
    { id: 'uvx', need: 'optional', ok: () => (findBinary('uvx') ? 'found' : null), fix: 'Install uv (only the opt-in Snyk agent scan)' },
  ]
}

// How many windows this machine can run at once, and which profile to suggest.
export function advice({ cpuCount = cpus().length, freeBytes = freemem() } = {}) {
  const windows = resolveWidth('auto:6', 4, { cpus: cpuCount, freeBytes })
  const profile = windows <= 2 ? 'low' : windows >= 6 ? 'normal' : 'normal'
  return { windows, profile }
}

function main() {
  console.log(`Meerkat doctor: ${WIN ? 'Windows' : process.platform}, node ${process.versions.node}`)
  let missingRequired = 0
  let missingThorough = 0
  for (const r of requirements()) {
    process.stdout.write(`  checking ${r.id} ... `)
    let got = null
    try {
      got = r.ok()
    } catch {
      got = null
    }
    if (got) console.log(`ok (${String(got).slice(0, 80)})`)
    else {
      console.log(r.need === 'optional' ? 'not installed (optional)' : `MISSING (${r.need})`)
      console.log(`      fix: ${r.fix}`)
      if (r.need === 'required') missingRequired++
      if (r.need === 'thorough') missingThorough++
    }
  }
  const a = advice()
  const gb = (n) => (n / 2 ** 30).toFixed(1)
  console.log(`  machine: ${cpus().length} cores, ${gb(totalmem())} GB memory (${gb(freemem())} GB free now): the click-through will use up to ${a.windows} window(s) at once with the memory free now`)
  if (a.windows <= 2) console.log('      little memory is free right now (or the machine is small): close other apps, or add  -- --profile low  to the verify commands')
  const lock = cargoLockPath()
  if (cargoLockPath() || process.env.NV_ELECTRON_LOCK) console.log(`  bash for the lock scripts: ${bashFor() ?? 'none found (the built-in locks are used)'}`)
  console.log(`  cargo lock: ${lock ? (existsSync(lock) ? `machine script ${lock}` : `the configured lock script is missing (${lock}); fix NV_CARGO_LOCK or ~/.nv-verify.json`) : 'built-in lock (nothing to set up)'}`)
  if (!WIN && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.log('  display: none found. The test windows need a desktop session; on a server run under xvfb-run.')
  }
  if (missingRequired) {
    console.log(`\nNOT READY: ${missingRequired} required item(s) missing. Do the fixes above in order, then run this again.`)
    process.exit(1)
  }
  console.log(`\nREADY for the fast tier.${missingThorough ? ' The thorough tier also needs cargo-mutants (see its fix above).' : ' Ready for the thorough tier too.'}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
