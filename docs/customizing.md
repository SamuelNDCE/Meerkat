# Customizing Meerkat

Meerkat is built to fit a project, not the other way round. Everything below is a plain file you can change; nothing needs a rebuild.

## 1. Choose what runs: `meerkat.config.json`

Put a `meerkat.config.json` next to your app, or in the repository root, or point at one with `--config <file>` (`--no-config` ignores it).
It is JSON, no code.

```json
{
  "packs": ["rust", "security", "hygiene"],
  "extraChecks": ["tools/meerkat-checks"],
  "disable": ["ui-axe"],
  "override": {
    "type-check": {
      "run": { "cmd": "pnpm", "args": ["tsc", "--noEmit"] },
      "selfTest": { "cmd": "pnpm", "args": ["tsc", "--noEmit", "tools/broken.ts"], "expectFail": true },
      "estSeconds": 8
    },
    "unit-tests": { "cost": { "cpu": 6, "memGB": 4 } }
  },
  "budget": { "cpu": 8, "reserveGB": 4 }
}
```

| Setting | What it does |
|---|---|
| `packs` | Which packs of checks to use (`rust`, `security`, `hygiene`, `ui`, `node`, ...). With no config file, `--init` picks them for the folder. |
| `extraChecks` | Folders of check files (see below), relative to the config file. A check with the **same id as one from a pack replaces it**, which is how you swap one tool for another. |
| `disable` | Turn checks off. Every run lists them as `[DISABLED]`, so nothing is ever turned off silently. `"suite:<name>"` turns off a whole suite. |
| `disableSubs` | Turn single rules off, as `"check/sub"`, for example `"secret-scan/aws-access-key"`. They are left out of the counts. See docs/suites.md. |
| `override` | Change one check: `tier`, `lane`, `weight`, `alone`, `estSeconds`, `cost`, `timeoutSeconds`, `paths`, `after`, `needs`, `optIn`, `title`, `run` (the command) and `selfTest`. |
| `budget` | How much a run may use at once: slots (`cpu`, default 10 or the number of threads if fewer), the most checks together (`maxParallel`, default 10) and memory to leave free (`reserveGB`, default 3). |

A mistake in the file (a typo, a wrong type, an id that does not exist) is printed as a `config:` note and the rest of the file still applies. It can
never stop a run.

**Changing a tool means proving the new one.** When an override changes `run`, the old self-test is dropped, because it belonged to the old tool.
Give the new one a `selfTest` (a broken case it must fail), or `--self-test` fails for that check, loudly. Meerkat's rule stays the same for every
tool you plug in: a check that cannot start is NOT RUN, and NOT RUN fails the run.

## Your own presets: say what they are for

A preset is a named run: `tier` (`fast` or `thorough`), `groups` (the kinds of check), optional `include` and `packs`. Put it in `meerkat.config.json` under `presets` (this project, for everyone who uses the project) or in `~/.meerkat.json` (just you, every project). Two optional texts make it easy for people to choose the right one:

```json
{
  "presets": {
    "before-demo": {
      "tier": "fast",
      "groups": ["ui", "security"],
      "about": "Pages and secrets, quick: the last look before a demo",
      "purpose": "Run this the morning of a demo. It checks that the pages load and look right and that no key is left in the code. It does not run the tests or the slow checks, so run full first if you changed logic."
    }
  }
}
```

- `about` is one line, up to 200 characters. It shows next to the name in `meerkat preset list` and in the menu.
- `purpose` is a few sentences, up to 600: what it is for, when to run it, and what it does not cover. It shows in the menu when you press `d` on the preset, and in `meerkat preset show <name>`, next to the full list of checks it runs and the time.
- Both are plain text. Line breaks and control characters are turned into spaces or dropped, the ends are trimmed, and anything over the limit is cut. A value that is not text is ignored with a `config:` note. Other keys in the preset are ignored.
- A preset without them keeps working; `d` then says how to add one.

From the command line: `meerkat preset new --name before-demo --about "..." --purpose "..."` (add `--project` to save in this project), and later `meerkat preset edit before-demo --purpose "..."`. Only presets you made can be edited; the bundled ones are fixed. Press `d` on yours in the menu to check how it reads.

## 2. Add a check of your own

A check file exports an array of checks. This is the whole shape:

```js
export default [
  {
    id: 'lint',                       // kebab-case, unique
    group: 'functionality',           // security | functionality | ui | performance | refactor
    tier: 'fast',                     // fast (before every push) or thorough (before a promotion)
    lane: 'free',                     // free (side by side), cargo (one Rust build at a time), electron (one window job at a time)
    title: 'ESLint, no warnings',
    estSeconds: 20,                   // a guess; Meerkat learns the real time on your machine and uses that
    weight: 'light',                  // tiny | light | medium | heavy | alone: how much of the machine it needs (see below)
    cost: { cpu: 2, memGB: 1 },       // optional: an exact cost instead of a weight (cpu is in slots, 10 per run)
    needs: ['npx'],                   // tools that must exist, or the check is NOT RUN
    after: [],                        // ids that must pass first (a build, for example)
    paths: ['src/**'],                // only runs when these changed (fast tier)
    run: { cmd: 'npx', args: ['eslint', '.', '--max-warnings=0'], cwd: 'app' },
    selfTest: { cmd: 'npx', args: ['eslint', 'fixtures/broken.js'], cwd: 'app', expectFail: true },
  },
]
```

`run` can also be a function returning `{ ok, detail }`. A file that fails to load becomes one failing check that names the file, so a broken module can
never make a run look clean.

## 3. How fast it runs, and how to keep it from crashing the PC

- **Order:** a check that others wait on (a build) starts first; quick checks go ahead of it so a quick failure shows up at once.
- **Weight:** a run has 10 slots. A check says how many it needs with `weight`: `tiny` (1 slot, so up to 10 together), `light` (2, so 5), `medium` (4, so 2 or 3),
  `heavy` (8, so one plus a light one) or `alone` (the machine to itself). No weight means the usual one for its lane. `cost: { cpu, memGB }` sets exact numbers instead.
  `budget.maxParallel` (default 10) caps how many run at once whatever their weight. A heavy check starts only when the machine has room, so mostly it runs alone. Free memory is read every time, so a PC that is busy with something else starts fewer checks. One
  check can always run alone, so a run never deadlocks.
- **Lanes:** one Rust build at a time (the machine-wide cargo lock), one window job at a time (the window lock).
- **The fast tier is lean on purpose.** The accessibility scan (`ui-axe`) is not in it, because the thorough tier's UI integrity check runs the same scan on
  every screen and size. When nothing differs from `origin/dev` (a promotion branch or a clean checkout), the full unit tests run in the fast tier,
  because "changed files" would otherwise mean zero tests.

## 4. The look

There is one look. Tune it in `~/.nv-verify-theme.json` (outside any repo):

```json
{ "spinner": "arc", "speed": 1.5, "mascot": true, "bar": { "ok": "#6fcf7f", "shimmer": "white" }, "fur": { "M": "#8899bb" } }
```

Colours are `#rrggbb` or a name (`green`, `cyan`, ...). A value that is not valid is ignored. Spinners: `dots`, `line`, `arc`, `bounce`, `blocks`.
Status is always a word on screen, so the look never hides a result. `NO_COLOR` turns colour off; `MEERKAT_PLAIN=1` gives plain lines.

## 5. Try it without a project

```
node preview.mjs --speed 6      a fake run, to see the board and animations
node preview.mjs --fail         the same with a failure
node preview.mjs --head         just the meerkat
```
