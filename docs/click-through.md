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

> \*Corrected: the scenario runner below is the generic mechanism. It still ships no browser driver (Meerkat has no dependencies); the driver stays the project's own, but the click path is now a data file instead of code.


---

# Scenario click-throughs: the click path as a data file

The sections above wire in a driver script you write yourself. This part is the generic route: the click path is a JSON file (a scenario), Meerkat runs it step by step through a small **driver** command your project names, enforces a timeout on every step, and reports pass or fail with evidence. An AI can write the scenario for an app without writing a test framework. Meerkat has no dependencies and does not bundle a browser library: the driver is the only part that knows your stack.

```
node lib/clickthrough.mjs <scenario.json> [--root <dir>] [--out <dir>]
```

| Exit code | Meaning |
|---|---|
| 0 | every step passed |
| 1 | a step failed, or the scenario file is invalid. The last lines name the step number, what was expected and what was seen |
| 75 | the app or the driver could not start here (app never became ready, driver command missing). Never a pass |

`--root` is the folder every relative path in the scenario is resolved from (default: the current folder). `--out` is where the run folder goes (default: `$MEERKAT_SCRATCH/click-through` inside a Meerkat run, otherwise `.meerkat/click-through` under the root). Each run gets its own time-stamped subfolder holding `result.json`, `app.log` (the app's output), `driver.log` (the driver's stderr), the screenshots, and a `session` folder the driver may use to keep state between steps.

## The scenario format

```json
{
  "name": "notes app: create a note",
  "app": { "cmd": "npm", "args": ["run", "dev"], "cwd": "app", "env": { "PORT": "5173" } },
  "driver": { "cmd": "node", "args": ["scripts/ct-driver.mjs"], "cwd": "app" },
  "ready": { "url": "http://localhost:5173/", "timeoutMs": 60000 },
  "defaultTimeoutMs": 10000,
  "steps": [
    { "type": "open", "url": "http://localhost:5173/" },
    { "type": "assert", "text": "My notes" },
    { "type": "click", "text": "New note" },
    { "type": "type", "selector": "#title", "value": "Groceries" },
    { "type": "click", "selector": "button[type=submit]" },
    { "type": "wait-for", "text": "Groceries", "timeoutMs": 5000 },
    { "type": "assert", "urlMatches": "/notes/\\d+$" },
    { "type": "screenshot", "name": "note-created" },
    { "type": "stop" }
  ]
}
```

Top-level fields:

| Field | Required | What it is |
|---|---|---|
| `name` | yes | A short label for reports |
| `app` | no | The app to start: `cmd`, `args`, `cwd`, `env`. Supplied by the project. Leave it out when the app is already running (or the driver starts it). Meerkat starts it, writes its output to `app.log`, and stops the whole process tree when the run ends |
| `driver` | yes | The command that performs each step (see the driver contract). `cmd`, `args`, `cwd`, `env` |
| `ready` | no | When the app counts as started: `{ "url": "..." }` (the runner polls it until it answers with anything below HTTP 500) or `{ "windowTitle": "..." }` (the runner asks the driver, see below). `timeoutMs` defaults to 60000. If it is never ready the run exits 75 |
| `defaultTimeoutMs` | no | Timeout for steps that do not set their own (default 10000) |
| `steps` | yes | The ordered list |

Step types (every step may set `timeoutMs`; a step that does not finish in time fails):

| `type` | Fields | Passes when |
|---|---|---|
| `open` | `url` | the page, route or window is opened at that address |
| `click` | `text` (visible text) or `selector` | the element is found and clicked |
| `type` | `selector` or `text` (the field), `value` | the field accepts the text |
| `wait-for` | `text` or `url` | the text appears, or the address becomes that value, before the timeout |
| `assert` | `text`, `element` (a selector) or `urlMatches` (a regular expression) | the text is present, the element exists, or the address matches, right now |
| `screenshot` | `name` | a non-empty PNG is saved to the run folder as `NN-name.png`. The runner checks the file exists |
| `stop` | none | the app side is shut down cleanly. The runner always sends a final `stop` to the driver for cleanup even when you leave it out or a step failed |

After the first failing step the rest are recorded as skipped, a screenshot of the failing state is asked for (`fail-step-N.png`, best effort), and the run exits 1.

A failing step is reported like this (also in `result.json` under `failed`):

```
FAIL step 3 (assert "Saved") failed. expected: text "Saved" is present. actual: page shows: Welcome, Save
```

## The driver contract

The driver is any command. The runner starts it **once per scenario** and talks to it over **stdin and stdout**, one JSON object per line (newline-delimited, UTF-8). Because the process stays alive, a browser or window opened by the first step is still there for the next one: no state needs to be parked in the `session` folder. This is **protocol 2**. Protocol 1 (one process per step) still works for one release, see the end of this section.

**Start.** The runner spawns the driver command once. The first line the runner sends:

```json
{"type":"hello","protocol":2,"scenario":"notes app: create a note","session":"<run folder>/session","outDir":"<run folder>","env":{"MEERKAT_CT_SESSION":"<run folder>/session","MEERKAT_CT_OUT":"<run folder>"}}
```

The driver replies with one line, either of:

```json
{"type":"ready","ok":true,"capabilities":["click","type","assert","screenshot"]}
{"type":"ready","ok":false,"detail":"no display on this machine"}
```

`ok: false` ends the run with exit 75 and prints `detail`. A driver that exits before it sends `ready` also ends the run with exit 75.

**Each step.** The runner sends one line:

```json
{"id":3,"type":"step","step":{"type":"click","text":"New note"},"index":3,"total":9,"timeoutMs":10000}
```

`step` is the step exactly as written in the scenario. `index` counts from 1 (0 is the `ready.windowTitle` probe). Extra flag `evidence: true` marks the best-effort screenshot taken after a failure. The driver replies with one line:

```json
{"id":3,"ok":true,"state":"clicked <button> New note"}
{"id":4,"ok":false,"expected":"element with text \"Save\" found and clicked","actual":"no element with text \"Save\"; buttons on the page: Cancel, Close"}
```

| Field | Meaning |
|---|---|
| `id` | the `id` of the request being answered. Required. A reply with a different `id` is ignored and logged to `driver.log` |
| `ok` | `true` only if the step really happened. Required |
| `actual` | on failure, what the driver saw. The more specific the better (the visible buttons, the current address, the error text). Printed in the failure |
| `expected` | optional; overrides the runner's wording of what was expected |
| `state`, `detail` | optional extra evidence kept in `result.json` |

**Screenshots.** A step of type `screenshot` carries `path`, the exact file to write. The driver writes the PNG there and replies `ok`. The runner then checks the file exists and is not empty.

**End.** The runner sends `{"type":"stop"}` and waits up to 5 seconds for `{"type":"stopped"}`, then kills the driver process tree. It always does this, even when a step failed.

**Timeouts.** A step with no reply within `timeoutMs` plus 1.5 seconds fails with `no answer within N ms`. The driver is killed and the run stops with that failure (the remaining steps are recorded as skipped).

**Logs.** Anything the driver writes to **stderr** goes to `<outDir>/driver.log`, as do stdout lines that are not JSON (so printing noise is safe) and the runner's own notes (for example an ignored reply). A driver that exits in the middle of a step fails that step with its exit code.

**Exit codes.** A driver command that cannot be spawned, a driver that exits before `ready`, and `ready` with `ok: false` all end the run with **75** ("cannot run here"; never a pass). Use `ok: false` for "no display", "browser not installed", "app not built".

**Which protocol runs.** The runner sends `hello` first. A driver that answers with a `ready` line is run as protocol 2. A driver that does not answer within `driver.helloTimeoutMs` (default 5000) is stopped and the scenario runs in the old per-step mode (protocol 1). To skip the probe, set `"protocol": 1` in the scenario's `driver` block; set `"protocol": 2` to require it (then `ready` may take as long as `ready.timeoutMs`, default 60000, and silence is exit 75). `result.json` records the `protocol` used.

A minimal protocol 2 driver, in Node, for any stack (fill in the marked parts with whatever your stack offers: an Electron remote-debugging port, a browser's DevTools protocol, an accessibility API for a native window, an HTTP call to an in-app test hook). A complete working fake is `fixtures/clickthrough/fake-persistent-driver.mjs`.

```js
import { createInterface } from 'node:readline'
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const rl = createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.type === 'hello') return send({ type: 'ready', ok: true, capabilities: [] }) // start or connect to the app here
  if (m.type === 'stop') { send({ type: 'stopped' }); process.exit(0) }
  try {
    // switch on m.step.type: open, click, type, wait-for, assert, screenshot (write m.step.path), stop
    send({ id: m.id, ok: true })
  } catch (e) {
    send({ id: m.id, ok: false, actual: String(e.message) })
  }
})
```

Which stack uses what is for the project to decide. Meerkat does not recommend or install one, and no driver in this repository uses a browser library.

### Protocol 1 (deprecated)

> \*Deprecated 2026-11-06: protocol 1 is kept for one release and is then removed. Move drivers to protocol 2 above.

The runner starts the driver **once per step**, writes one JSON object to its stdin, closes it, and reads a JSON object from the **last line of stdout that parses as JSON**. A driver that needs a browser open between steps has to keep a debug port or process id in the `session` folder. Request (stdin):

```json
{
  "protocol": 1,
  "scenario": "notes app: create a note",
  "index": 3,
  "total": 9,
  "timeoutMs": 10000,
  "session": "<run folder>/session",
  "outDir": "<run folder>",
  "step": { "type": "click", "text": "New note" }
}
```

Response (stdout, exit code 0): `{ "ok": true, "state": "..." }` or `{ "ok": false, "expected": "...", "actual": "..." }`, with the same fields as above (no `id`). Rules: `ok: true` counts only with exit code 0; a step past `timeoutMs` plus 1.5 seconds is killed and fails with `no answer within N ms`; exit **75** with no JSON, or a command that cannot start, ends the run with 75; `ready.windowTitle` is sent as a step of type `ready` with index 0; the final cleanup `stop` carries `implicit: true`; the environment gets `MEERKAT_CT_SESSION` and `MEERKAT_CT_OUT`.

## Running a scenario as a check

`clickThroughCheck` in `lib/clickthrough.mjs` returns a ready check on the **windows lane** with `found: true`, so a scenario follows the same gate and the same lane as every other window check: left out of `full` and `thorough`, run by `release`, by `--include windows` and by `MEERKAT_WINDOWS=1`, and several at a time up to the window limit. Put a file in `.meerkat/checks/`:

```js
import { clickThroughCheck } from '<path to Meerkat>/lib/clickthrough.mjs'

export default [
  clickThroughCheck({
    id: 'click-notes',
    scenario: 'scenarios/notes.json',
    title: 'Click-through: create a note',
    estSeconds: 45,
    paths: ['src/**'],
  }),
]
```

Options: `weight` (default `medium`), `tier` (default `thorough`), `group` (default `ui`), `timeoutSeconds` (default 300), `cwd` (default `app`, the folder the scenario's relative paths start from). If you would rather not import from Meerkat, register the command directly instead:

```bash
meerkat check new --id click-notes --cmd "node <path to Meerkat>/lib/clickthrough.mjs scenarios/notes.json" --yes
```

The wrapper is not added to a built-in pack: a pack ships with Meerkat and cannot know your scenario file, and window checks only get the gate when they are marked `found`, which discovery does for the project's own checks.

## Guide for an AI: "write a click-through for this app"

Follow these steps in order. Do not write a test framework; write one scenario file and, only if the project has none, one small driver.

1. **Find the start command.** Read `package.json` scripts (`dev`, `start`, `electron`), a `Makefile`, a README, or the app's launcher. Note the working folder and the port or address it serves on. If the app is a desktop window with no address, find the window title it shows.
2. **Decide the readiness check.** A web app: the URL that answers when it is up (`ready.url`). A window app: the title (`ready.windowTitle`). Prefer the cheapest one that proves the app is really up.
3. **Find a driver.** Look for what the project already uses to drive its app (an existing e2e script, a remote-debugging flag, a test hook). If one exists, wrap it in the driver contract above. If none exists, ask the owner which automation tool they accept before adding one. Do not install a browser library on your own.
4. **Pick the path.** Choose 4 to 10 actions that matter: open the main page, one real action (create, search, save), and the result that proves it worked. Fewer, meaningful steps beat a long tour.
5. **Find a stable handle for each action.** Prefer visible text a user sees (`"New note"`). If text is not unique or changes, use a selector the project controls (`data-testid`, an `id`), and add one to the app if the owner agrees. Avoid positional selectors (`div > div:nth-child(3)`).
6. **Write the scenario** in the format above. Put an `assert` or `wait-for` after every action that changes the screen, so a silent failure is caught at the step that caused it. Add a `screenshot` at each important state. Set a longer `timeoutMs` only on steps that really wait (a save, a network call).
7. **Run it**: `node <Meerkat>/lib/clickthrough.mjs scenarios/<name>.json --root <app folder>`. Exit 75 means fix the start command, the readiness check or the driver first. Exit 1 means read the `FAIL step N` line.
8. **Read the result.** Open `result.json` in the printed run folder (`failed`, then each step's `expected` and `actual`) and look at the screenshots, including `fail-step-N.png`. Decide whether the app is broken or the scenario is wrong (a changed label, a too-short timeout). Fix whichever it is, and run again until it passes, then once more to check it does not depend on leftover state.
9. **Register it** as a check (previous section) so the release run covers it.
10. **Prove it can fail.** Change one assertion to something false and confirm the run exits 1 naming that step, then change it back.

Never put credentials, tokens or a machine-specific absolute path in a scenario. Use relative paths and environment variables.
