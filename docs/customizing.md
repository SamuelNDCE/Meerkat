# Customizing Meerkat

Meerkat is built to fit a project, not the other way round. Everything below is a plain file you can change; nothing needs a rebuild.

## Quick start: your first check in 5 minutes

1. **Create a check.** In your project folder, run `meerkat check new --id e2e --cmd "npm run test:e2e" --yes`. Leave out `--yes` and it asks you the questions instead. Use a command your project already runs.
2. **Run it on its own.** Run `meerkat check try e2e`. It shows PASS or FAIL, or NOT RUN when its program is missing.
3. **See it labelled.** Run `meerkat check list`. `e2e` shows the tag `project`, because it went into this project's `meerkat.config.json`. Add `--personal` to step 1 to keep it for every project instead, and it shows `yours`.

The check is `thorough` by default, so `meerkat full` runs it with the rest. `meerkat verify` runs only the quick checks and leaves it out.

The sections below cover the other ways to add checks, presets and packs.

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

## Leave files out: `.meerkatignore`

Some files hold bad examples on purpose: a scanner's rule table, a fixture, generated or vendored code. The checks should not read them. Put a `.meerkatignore` at the project root, one pattern per line:

```text
# generated and vendored code
dist-gen/
vendor/**
*.min.js
# rule text that quotes bad examples
rules/*.json
!rules/keep-me.json
```

- A blank line or a line starting with `#` is skipped. Windows (CRLF) line endings work.
- `dir/` ignores a folder and everything under it, at any depth unless the pattern also has a slash earlier in it (`docs/images/` is anchored to the root).
- `*` matches within one path part. `**` crosses parts. `?` is one character.
- `!pattern` brings back what an earlier line ignored. The last matching line wins.
- Manifests, lockfiles, licences and `.meerkatignore` itself are never ignored, whatever the file says.
- Without the file nothing changes. When it skips files, each check prints `ignored N files by .meerkatignore` on stderr.

It applies to every check that reads the project's files through Meerkat's shared file list. Do not use it to hide a real problem: a missing `SECURITY.md` is a finding, a bad example inside a rule table is noise.

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

(No JavaScript is needed for the usual case: see **Your own checks** below for `customChecks`. This section is the code shape.)

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

## Your own checks

If you have tests only your app has, Meerkat should run them with the rest, list them under a suite of their own, and say which ones are yours. There are three ways, and `meerkat recommend` suggests the first one.

**1. Config, no code (the easy way).** In `meerkat.config.json` (this project) or in `~/.meerkat.json` (every project; `MEERKAT_USER_CONFIG` moves that file):

```json
{
  "customChecks": [
    { "id": "e2e", "title": "End-to-end tests", "cmd": "npm", "args": ["run", "test:e2e"],
      "suite": "my-app", "group": "functionality", "tier": "thorough", "cwd": ".", "timeoutSeconds": 600, "weight": "heavy",
      "needs": ["npm"], "install": "install Node.js" }
  ],
  "suites": { "my-app": { "label": "My app", "purpose": "The tests only this app has." } }
}
```

- `id` is kebab-case and unique across every pack (a clash is a note and the entry is skipped). `cmd` is one program, a plain name (`npm`) or a relative path (`scripts/test.sh`); `args` is a list of text. There is **no shell** anywhere: spaces in `cmd`, and `;`, `|`, `&`, `<`, `>`, backticks, `$(`, `%`, `^` and double quotes inside `args`, are refused.
- `suite` is one of Meerkat's suites or a name of your own (`my-app`); it defaults to `my-app`. Your own suites show under **Your app** in `meerkat suite list`, in the menu and in the end summary. `group` is one of security, functionality, ui, performance, refactor; `tier` is `fast` or `thorough` (default `thorough`). `cwd` is a folder inside the project (default the project). `timeoutSeconds` is 1 to 7200 (the check is stopped after that), `weight` is tiny to alone. `needs` defaults to `cmd`: if that program is not installed the check says NOT RUN with your `install` line.
- The program's exit code decides: 0 passes, anything else fails, and **exit 75 means NOT RUN** (a tool or service you need is missing). Its log, time and result are kept like any check's.
- A mistake never stops a run: the entry is skipped with a `config:` note. Unknown keys are ignored with a note.

Write them with commands instead of by hand: `meerkat check new` (asks; or `--id e2e --cmd "npm run test:e2e" --yes`, `--personal` for every project), `meerkat check edit <id>`, `meerkat check remove <id>`, `meerkat check mine` (what you have, where each lives, whether its program is installed), and `meerkat check try <id>` (runs just that one). The menu has the same under **Your app**.

**2. Code in `.meerkat/checks/*.mjs`.** A file there exports an array of checks in the shape of section 2, and is found with no setting. Use it when a check needs logic, not just a command. It is code from the project, so it runs only when you run Meerkat on that project. (`extraChecks` folders work the same way and are also tagged as the project's.)

**3. Personal packs.** A folder of check files in `~/.meerkat/packs/<name>/` (or a folder named by `meerkat pack add`), switched on with `meerkat pack enable <name>`. Use it for checks you want in every project.

**Tags.** Every check knows where it came from: bundled (ships with Meerkat, shown without a tag), personal (a personal pack or `~/.meerkat.json`; tag `yours`) or project (this project's config, `.meerkat/checks` or an `extraChecks` folder; tag `project`). The tag shows in `meerkat check list` (JSON field `origin`), on the board, in the end summary (`3 of them your own`), in `report.md` and `summary.json`, in `meerkat check show` and in the menu.

**Not sure what to add? `meerkat recommend`.** It looks at the folder (package.json scripts such as test, test:e2e, lint, typecheck, build, check, verify and coverage; Playwright, Cypress, Vitest, Jest or Mocha config; Makefile targets; pytest or tox; Docker Compose; commands your CI runs) and lists tests you could run that no check covers. It never runs or writes anything; `meerkat recommend --add <id|all>` adds them after a question. A normal run with no checks of your own ends with one dim line, `Tip: meerkat recommend (N tests this project could run)`, never in `--json`, quiet, plain or CI output. Set `MEERKAT_NO_TIP=1` to hide it.

**Safety.** Your checks are code from the project you are verifying, so they run only when you run Meerkat on it. The menu's time estimates and tab completion do not run or import project code (`MEERKAT_NO_PROJECT_CODE=1`): checks written as data are still listed, but `.meerkat/checks` and `extraChecks` files are not loaded. An example is in `examples/custom-checks/`.

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
