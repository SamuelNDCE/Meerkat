# Add a check

A check is a small file that says what to run and what a failure looks like. This page takes you from nothing to a check that runs in the gate, in about five minutes. You do not need to read Meerkat's code. The full list of fields is in [writing-checks.md](writing-checks.md); the other ways to extend Meerkat are in [extending.md](extending.md).

Every command on this page exists (`meerkat help` lists them) and was run before it was written down. `tests/developer-extend.test.ts` runs the example below, so it cannot drift from the real command.

The example: a check that flags a banned function name, `legacyCall`, in JavaScript files.

## 1. The short way

From inside your project, run:

```
meerkat new check no-legacy-call --ban legacyCall
```

It writes three files under `.meerkat/checks/` and prints the commands to run next. It never overwrites a file: if one is there already it writes nothing and prints `USAGE (status 400): <file> already exists, so nothing was written` (exit 2).

To put the check in a pack instead, add `--pack <name>` (a pack Meerkat finds, a folder, or a new name for a pack in `~/.meerkat/packs`). To start a whole pack, run `meerkat new pack <name>` (section 9).

## 2. What was written

```
.meerkat/checks/no-legacy-call.mjs               the check: what it is, when it runs, how it runs
.meerkat/checks/no-legacy-call/scan.mjs          the rule: the program the check runs
.meerkat/checks/no-legacy-call/fixture/bad.js    a small broken file the self-test must fail on
```

Meerkat loads every `.mjs` file directly inside the folder. The subfolder holds the support files and is not loaded as a check.

## 3. The check file

`.meerkat/checks/no-legacy-call.mjs`:

```js
// no-legacy-call: flags calls to the function legacyCall in JavaScript files. Written by `meerkat new check`; edit freely.
// How it fits together: docs/add-a-check.md. Prove it works: meerkat self-test --only no-legacy-call
import { fileURLToPath } from 'node:url'

const scan = fileURLToPath(new URL('./no-legacy-call/scan.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('./no-legacy-call/fixture', import.meta.url))

export default [
  {
    id: 'no-legacy-call',
    group: 'functionality', // security, functionality, ui, performance or refactor
    tier: 'fast', // fast runs in quick runs and the gate; thorough only in full
    lane: 'free',
    weight: 'tiny', // a check that only reads files is tiny
    title: 'No calls to legacyCall',
    estSeconds: 1,
    needs: ['node'],
    paths: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'], // the gate runs it only when a changed file matches
    severity: 'medium',
    fix: 'Replace the call to legacyCall with its replacement',
    run: { cmd: 'node', args: [scan, '{app}', 'legacyCall'], cwd: 'repo' },
    // The self-test: the same program on a small broken folder. It must FAIL, and for this reason.
    selfTest: { cmd: 'node', args: [scan, fixture, 'legacyCall'], cwd: 'repo', expectFail: true, expectMatch: 'banned function legacyCall' },
  },
]
```

The fields you must set, and the ones worth setting:

| Field | What to put | Required |
|---|---|---|
| `id` | kebab-case, unique. This is the name you type in every command | yes |
| `group` | the kind: `security`, `functionality`, `ui`, `performance` or `refactor` | yes |
| `tier` | `fast` runs in quick runs and the gate; `thorough` only in a full run | yes |
| `lane` | `free` for a check that only reads files | yes |
| `title` | one plain line saying what the check wants to be true. It is the heading in the results | yes |
| `run` | the rule: `{ cmd, args, cwd }`. Exit 0 passes, exit 1 fails. `{app}` is your project folder | yes |
| `selfTest` | the proof (section 5) | yes, by the project rules |
| `paths` | globs. In the gate the check runs only when a changed file matches one | recommended |
| `fix` | one line telling the reader what to do. It is shown with the finding | recommended |
| `severity` | `critical`, `high`, `medium`, `low` or `info` | optional |
| `weight` | `tiny` for a check that reads files, `heavy` for a build | optional |
| `needs` | programs that must exist. A missing one gives NOT RUN, never a pass | optional |

A check that cannot start here (a tool is missing) must exit 75 and print `NOT RUN: <why>` as its last line. It must never pass because something was absent.

## 4. The rule

`.meerkat/checks/no-legacy-call/scan.mjs` is a plain program. It prints one `path:line message` line for each problem, then a last line that gives the reason. Meerkat turns the `path:line message` lines into findings (see [findings.md](findings.md)) and shows the last line in the results table, so print the one problem that matters last.

```js
// Scans a folder for calls to a banned function in JavaScript files.
// Usage: node scan.mjs <folder> <function-name>      exit 0: none found, exit 1: found (one "path:line message" line each)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const [root = '.', name = 'legacyCall'] = process.argv.slice(2)
const call = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\s*\\(')
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n.startsWith('.')) return []
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(js|mjs|cjs|jsx)$/.test(n) ? [p] : []
  })

const hits = []
for (const file of walk(root)) {
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (call.test(line)) hits.push(relative(root, file).replace(/\\/g, '/') + ':' + (i + 1) + ' banned function ' + name + ' is called')
    })
}
if (hits.length) {
  for (const h of hits) console.log(h)
  console.log('banned function ' + name + ' is called in ' + hits.length + ' place(s): use its replacement')
  process.exit(1)
}
console.log('no calls to ' + name)
```

The fixture, `.meerkat/checks/no-legacy-call/fixture/bad.js`, is one deliberately broken file:

```js
// A deliberately broken file: the check must flag the next line.
legacyCall('this call is banned')
```

## 5. The self-test

Every check must prove it can fail. `selfTest` runs the same program on the broken fixture and says two things:

- `expectFail: true`: the run must exit non-zero. If it passes, the self-test fails, because a check that cannot fail protects nothing.
- `expectMatch: 'banned function legacyCall'`: a regular expression the output must match. This makes it fail for the right reason, not because a path was wrong.

`meerkat new check` fills the self-test in. If you change the rule, change the fixture and the `expectMatch` with it.

## 6. Run it alone

Run these from your project folder, in this order:

```
meerkat self-test --only no-legacy-call
meerkat check try no-legacy-call
meerkat check list
```

The first proves it fails on the broken fixture, for the right reason. The second runs it on your project. The third shows it in the list (yours are tagged).

The first time, in a terminal, Meerkat lists the files in `.meerkat/checks` and asks `Trust this project and run that code? [y/N]`. A check file is JavaScript, so a project you only cloned does not get to run it unasked. In CI there is no question; set `MEERKAT_TRUST_PROJECT=1` only for a repository you wrote. A check in a pack of your own (section 9) needs no question.

## 7. See it in the gate

The gate runs the checks that cover the files you changed:

```
meerkat gate --base main
```

or `meerkat gate --staged` before a commit. Your check appears as one line, `PASS` or `FAIL`, and the summary counts it. It runs only when a changed file matches `paths`. A finding blocks only when it is in a file you changed; the same problem elsewhere is reported as pre-existing and does not block.

## 8. If it fails: what to do

1. Read why it fired: `meerkat why no-legacy-call` shows the check's command, its result and its full output from the newest run. `meerkat findings` lists every finding with its file and line.
2. Fix the code it names. The `fix` field is the one-line hint.
3. Run `meerkat check try no-legacy-call` again, or `meerkat gate --base main`.
4. If the finding is real but accepted, `meerkat dismiss <finding-id> --reason "why"` records it. Do not weaken the check to make it pass.
5. If the check itself is wrong, fix the rule and its fixture together, then `meerkat self-test --only no-legacy-call`.

If the self-test says `the tool failed, but not for the expected reason`, the fixture failed for another cause. Run `node .meerkat/checks/no-legacy-call/scan.mjs .meerkat/checks/no-legacy-call/fixture legacyCall` and read what it prints. A check file that does not load becomes one failing check named after the file, so a broken file can never make a run look clean.

## 9. Put it in a pack

A pack is a folder of check files you can share and switch on by name.

```
meerkat new pack team --ban legacyCall
meerkat pack enable team
meerkat self-test --only team-no-legacycall
```

`meerkat new pack team` makes `~/.meerkat/packs/team/` with a `pack.json` and one example check, and prints where it is and how to load it. Meerkat always looks in `~/.meerkat/packs`. To keep packs somewhere else, use `--dir <folder>` and run `meerkat pack add <folder>` once. Add more checks to the pack with `meerkat new check <id> --pack team`. A pack name that Meerkat already ships is refused, because the shipped one would win.

Do not write into Meerkat's own `packs/` or `examples/` folders. An update replaces them (see [extending.md](extending.md#6-where-each-piece-lives)).

## 10. Rules for a good check

- Say exactly what is wrong. Print the one problem that matters last.
- Prove it fails, for the right reason, with `selfTest` and `expectMatch`.
- Never pass because something was missing. Exit 75 with `NOT RUN: <why>`.
- Keep it fast and offline. A check that needs the network says so in its title and is opt-in (`optIn`).
- No machine paths and no secrets. Use `{app}` and `{repo}`; the template finds its own files with `import.meta.url`.
