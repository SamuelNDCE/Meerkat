// The check that proves test windows cannot open folders, dialogs or steal focus (issue #3114).
// The layer itself (electron/test-safety.cts) is injected by the electron lane in lib/lanes.mjs.
export default [
  {
    id: 'test-safety',
    group: 'ui',
    tier: 'fast',
    title: 'Test windows cannot open folders or dialogs, or take focus',
    lane: 'electron',
    estSeconds: 8,
    // The window needs dist-electron/test-safety-boot.cjs, which build-all writes (ledger F-388).
    after: ['build-all'],
    needs: ['node'],
    paths: ['apps/desktop-electron/electron/test-safety.cts', 'apps/desktop-electron/electron/verify-test-safety.cts'],
    run: { cmd: 'node', args: ['scripts/electron-run.mjs', 'dist-electron/verify-test-safety.cjs'], cwd: 'app' },
    // With the layer switched off the harness must notice and fail.
    selfTest: { cmd: 'node', args: ['scripts/electron-run.mjs', 'dist-electron/verify-test-safety.cjs'], cwd: 'app', env: { NV_TEST_SAFETY: 'off' }, expectFail: true },
  },
]
