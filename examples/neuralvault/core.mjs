// Wrappers for the gates that already exist (the exact commands from `verify:all` in package.json) plus the
// dependency audits (flags copied from .github/workflows/security-audit.yml). Part B and C add their own files.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runCommand, lastLine } from '../../lib/exec.mjs'
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

// Fixtures ship with Meerkat, so they are absolute paths into this repo; the commands below run in the app folder.
const FIX = `${MK}/fixtures`
const NVFIX = `${MK}/examples/neuralvault/fixtures`
const SIDECAR = '../../Cargo.toml'
const RUST_PATHS = ['apps/nv-sidecar/**', 'packages/**', 'Cargo.toml', 'Cargo.lock', '.cargo/**']
const APP_PATHS = ['apps/desktop-electron/src/**', 'apps/desktop-electron/electron/**', 'apps/desktop-electron/*.json', 'apps/desktop-electron/*.ts']

// The unit-test self-test needs a failing vitest file the real run must never see, so it is copied into a
// throwaway folder inside the app (vitest resolves its own import from there), run, and removed.
async function unitTestSelfTest(ctx) {
  const dir = join(ctx.appDir, '.verify-selftest-tmp')
  mkdirSync(dir, { recursive: true })
  try {
    copyFileSync(join(NVFIX, 'unit-tests', 'broken.fixture.txt'), join(dir, 'broken.test.ts'))
    const r = await runCommand({
      cmd: 'npx',
      args: ['vitest', 'run', '--root', ctx.appDir, '--config', join(NVFIX, 'unit-tests', 'vitest.fixture.config.mjs'), '.verify-selftest-tmp/broken.test.ts'],
      cwd: ctx.appDir,
      timeoutMs: 120_000,
    })
    return { ok: r.code === 0, detail: lastLine(r.output) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const brokenCmd = (cmd, args) => ({ cmd, args, cwd: 'app', expectFail: true })

export default [
  {
    id: 'type-check',
    group: 'functionality',
    tier: 'fast',
    title: 'TypeScript type check (renderer and Electron)',
    lane: 'free',
    cost: { cpu: 2, memGB: 1 },
    estSeconds: 10,
    needs: ['npm'],
    paths: APP_PATHS,
    run: { cmd: 'npm', args: ['run', 'check'], cwd: 'app' },
    selfTest: brokenCmd('npx', ['tsc', '--noEmit', '--ignoreConfig', '--strict', `${NVFIX}/type-check/broken.ts`]),
  },
  {
    id: 'unit-tests-changed',
    group: 'functionality',
    tier: 'fast',
    supersededBy: 'unit-tests',
    title: 'Unit tests related to files changed against origin/dev',
    lane: 'free',
    cost: { cpu: 4, memGB: 3 },
    estSeconds: 100,
    needs: ['npx'],
    paths: APP_PATHS,
    run: { cmd: 'npx', args: ['vitest', 'run', '--changed', 'origin/dev', '--passWithNoTests'], cwd: 'app' },
    selfTest: unitTestSelfTest,
  },
  {
    id: 'unit-tests',
    group: 'functionality',
    tier: 'thorough',
    // The changed-files run passes with zero tests on a clean checkout (nothing is "changed"), which is a quiet pass. When nothing differs
    // from origin/dev the fast tier runs every unit test instead.
    fastWhenAll: true,
    title: 'Every unit test (vitest, npm test)',
    lane: 'free',
    cost: { cpu: 4, memGB: 3 },
    estSeconds: 120,
    needs: ['npm'],
    paths: APP_PATHS,
    run: { cmd: 'npm', args: ['test'], cwd: 'app' },
    selfTest: unitTestSelfTest,
  },
  {
    id: 'sidecar-fmt',
    group: 'functionality',
    tier: 'fast',
    title: 'Sidecar rustfmt check',
    lane: 'cargo',
    estSeconds: 5,
    needs: ['bash', 'cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['fmt', '-p', 'nv-sidecar', '--manifest-path', SIDECAR, '--check'], cwd: 'app' },
    selfTest: brokenCmd('rustfmt', ['--edition', '2021', '--check', `${FIX}/sidecar-fmt/broken.rs`]),
  },
  {
    id: 'sidecar-clippy',
    group: 'functionality',
    tier: 'fast',
    title: 'Sidecar clippy, warnings are errors',
    lane: 'cargo',
    estSeconds: 30,
    needs: ['bash', 'cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['clippy', '-p', 'nv-sidecar', '--manifest-path', SIDECAR, '--all-targets', '--', '-D', 'warnings'], cwd: 'app' },
    selfTest: { cmd: 'cargo', args: ['clippy', '--manifest-path', `${FIX}/clippy-broken/Cargo.toml`, '--', '-D', 'warnings'], cwd: 'app', expectFail: true },
  },
  {
    id: 'sidecar-tests',
    group: 'functionality',
    tier: 'thorough',
    title: 'Sidecar Rust tests (cargo test -p nv-sidecar)',
    lane: 'cargo',
    estSeconds: 150, // a guess, not measured; the learned median replaces it after the first run
    needs: ['bash', 'cargo'],
    paths: RUST_PATHS,
    // The fast tier compiles the sidecar's tests (clippy --all-targets) but never RUNS them; this does.
    // Builds in its own target folder: `cargo test` rewrites nv-sidecar.exe, and a window check that is running the sidecar has that file open
    // (seen in the first thorough run: "failed to remove file ... nv-sidecar.exe"). The first run in a new folder compiles everything once.
    run: { cmd: 'cargo', args: ['test', '-p', 'nv-sidecar', '--manifest-path', SIDECAR], cwd: 'app', env: { CARGO_TARGET_DIR: '{repo}/target/meerkat-tests' } },
    selfTest: { cmd: 'cargo', args: ['test', '--manifest-path', `${FIX}/test-broken/Cargo.toml`], cwd: 'app', expectFail: true },
  },
  {
    id: 'workspace-tests',
    group: 'functionality',
    tier: 'thorough',
    optIn: 'rust',
    title: 'Every Rust test in the workspace (cargo test --workspace); opt-in: --include rust',
    lane: 'cargo',
    estSeconds: 600, // a guess, not measured
    timeoutSeconds: 2400,
    needs: ['bash', 'cargo'],
    paths: RUST_PATHS,
    // Opt-in because two tests talk to a local Ollama model when one is running (see CLAUDE.md): with a big model
    // loaded they compete with the build for RAM. Close Ollama or accept that, then add --include rust.
    run: { cmd: 'cargo', args: ['test', '--workspace', '--manifest-path', SIDECAR], cwd: 'app', env: { CARGO_TARGET_DIR: '{repo}/target/meerkat-tests' } },
    selfTest: { cmd: 'cargo', args: ['test', '--manifest-path', `${FIX}/test-broken/Cargo.toml`], cwd: 'app', expectFail: true },
  },
  {
    id: 'build-all',
    group: 'functionality',
    tier: 'fast',
    title: 'Build renderer and Electron shell (shared by the window checks)',
    lane: 'free',
    cost: { cpu: 2, memGB: 1 },
    estSeconds: 10,
    needs: ['npm'],
    paths: APP_PATHS,
    run: { cmd: 'npm', args: ['run', 'build:all'], cwd: 'app' },
    selfTest: brokenCmd('npx', ['tsc', '--noEmit', '--ignoreConfig', '--strict', `${NVFIX}/type-check/broken.ts`]),
  },
  {
    id: 'build-sidecar',
    group: 'functionality',
    tier: 'fast',
    title: 'Build the sidecar (shared by the window checks)',
    lane: 'cargo',
    estSeconds: 50,
    needs: ['bash', 'cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['build', '-p', 'nv-sidecar', '--manifest-path', SIDECAR], cwd: 'app' },
    selfTest: { cmd: 'cargo', args: ['build', '--manifest-path', `${FIX}/build-broken/Cargo.toml`], cwd: 'app', expectFail: true },
  },
  {
    id: 'verify-sidecar',
    group: 'functionality',
    tier: 'thorough',
    title: 'Sidecar answers over its real socket (verify:sidecar)',
    lane: 'free',
    estSeconds: 6,
    after: ['build-all', 'build-sidecar'],
    needs: ['npm'],
    paths: [...APP_PATHS, ...RUST_PATHS],
    run: { cmd: 'npm', args: ['run', 'verify:sidecar'], cwd: 'app' },
    selfTest: brokenCmd('node', ['dist-electron/no-such-driver.cjs']),
  },
  {
    id: 'verify-shell',
    group: 'ui',
    tier: 'thorough',
    title: 'Electron shell starts (verify:shell)',
    lane: 'electron',
    estSeconds: 10,
    after: ['build-all'],
    needs: ['npm'],
    paths: APP_PATHS,
    run: { cmd: 'npm', args: ['run', 'verify:shell'], cwd: 'app' },
    selfTest: brokenCmd('node', ['scripts/electron-run.mjs', 'dist-electron/no-such-driver.cjs']),
  },
  {
    id: 'verify-app',
    group: 'ui',
    tier: 'thorough',
    title: 'Whole app in a real hidden window (verify:app)',
    lane: 'electron',
    estSeconds: 12,
    after: ['build-all', 'build-sidecar', 'verify-shell'],
    needs: ['npm'],
    paths: [...APP_PATHS, ...RUST_PATHS],
    run: { cmd: 'npm', args: ['run', 'verify:app'], cwd: 'app' },
    selfTest: brokenCmd('node', ['scripts/electron-run.mjs', 'dist-electron/no-such-driver.cjs']),
  },
  {
    id: 'verify-ui',
    group: 'ui',
    tier: 'thorough',
    title: 'UI integrity in a real hidden window (verify:ui)',
    lane: 'electron',
    cost: { cpu: 3, memGB: 3 },
    estSeconds: 300,
    after: ['build-all', 'build-sidecar', 'verify-app'],
    needs: ['npm'],
    paths: [...APP_PATHS, ...RUST_PATHS],
    run: { cmd: 'npm', args: ['run', 'verify:ui'], cwd: 'app' },
    selfTest: brokenCmd('node', ['scripts/electron-run.mjs', 'dist-electron/no-such-driver.cjs']),
  },
  {
    id: 'click-through',
    group: 'ui',
    tier: 'fast',
    supersededBy: 'click-through-full',
    title: 'Real-window click-through, short version, split across several windows (verify:clicks)',
    lane: 'electron',
    cost: { cpu: 6, memGB: 6 },
    estSeconds: 115,
    after: ['build-all', 'build-sidecar'],
    needs: ['npm'],
    paths: [...APP_PATHS, ...RUST_PATHS],
    // Every page, Settings section, named surface and Business page is still visited, in NV_CLICKS_SHARDS windows
    // at once; only the number of controls pressed per page is shorter than the full walk (click-through-full).
    run: { cmd: 'node', args: [`${MK}/examples/neuralvault/scripts/click-shards.mjs`], cwd: 'app', env: { NV_CLICKS_SHARDS: 'auto:6', NV_CLICKS_CELLS: 'default', NV_CLICKS_CAP: '25', NV_CLICKS_TARGET_MS: '30000' } },
    selfTest: brokenCmd('node', ['scripts/electron-run.mjs', 'dist-electron/no-such-driver.cjs']),
  },
  {
    id: 'click-through-full',
    group: 'ui',
    tier: 'thorough',
    title: 'Real-window click-through, every control, in the default look and in light, black and the smallest window',
    lane: 'electron',
    cost: { cpu: 8, memGB: 6 },
    estSeconds: 570,
    after: ['build-all', 'build-sidecar'],
    needs: ['npm'],
    paths: [...APP_PATHS, ...RUST_PATHS],
    timeoutSeconds: 1500,
    run: {
      cmd: 'node',
      args: [`${MK}/examples/neuralvault/scripts/click-shards.mjs`],
      cwd: 'app',
      env: { NV_CLICKS_SHARDS: '3', NV_CLICKS_JOBS: 'auto:4', NV_CLICKS_CELLS: 'default;theme=light;theme=black;size=1024x720,motion=1' },
    },
    selfTest: brokenCmd('node', ['scripts/electron-run.mjs', 'dist-electron/no-such-driver.cjs']),
  },
  {
    id: 'npm-audit',
    group: 'security',
    tier: 'fast',
    title: 'npm audit, high severity, shipped dependencies only',
    lane: 'free',
    estSeconds: 2,
    needs: ['npm'],
    paths: ['apps/desktop-electron/package.json', 'apps/desktop-electron/package-lock.json'],
    // Same flags as the npm-audit job in .github/workflows/security-audit.yml.
    run: { cmd: 'npm', args: ['audit', '--omit=dev', '--audit-level=high'], cwd: 'app' },
    // An offline registry makes audit fail, which is the failure this proves is not swallowed.
    selfTest: { cmd: 'npm', args: ['audit', '--omit=dev', '--audit-level=high', '--registry', 'http://127.0.0.1:9'], cwd: 'app', expectFail: true },
  },
  {
    id: 'cargo-audit',
    group: 'security',
    tier: 'fast',
    title: 'cargo audit (advisory allow-list in .cargo/audit.toml)',
    lane: 'free',
    estSeconds: 4,
    needs: ['cargo-audit'],
    paths: ['Cargo.lock', '.cargo/audit.toml'],
    // Same as the cargo-audit job in security-audit.yml: no flags, run from the repo root so .cargo/audit.toml applies.
    run: { cmd: 'cargo', args: ['audit'], cwd: 'repo' },
    selfTest: { cmd: 'cargo', args: ['audit', '--no-fetch', '--file', `${FIX}/cargo-audit/Cargo.lock`], cwd: 'repo', expectFail: true },
  },
]
