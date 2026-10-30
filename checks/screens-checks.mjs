// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Part D of Meerkat, the validation tool (#3114): a real-window screenshot and UX check of the primary pages.
// The harness is electron/verify-screens.cts. Screenshots go to NV_SCREENS_DIR (default a temp folder, printed).
import { runCommand, lastLine } from '../lib/exec.mjs'
import { wrapForLane } from '../lib/lanes.mjs'

const APP_PATHS = ['apps/desktop-electron/src/**', 'apps/desktop-electron/electron/**', 'apps/desktop-electron/*.json', 'apps/desktop-electron/*.ts']
const RUST_PATHS = ['apps/nv-sidecar/**', 'packages/**', 'Cargo.toml', 'Cargo.lock', '.cargo/**']
const DRIVER = ['scripts/electron-run.mjs', 'dist-electron/verify-screens.cjs']

// The self-test injects ONE kind of fault at a time and the check must FAIL on each of them. All three are tried:
// a console error, a visible error card, and a blank (single colour) page. The runner inverts a function
// self-test (ok = the check passed), so this returns ok:true only when a broken page slipped through.
async function screensSelfTest(ctx) {
  const kinds = ['console', 'error', 'blank', 'cover']
  const missed = []
  for (const kind of kinds) {
    const wrapped = wrapForLane('electron', 'node', DRIVER, ctx.env, ctx.exists)
    const r = await runCommand({
      cmd: wrapped.cmd,
      args: wrapped.args,
      cwd: ctx.appDir,
      env: { ...wrapped.env, NV_SCREENS_SELFTEST_INJECT: '1', NV_SCREENS_INJECT_ONLY: kind, NV_SCREENS_ONLY: 'Dashboard,Library' },
      timeoutMs: 240_000,
    })
    if (r.code === 75) return { ok: false, detail: `could not run (${lastLine(r.output)}), so no proof` }
    if (r.code === 0) missed.push(kind)
  }
  return missed.length === 0
    ? { ok: false, detail: 'failed on each of: console error, error card, blank page, covered text' }
    : { ok: true, detail: `passed a broken page with: ${missed.join(', ')}` }
}

export default [
  {
    id: 'ui-screens',
    group: 'ui',
    tier: 'fast',
    title: 'Screenshots and UX of the primary pages (blank, errors, scroll, clipping, motion)',
    lane: 'electron',
    estSeconds: 15,
    after: ['build-all', 'build-sidecar'],
    needs: ['node'],
    paths: [...APP_PATHS, ...RUST_PATHS],
    run: { cmd: 'node', args: DRIVER, cwd: 'app' },
    selfTest: screensSelfTest,
  },
]
