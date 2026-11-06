# Catalog of bad and good code

A small library of simplifications, written so an AI (or a person) refactoring code can see the same change in a concrete pair: the shape to move away from, the shape to move toward, and the reason. Every pair is proven by a Meerkat check, so the catalog cannot drift from what the tool actually flags.

## Layout

```
catalog/
  README.md
  <language>/                one folder per language (javascript-typescript, python, rust)
    <slug>/                  one folder per entry, named for the change
      entry.json             the metadata (schema below)
      bad/<file>             the version the check must flag
      good/<file>            the version the check must pass
```

`bad/` and `good/` each hold only that one version, with the file name and extension the language needs. A rule that cares about the path (for example Rust's `src/lib.rs`) is given the same path in both folders.

## Schema of `entry.json`

| Field | Meaning |
|---|---|
| `rule` | The id of the rule that fires. For a code-patterns rule it is the rule id from `thorough/rules-code-patterns.mjs`. For a refactor check, which has no sub-rules, it is the check id. It must be a real id: never invented. |
| `runner` | The existing script that runs the check, relative to the repository root (`thorough/code-patterns.mjs` or `thorough/refactor.mjs`). No new runner is added for the catalog. |
| `check` | The check name given to the runner (`cp-js`, `cp-python`, `cp-rust`, `many-parameters`, `deep-nesting`, and so on). |
| `why` | One sentence, plain words, saying why the good shape is better. Ends with a full stop, no dashes used as punctuation. |
| `bad` | Path of the bad file, relative to the entry folder. |
| `good` | Path of the good file, relative to the entry folder. |

Example:

```json
{
  "rule": "js-timer-string",
  "runner": "thorough/code-patterns.mjs",
  "check": "cp-js",
  "why": "A string given to a timer is run as code, so a plain function reference is both shorter and safe.",
  "bad": "bad/refresh.js",
  "good": "good/refresh.js"
}
```

## How an entry is proven

`tests/catalog.test.ts` finds every `entry.json`, copies the `bad/` folder into a throwaway directory and runs `node <runner> <check> --root <that directory>`, then does the same with `good/`. An entry passes when:

1. the bad version exits with code 1, and for a code-patterns rule its sub-check line is `MEERKAT-SUB FAIL <rule>`;
2. the good version exits with code 0, and for a code-patterns rule its sub-check line is `MEERKAT-SUB PASS <rule>`;
3. `rule` is a real id in the check's rule table (or equals `check` for a refactor check), and both files exist.

The test also requires at least three entries for each of JavaScript and TypeScript, Python and Rust.

## Adding an entry

1. Pick a real rule: read the rule table or the pack (`packs/`) for the id. Do not make one up. If no rule covers the change, add the rule to its pack first, with its own bad and good samples, and then add the entry.
2. Create `catalog/<language>/<slug>/` with `entry.json`, `bad/` and `good/`.
3. Keep each file short and realistic: the smallest code that shows the change, and a good version a reviewer would actually accept.
4. Run `npx vitest run tests/catalog.test.ts`.

## Seeded entries

| Language | Entry | Rule |
|---|---|---|
| javascript-typescript | timer-string | `js-timer-string` |
| javascript-typescript | new-buffer | `js-new-buffer` |
| javascript-typescript | exec-variable | `js-exec-variable` |
| javascript-typescript | deep-nesting | `deep-nesting` |
| javascript-typescript | many-parameters | `many-parameters` |
| python | requests-no-timeout | `py-requests-no-timeout` |
| python | subprocess-string | `py-subprocess-string` |
| python | mktemp-race | `py-mktemp-race` |
| python | shell-true | `py-shell-true` |
| python | many-parameters | `many-parameters` |
| rust | unwrap-in-library | `rs-unwrap-in-library` |
| rust | unsafe-no-safety | `rs-unsafe-no-safety` |
| rust | transmute | `rs-transmute` |
| rust | sql-formatted | `rs-sql-formatted` |
| rust | many-parameters | `many-parameters` |
