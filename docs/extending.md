# Extending Meerkat

You can add your own checks, packs, presets and tool wrappers without changing a single file of Meerkat. Everything below lives in your project or your home folder, so `meerkat update` cannot overwrite it. Every example on this page was run before it was written down, and `lib/extend061.test.ts` proves the update part.

This page is the how-to. To write a first check fast, start with [add-a-check.md](add-a-check.md) (`meerkat new check`). The full field list is in [writing-checks.md](writing-checks.md), the config keys are in [customizing.md](customizing.md), and the safety rules of the update are in [developers.md](developers.md#update-safety-why-an-update-cannot-break-your-setup).

The examples use one project folder, `my-app/`. Run each command from Meerkat's folder with `--app my-app`, or from inside `my-app/` with `meerkat`.

## 1. Write your own check

A check is a `.mjs` file in `my-app/.meerkat/checks/`. Meerkat finds it with no setting. It needs an `id`, a `title`, the run, and a `selfTest`: a deliberately broken case the check must fail, with `expectMatch` naming the reason.

`.meerkat/checks/no-wip.mjs`:

```js
export default [
  {
    id: 'no-wip-marker',
    group: 'functionality',
    tier: 'fast',
    lane: 'free',
    weight: 'tiny',
    title: 'No "WIP:" marker left in the code',
    estSeconds: 1,
    run: { cmd: 'node', args: ['.meerkat/checks/no-wip/scan.mjs', '{app}'], cwd: 'repo' },
    selfTest: { cmd: 'node', args: ['.meerkat/checks/no-wip/scan.mjs', '.meerkat/checks/no-wip/fixture'], cwd: 'repo', expectFail: true, expectMatch: 'WIP marker left in' },
  },
]
```

`.meerkat/checks/no-wip/scan.mjs` (the program the check runs; exit 0 passes, 1 fails):

```js
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const walk = (d) => readdirSync(d).flatMap((n) => (n === 'node_modules' || n.startsWith('.') ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
const bad = walk(process.argv[2]).filter((f) => /\.(js|ts|md)$/.test(f) && /WIP:/.test(readFileSync(f, 'utf8')))
if (bad.length) { console.log(`WIP marker left in ${bad[0]}`); process.exit(1) }
console.log('no WIP markers')
```

The fixture, `.meerkat/checks/no-wip/fixture/bad.js`, is one line: `// WIP: remove before release`.

Run it:

```
node run.mjs --app my-app --only no-wip-marker                 does it pass on your project
node run.mjs --app my-app --self-test --only no-wip-marker     does it fail on the fixture, for the right reason
node run.mjs --app my-app --list                               is it listed
meerkat check try no-wip-marker                                the same first run, from inside my-app/
```

`run` can also be a function, `run: (ctx) => ({ ok, detail })`, where `ctx.appDir` is the project folder. A function `selfTest` must itself return `{ ok: false, ... }`. Use a command when you can: it gets a timeout, a log and the `expectMatch` check for free.

**The trust prompt.** A file in `.meerkat/checks` is JavaScript that runs inside Meerkat, so a project you only cloned does not get to run it unasked. The first time, in a terminal, Meerkat lists the files and asks `Trust this project and run that code? [y/N]`. Your answer is saved with a hash of the files and of everything they import by a relative path, so editing one of them asks again. Without a terminal (CI, `--no-input`) nothing is asked and nothing is trusted. The code is left out and every run says:

```
this project's own check code was NOT run: <N> file(s) (extraChecks or .meerkat/checks) have not been trusted yet, and without a terminal Meerkat will not ask. Run meerkat once in a terminal in <project> and answer the question to trust them.
```

In your own CI, set `MEERKAT_TRUST_PROJECT=1` only for a repository you wrote. If you want no code at all, write the check as data in `meerkat.config.json` under `customChecks` (a command and arguments, see [customizing.md](customizing.md#your-own-checks)): it needs no trust.

## 2. Write your own pack

A pack is a folder of check files, each one exporting an array of checks like the one above. A pack named `team` is a folder `~/.meerkat/packs/team/`:

```
~/.meerkat/packs/team/owners.mjs
```

```js
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export default [
  {
    id: 'team-owners-file',
    group: 'functionality',
    tier: 'fast',
    lane: 'free',
    weight: 'tiny',
    title: 'The project has an OWNERS file',
    estSeconds: 1,
    run: (ctx) => (existsSync(join(ctx.appDir, 'OWNERS')) ? { ok: true, detail: 'OWNERS found' } : { ok: false, detail: 'no OWNERS file at the project root' }),
    selfTest: () => ({ ok: false, detail: 'no OWNERS file at the project root' }),
  },
]
```

Switch it on in `my-app/meerkat.config.json`:

```json
{ "packs": ["team"] }
```

or with `meerkat pack enable team`. `meerkat pack list` shows every pack Meerkat can find. Meerkat looks for `packs/<name>` in its own folder first, then `examples/<name>`, then each folder you added with `meerkat pack add <folder>`, then `~/.meerkat/packs/<name>`. A check with the same id as one already loaded replaces it. Pack names are lowercase letters, digits and hyphens.

There is no `.meerkat/packs` folder inside a project. A pack that belongs to one project is a folder of check files listed under `extraChecks` (`"extraChecks": ["tools/checks"]`, relative to the config file). It needs the same trust as `.meerkat/checks`.

A personal pack is not trust-gated, because it is yours, not the repository's.

## 3. Write a preset

A preset is a named run. Put it under `presets` in `my-app/meerkat.config.json` (everyone on the project) or in `~/.meerkat.json` (just you). The project's wins when both have the same name.

```json
{
  "presets": {
    "mine": {
      "tier": "fast",
      "groups": ["functionality"],
      "about": "My own quick run",
      "purpose": "Runs the quick functionality checks only. It skips security and the slow checks."
    }
  }
}
```

```
node run.mjs --app my-app --preset mine
meerkat preset show mine
```

What a preset can say (the built-in ones in `lib/presets.mjs` are the reference):

- `tier`: `fast` or `thorough`. `groups`: any of `security`, `functionality`, `ui`, `performance`, `refactor`. Empty means all of them.
- `include`: opt-in checks to add (the built-in `release` preset adds `ai`). `packs`: packs to load for this run, on top of the config's own.
- `excludeChecks` and `excludeSubs`: check ids and `check/rule` ids to leave out. Excluded checks are listed as disabled, never dropped silently. This is how `bugs` is `quick` minus the style rules.
- `allPacks: true` brings in every pack that fits the folder, as `quick`, `full` and `release` do. `skipCompile: true` leaves out builds and test runs, as `quick` does.
- `about` (200 characters) and `purpose` (600) are text for people. Anything else you add is ignored.

A preset with the name of a built-in one that only sets `ignorePaths`, `about` or `purpose` keeps the built-in's behaviour and changes only that.

## 4. Add a tool wrapper

A tool wrapper is a check that runs an external program. Say which program it `needs` and how to install it. If the program is missing, the check is NOT RUN, not PASS, and the table shows your install line.

```js
export default [
  {
    id: 'acme-lint',
    group: 'functionality',
    tier: 'fast',
    lane: 'free',
    weight: 'light',
    title: 'acme-lint: house style',
    estSeconds: 5,
    needs: ['acme-lint'],
    install: 'npm i -g acme-lint',
    run: { cmd: 'acme-lint', args: ['.'], cwd: 'repo' },
    selfTest: { cmd: 'acme-lint', args: ['.meerkat/checks/no-wip/fixture'], cwd: 'repo', expectFail: true },
  },
]
```

With `acme-lint` not installed, a run prints:

```
[NOT RUN] acme-lint (0.0s): needs acme-lint: npm i -g acme-lint
```

and the run exits with an error, because nothing is skipped to look green. A program is found on `PATH` or in the project's `node_modules/.bin`. If the program can fail in a way that means "cannot run here" (a service is down), exit 75 and print `NOT RUN: <why>` as the last line.

Inside Meerkat's own packs the same thing is one call to `tool()` from `lib/tool-check.mjs` (see [writing-checks.md](writing-checks.md#wrapping-a-tool)). A project's own files should use the plain shape above: `tool()` is Meerkat's code, and importing it by a path ties your check to Meerkat's layout.

## 5. Add an MCP tool

There is no extension point. The MCP server (`bin/meerkat-mcp.mjs`, `lib/mcp.mjs`) builds its tool list from fixed arrays compiled into Meerkat (`FIRST_TOOLS`, `NEW_TOOLS`, `MORE_TOOLS` and `PARITY_TOOLS`), and `tools/list` returns exactly those. No config key, folder or environment variable adds a tool. To add one you change Meerkat's source, which makes it a fork (section 6).

What your extensions get through MCP without any work: the checks, packs and presets from sections 1 to 4 are read by the same loader, so `meerkat_check_list` reports your own checks (its `own` list) and `meerkat_run` runs them.

## 6. Where each piece lives

Put each thing where an update does not reach it.

- **For one project** (a check, a preset or a pack): `my-app/.meerkat/checks/`, `my-app/meerkat.config.json`, or an `extraChecks` folder. Everyone who uses the project gets it.
- **For you, in every project**: `~/.meerkat.json` (`customChecks`, `presets`, `packDirs`) and `~/.meerkat/packs/<name>/`.
- **Your settings and answers**: `~/.meerkat.json` and `~/.meerkat/logs` (or `MEERKAT_LOG_DIR`, which also holds `trust.json`).
- **A change to Meerkat's own files**: a fork, meaning a branch of your clone of Meerkat. It reaches only that clone.

`MEERKAT_USER_CONFIG` moves `~/.meerkat.json`. Do not put your checks in Meerkat's `packs/`, `lib/` or `examples/` folders: those are the files an update replaces.

**A fork.** If you change a file in Meerkat's own folder, commit it on a branch of your own and keep the update working:

1. Make a branch (`git -C <meerkat> switch -c my-fork`) and commit your change on it.
2. Run `meerkat update`. A folder on a branch with commits GitHub does not have is moved onto the default branch. Your branch keeps every commit, and the result names it so you can merge when you want.
3. A detached HEAD with commits of its own is refused: put them on a branch first.

Uncommitted edits work too (section 7), but a committed branch is the safe place for a change you mean to keep.

## 7. Updating

`meerkat update` changes only Meerkat's own folder, and only when the folder is a git clone. A copy installed from npm is not, and is updated with `npm install -g @samuelndce/meerkat@latest`. It never touches your project or your home folder. In order, it:

1. looks up the newest version and checks its release checksum;
2. refuses, before changing anything, if you edited a file the update also changes on the same lines;
3. saves your uncommitted changes as a patch under `<log folder>/update-patches/`;
4. tries the new version in a temporary copy that carries your changes (its `self-test` and `--help` must pass);
5. only then moves the folder forward, never rewriting history.

| You did | What the update does |
|---|---|
| Added checks, packs or presets in your project or home | nothing, they are not in Meerkat's folder |
| Edited a Meerkat file the update does not change | keeps it exactly, saves a patch, prints `Your 1 local change was kept. A copy of them is saved in: <patch>` |
| Edited different lines of a file the update also changes | combines both, saves a patch |
| Edited the same lines | refuses and changes nothing, as below |
| Committed on a branch | leaves the branch alone and moves the folder to the default branch |

The refusal reads:

```
Not updated: you have changes that cannot be combined automatically with this update (the same lines changed on both sides), so it was not updated:
  lib/glob.mjs
Your changes are saved in: <log folder>/update-patches/<time>-to-<version>.patch
See what you changed: git -C "<meerkat folder>" diff
Commit them (git -C "<meerkat folder>" commit -am "my changes") or move them aside (git -C "<meerkat folder>" stash), then run the update again.
```

Two things an update can still change for you, both announced and never silent:

- **Trust.** If a check of yours imports a file of Meerkat's by a relative path, the update changes that file, the trust hash changes, and the project asks again (or, with no terminal, leaves your code out and says so). Checks that import nothing from Meerkat are not affected.
- **A pack name.** A new Meerkat can ship a pack with the same name as one of yours. The bundled one wins, and every run prints `pack "<name>": a bundled pack with this name is used; your pack at <folder> is ignored. Rename your pack folder and the name in "packs" to keep it`. Rename your folder and the entry in `packs`.
