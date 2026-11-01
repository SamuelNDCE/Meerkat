# Adding a click-through test for your app

A click-through opens the real app, visits every page, presses the controls and fails if a page crashes or a control does nothing. Meerkat does not ship a browser driver of its own. It runs yours, schedules it so it does not fight other heavy checks, times it, and reports the result like any other check. This page shows how to wire one in, per app, in a few minutes.

What Meerkat gives you: a place in the run (an `electron` lane so only one window group runs at once), a time estimate it learns, a timeout, a log, a finding with the last lines of output, and a self-test slot. What you give it: one command that opens the app, clicks, and exits non-zero when something is wrong.

## 1. Write the driver (or use the one you have)

Any command works, as long as it follows the exit-code rule from [writing-checks.md](writing-checks.md#what-a-commands-exit-code-means): 0 means every page loaded and every control reacted, 1 means a problem (print the one that matters last), 75 means it could not start here (no display, app not built). Typical shapes:

- an npm script your project already has (`npm run test:e2e`, `npm run verify:clicks`)
- a Node script that launches the app through your browser-automation library of choice and walks a list of pages

A good driver does these four things, because they are what the NeuralVault one does and what catches real bugs:

| It does | Because |
|---|---|
| visits every route or page from a list, not only the ones you remember | a page nobody opens is where the crash is |
| presses each visible control and checks that something changed (a route, a dialog, text, a request) | a button that does nothing is a bug |
| listens for page errors, console errors and failed requests during the walk | a crash with no visible sign is still a crash |
| exits 75, not 0, when it cannot start | a skipped click-through must never look like a passed one |

## 2. Register it as a check

The quickest way, when you already have the command:

```bash
meerkat check new --id click-through --cmd "npm run test:e2e" --yes
```

For control over the lane, tier, time and self-test, put a file in `.meerkat/checks/` (found with no setting; see [writing-checks.md](writing-checks.md#three-ways-in)):

```js
export default [
  {
    id: 'click-through',
    group: 'ui',
    tier: 'thorough',
    title: 'Real-window click-through: every page, every control',
    lane: 'electron',
    weight: 'heavy',
    estSeconds: 180,
    timeoutSeconds: 900,
    after: ['build'],
    needs: ['npm'],
    paths: ['src/**', 'electron/**'],
    run: { cmd: 'npm', args: ['run', 'test:e2e'], cwd: 'app' },
    selfTest: { cmd: 'node', args: ['scripts/no-such-driver.mjs'], cwd: 'app', expectFail: true },
  },
]
```

Choose the tier on purpose: `fast` runs in the quick preset, so keep it short (a few pages); `thorough` can walk everything. NeuralVault ships both: a short version split over several windows in `fast`, and a full one in `thorough` that replaces the short one when both are selected (`supersededBy`).

`lane: 'electron'` is what stops two window-opening checks from running at once. Use `free` only for a check that opens no window.

## 3. Prove it works

The `selfTest` runs the same driver against something deliberately broken and expects a failure. Without it nobody knows the check can fail. Run `meerkat self-test` (or the self-test option in the menu) once after adding the check.

## 4. See how a big one is built

The NeuralVault example splits one walk across several windows to cut the time, and varies the look (light, black, small window, reduced motion). Read `examples/neuralvault/core.mjs` (the `click-through` and `click-through-full` checks) and `examples/neuralvault/scripts/click-shards.mjs`. Its settings are environment variables (`NV_CLICKS_SHARDS`, `NV_CLICKS_CELLS`, `NV_CLICKS_CAP`), set in the check's `run.env`.

## Not built yet

A generic driver that walks any web or Electron app with no code from you is not part of Meerkat today. It is tracked as a planned feature: a `clicks` pack that reads a short list of pages from `meerkat.config.json`, opens each, presses the visible controls and reports page errors. Until it exists, step 1 is the work you do once per app.
