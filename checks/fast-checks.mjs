// Fast-tier checks for Meerkat, the validation tool (#3114). Contract: docs/testing/validation-tool.md.
// File name starts with "fast-" so it is owned by the fast-checks part.
import { MEERKAT_DIR as MK } from '../lib/paths.mjs';

// Lane 'cargo': the orchestrator runs these through the machine cargo lock, so the commands here are plain cargo.

export default [
  {
    id: 'rule-scan',
    group: 'security',
    tier: 'fast',
    title: 'Failure-derived rule scan (IPC, note paths, raw HTML, window hardening)',
    lane: 'free',
    estSeconds: 1,
    needs: ['node'],
    paths: ['apps/desktop-electron/src/**', 'apps/desktop-electron/electron/**', 'apps/nv-sidecar/src/**', 'packages/**/src/**'],
    run: { cmd: 'node', args: [`${MK}/rule-scan.mjs`], cwd: 'app' },
    selfTest: { cmd: 'node', args: [`${MK}/rule-scan.mjs`, '--fixtures'], cwd: 'app', expectFail: true },
  },
  {
    id: 'ui-axe',
    group: 'ui',
    tier: 'thorough',
    // The thorough tier's verify-ui runs the same axe scan on every screen and window size, so it covers this one; the fast tier used to
    // spend about 85 s of window time on it (axe-only, one size). Still runnable alone: --only ui-axe.
    supersededBy: 'verify-ui',
    title: 'Accessibility scan of every page (axe-core, new serious/critical only)',
    lane: 'electron',
    estSeconds: 90,
    // It starts the built app and its backend, so it must wait for both builds: run alongside them, it held
    // nv-sidecar.exe open and `cargo build` could not replace it (seen 2026-10-27).
    after: ['build-all', 'build-sidecar'],
    needs: ['node'],
    paths: ['apps/desktop-electron/src/**', 'apps/desktop-electron/electron/verify-ui-integrity.cts', 'apps/desktop-electron/electron/axe-baseline.json'],
    // Runs the same real-window harness as verify:ui, in axe-only mode (default window size, Personal pages).
    // The orchestrator wraps electron-lane checks in electron-lock.sh. Needs the renderer and electron builds
    // (build:all) and a built sidecar first, which the orchestrator's shared build step provides.
    run: { cmd: 'node', args: ['scripts/electron-run.mjs', 'dist-electron/verify-ui-integrity.cjs'], cwd: 'app', env: { NV_VERIFY_AXE_ONLY: '1' } },
    // A deliberately bad baseline: the harness refuses it if axe cannot read it, and a baseline that excuses
    // nothing while the config demands zero known issues must fail. Here: NV_AXE_SELFTEST_INJECT adds a fake serious
    // violation by injecting a button with no name into the page, which the unchanged baseline does not excuse.
    selfTest: { cmd: 'node', args: ['scripts/electron-run.mjs', 'dist-electron/verify-ui-integrity.cjs'], cwd: 'app', env: { NV_VERIFY_AXE_ONLY: '1', NV_AXE_SELFTEST_INJECT: '1' }, expectFail: true },
  },
  {
    id: 'vault-parser-proptest',
    group: 'functionality',
    tier: 'fast',
    title: 'Vault note parser property tests (never panics, round-trips, odd input)',
    lane: 'cargo',
    estSeconds: 293, // cold compile, measured 2026-10-28 (about 1 s warm); the learned median replaces it
    needs: ["cargo"],
    paths: ['packages/vault/**', 'Cargo.lock'],
    run: { cmd: 'cargo', args: ['test', '-p', 'nv-vault', '--lib', 'proptests'], cwd: 'repo' },
    // Self-test: the same module with a deliberately failing property enabled by a feature-less env switch.
    selfTest: { cmd: 'cargo', args: ['test', '-p', 'nv-vault', '--lib', 'proptests::selftest_broken_property'], cwd: 'repo', env: { NV_PROPTEST_SELFTEST: '1' }, expectFail: true },
  },
]
