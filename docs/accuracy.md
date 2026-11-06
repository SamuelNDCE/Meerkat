# Accuracy: does every check catch what it should?

Meerkat's checks can be wrong in two ways. A **false positive** is a FAIL on a project that is fine. A **false negative** is a PASS on a project that has the very defect the check exists for. The compatibility matrix guards the first kind; the accuracy corpus guards the second.

Status legend: ✔ OK / ◐ PARTIAL / ✖ BROKEN / ○ PLANNED.

## Current figures (0.5, measured 2026-11-06)

| Measure | Result | Source | Status |
|---|---|---|---|
| Planted-bug recall, default run | 99.77%: 1735 of 1739 | `tools/corpus/measure.mjs` | ✔ OK |
| Planted-bug recall, pedantic run (`--all`) | 100% | `tools/corpus/measure.mjs --all` | ✔ OK |
| False alarms on clean twins | 0 of 1739 | `tools/corpus/measure.mjs` | ✔ OK |
| False alarms on real Rust code | 4.6%: 6 of 130 labelled findings false, 124 true | `benchmarks/real-rust/measure.mjs` on a copy of the NeuralVault Rust tree | ✔ OK |
| Real-code mutation run, default rules | 37% (200 mutants) | mutation run on real code | ◐ PARTIAL |
| Real-code mutation run, all rules | 98% (200 mutants) | mutation run on real code | ◐ PARTIAL |

The four planted-bug misses in the default run are lock-unwrap defects. Those rules are pedantic and hidden by design in the default run, which is why the pedantic run reaches 100%.

### Which mutation run this is

The 37% and 98% come from one run of 200 mutants on real code (Rust code of the NeuralVault project), once with the default rules and once with all rules on. The mutation figure measures how many injected changes a rule set noticed, so it is a recall-style number on real code. It is one run on one project and its raw output is not stored in this repository, so it is marked PARTIAL: treat it as a snapshot, and re-run before quoting it as current.

### Caveats

- The planted corpus is built from each rule's own bad and good samples, so recall there is close to the ceiling by construction. It shows the rules do what they were written to do. It does not show that real bugs are found.
- The clean-twin number (0 of 1739) has the same limit: the twins are the rules' own good samples.
- The real-code false-alarm rate comes from 130 findings a person labelled in one project (NeuralVault) in one language (Rust). It says nothing about other languages or projects.
- The labelled sample is a seeded random draw of findings hidden by default; labels are tied to exact files and lines of that snapshot.
- The six remaining labelled false alarms cannot be removed without losing a labelled true finding of the same shape (the table at the end of `benchmarks/real-rust/README.md`).

### What is not measured yet

- Recall on real code for any language other than the NodeGoat run described below (29.4% on 17 vulnerabilities, 2026-11-02).
- False-alarm rates on real code outside Rust.
- The mutation run on more than one project, and with stored raw output.
- The false-alarm rate of the non-Rust checks on real code.

### How the planted corpus is built

`tools/corpus/gen-planted.mjs` writes, for every rule of the data-driven checks (`code-patterns`, `client-frameworks`, `electron-plus`, `rust-plus`), several variants of the rule's known-bad sample and the matching known-good twin, plus a `manifest.json`. It is deterministic from `--seed`. Variant 0 is the sample unchanged; the others add harmless surrounding code, indentation, line endings and renamed local variables, so the defect stays a defect. Each defect is written into a complete clean base project (`tools/corpus/base-project.mjs`).

```
node tools/corpus/gen-planted.mjs --out corpus/planted --seed 20261106 --per-rule 4
```

```
node tools/corpus/measure.mjs --corpus corpus/planted --out result.json
```

```
node tools/corpus/measure.mjs --corpus corpus/planted --all --out result-pedantic.json
```

The measure script copies each defective file into a fresh folder, runs only the check that should catch it, and counts it caught when that check reports the planted rule as FAIL. It then does the same with the clean twin: a FAIL of the same rule is a false alarm, a FAIL of another rule of that check is counted apart as an other-rule alarm. A rule reported NA (not evaluated, for example pedantic and off by default) counts as a miss. `--all` turns on the pedantic rules. Other flags: `--limit`, `--offset`, `--batch`, `--jobs`, `--timeout`, `--family`.

### Real-code benchmark

`benchmarks/real-rust/measure.mjs` runs the six rust-plus checks on a copy of a real Rust project and compares their findings with labels a person made (TRUE: a real instance of what the rule says; FALSE: a false alarm). Precision is TRUE / (TRUE + FALSE) over labelled findings still reported. In the November 2026 narrowing pass the labelled false alarms fell from 20 to 6 of 130 labelled findings (4.6%) with no labelled TRUE finding lost, and all 79 pedantic Rust rules that have a labelled sample are now in the default run.

```
node benchmarks/real-rust/measure.mjs --copy-from <project folder> <tree folder>
```

```
node benchmarks/real-rust/measure.mjs <tree folder>
```

The first command builds a read-only copy of the project's Rust files once; the second measures (about 30 seconds). It exits 1 if precision falls below `baseline.json`. Full instructions, the labelling process and the list of remaining false alarms: `benchmarks/real-rust/README.md`.

The older figures below (the 0.4.0 final run, the per-suite table and the NodeGoat measurement) are kept as history; they were produced by `tools/accuracy-corpus.mjs`, a different corpus.

## What the corpus is

`tools/accuracy-corpus.mjs` writes a set of small, realistic, KNOWN-BAD projects into a temporary folder. Each is a git repository with one commit (the secrets project also has a history with a committed-then-deleted secret and badly worded commit messages). Every project plants real, plausible defects, one per rule family, on its own line of otherwise clean code:

| Project | Plants |
| --- | --- |
| `node-api` | Express server: eval, shell exec with concatenation, innerHTML, prototype pollution, weak crypto, JWT none, CORS wildcard, open redirect, path traversal, SQL concatenation, unhandled promises, empty catch, focused and skipped tests |
| `py-service` | Flask service: shell=True, pickle, yaml.load, verify=False, bare except, mutable default, assert, MD5, mktemp, SQL f-string, debug mode |
| `native-langs` | Go, Rust (unsafe without SAFETY, unwrap, blocking in async, wildcard crate), Java, C#, PHP and Ruby code |
| `infra-stack` | Dockerfile, Kubernetes, Terraform, Compose, GitHub Actions, GitLab CI and Helm values |
| `electron-desktop` | nodeIntegration, contextIsolation, webSecurity, DevTools, openExternal, IPC without a sender check, plain-http updater |
| `web-frontend` | HTML and CSS accessibility and security, nginx headers, files in the published folder |
| `package-hygiene` | package.json, lockfile and `.npmrc` problems; no licence, security policy, `.gitignore` or CI |
| `data-docs` | Notebook with outputs and a key, CSV, Markdown, JSON, TOML and YAML problems, conflict markers, hidden Unicode, a tracked `.env.production` |
| `secrets-history` | Fifteen providers' secrets in source, a private key file, and a secret committed then deleted from history |

Secrets are assembled at runtime from random parts, so the tool's own source never contains a real-looking secret. The manifest `planted.json` (written next to the projects) lists, for every planted defect: project, suite, check id, rule id (where the check emits `MEERKAT-SUB` rules), file, line and a one-line description.

## How a defect counts as detected

A defect is **detected** when the check that owns it (or a listed alternative) reports it:

1. in `findings.json`, in the same file, on the same line (three lines of slack, because some rules report the start of a block) or with no line at all, with the expected rule id or none; or
2. failing in its own log with the file (and line) named in its output.

Both numbers are reported. The second is the check's own verdict ("Detected by a check"); the first is what a person or an AI reading `findings.json` sees. A gap between them is a finding in itself: the check saw the defect but the findings file lost it.

## How to run it

```
node tools/accuracy-corpus.mjs --out <dir>                    write the projects and <dir>/planted.json only
node tools/accuracy-corpus.mjs --run                          run every pack on every project, print the table, refresh the block below
node tools/accuracy-corpus.mjs --run --discover               also print what was reported at each planted place
node tools/accuracy-corpus.mjs --run --write-thresholds       also rewrite docs/accuracy-thresholds.json
npx vitest run lib/accuracy.test.ts                           the guard (set MEERKAT_SKIP_ACCURACY=1 to skip it)
```

`lib/accuracy.test.ts` fails when the recall of any suite falls under its floor in `docs/accuracy-thresholds.json` (each floor is the measured value rounded down, never below 0.6). When a rule is improved, run with `--write-thresholds` to raise the floor; never lower it to make a test pass, fix the rule or move the defect to the known gaps with a reason.

## Extra planted-defect modules

Every `tools/accuracy-extra-*.mjs` is loaded automatically by `tools/accuracy-corpus.mjs` (alphabetical order); with none present the corpus is the built-in one. A module exports `projects(ctx)` (sync or async) returning

```js
export function projects(ctx) {
  const { d, a, tok, S, pem, tidy, pkg, readme } = ctx
  return {
    projects: { 'my-project': { files: { 'app.js': ['const x = 1', d('my-key', 'what is planted', 'eval(req.body.x)')] }, absent: [], history: [] } },
    expect: { 'my-key': 'check-id/rule-id|alternative-check-id' },
  }
}
```

`d(key, description, text)` plants a defect on that line, `a(key, description, file)` plants the absence of something, `expect` maps each defect key to the check (and optional `MEERKAT-SUB` rule) that must report it, with `|` listing alternative checks. Defect keys and project names must be unique across the corpus. `ctx` also carries `S` (random-built secrets), `pem()`, `tidy(name)` (licence, readme, SECURITY, .gitignore), `pkg(name, extra)`, `MIT`, `SECURITY`, `EXPECT` and `PROJECTS`.

## Final run for 0.4.0

The last corpus run before 0.4.0 planted 1540 defects. 1533 were detected by a check (99.5%, the check's own verdict) and 1532 were found in the findings file (99.5%, what a person or an AI reading `findings.json` sees). Recall by impact and by difficulty to find (see [tiers.md](tiers.md) for what the labels mean):

| Impact | Planted | Detected by a check | Recall |
| --- | ---: | ---: | ---: |
| critical | 484 | 484 | 100.0% |
| high | 466 | 465 | 99.8% |
| medium | 352 | 349 | 99.1% |
| low | 238 | 235 | 98.7% |
| **all** | 1540 | 1533 | 99.5% |

| Difficulty to find | Planted | Detected by a check | Recall |
| --- | ---: | ---: | ---: |
| easy | 1021 | 1021 | 100.0% |
| medium | 324 | 323 | 99.7% |
| hard | 120 | 118 | 98.3% |
| extreme | 75 | 71 | 94.7% |
| **all** | 1540 | 1533 | 99.5% |

False alarms on the clean and trap twins in that run: 601 across 166 twins (a finding of critical, high or medium severity on a project written safely). **That is not the current rate.** The run was made before the test-quality fix and the later guard changes (the Plume scan fixes, the escaping-renderer guard, the shape-only rules reported as info), all of which remove false alarms. The corpus was not run again for this release, so the false-alarm rate of the final code was **not re-measured**. Treat 601 as the figure of an earlier state of the code, and treat the recall figures above as the only numbers measured on the final corpus.

The per-suite table and the list of known gaps below are generated from the same run. The full per-defect list is in [accuracy-results.md](accuracy-results.md). Recall on planted bugs measures what was planted, not real-world accuracy.

## Recall by suite

<!-- accuracy:begin -->

Generated by `node tools/accuracy-corpus.mjs --run` on 2026-11-03: 1540 planted defects in 123 projects, 1533 detected (99.5%).

| Suite | Planted | Detected by a check | Recall | In findings.json | Findings recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| accessibility | 28 | 28 | 100.0% | 28 | 100.0% |
| api-contracts | 1 | 1 | 100.0% | 1 | 100.0% |
| api-resilience | 8 | 8 | 100.0% | 8 | 100.0% |
| ci-config | 20 | 19 | 95.0% | 19 | 95.0% |
| ci-workflows | 5 | 5 | 100.0% | 5 | 100.0% |
| code-quality | 20 | 20 | 100.0% | 20 | 100.0% |
| config-files | 36 | 36 | 100.0% | 36 | 100.0% |
| content-and-docs | 20 | 20 | 100.0% | 20 | 100.0% |
| crypto-and-auth | 67 | 67 | 100.0% | 67 | 100.0% |
| data-files | 38 | 37 | 97.4% | 37 | 97.4% |
| database | 2 | 2 | 100.0% | 2 | 100.0% |
| dependencies | 15 | 14 | 93.3% | 14 | 93.3% |
| desktop-apps | 99 | 99 | 100.0% | 99 | 100.0% |
| docker | 157 | 157 | 100.0% | 157 | 100.0% |
| git-history | 3 | 3 | 100.0% | 3 | 100.0% |
| go | 5 | 5 | 100.0% | 5 | 100.0% |
| html-and-css | 10 | 10 | 100.0% | 10 | 100.0% |
| i18n | 4 | 4 | 100.0% | 4 | 100.0% |
| injection-patterns | 126 | 126 | 100.0% | 126 | 100.0% |
| javascript | 19 | 19 | 100.0% | 19 | 100.0% |
| licensing | 2 | 2 | 100.0% | 2 | 100.0% |
| node | 5 | 1 | 20.0% | 1 | 20.0% |
| python | 12 | 12 | 100.0% | 12 | 100.0% |
| release-versioning | 14 | 14 | 100.0% | 14 | 100.0% |
| repo-docs | 6 | 6 | 100.0% | 6 | 100.0% |
| repo-files | 7 | 7 | 100.0% | 7 | 100.0% |
| risky-calls | 506 | 506 | 100.0% | 505 | 99.8% |
| rust | 7 | 7 | 100.0% | 7 | 100.0% |
| secrets | 131 | 131 | 100.0% | 131 | 100.0% |
| seo-and-meta | 1 | 1 | 100.0% | 1 | 100.0% |
| slow-code-patterns | 4 | 4 | 100.0% | 4 | 100.0% |
| supply-chain | 6 | 6 | 100.0% | 6 | 100.0% |
| test-hygiene | 6 | 6 | 100.0% | 6 | 100.0% |
| web-security | 150 | 150 | 100.0% | 150 | 100.0% |
| **all** | 1540 | 1533 | 99.5% | 1532 | 99.5% |

### Known gaps

- `grow-extreme-node-docker-old` `Dockerfile:1`: the Dockerfile builds on an older Node than the version file, the engines range and the workflow (expected `node-version-mismatch`)
- `grow-extreme-node-nvmrc-old` `.nvmrc:1`: the version file pins an older Node than the engines range, the Dockerfile and the workflow (expected `node-version-mismatch`)
- `grow-extreme-lock-removed-dependency` `package.json:7`: the lockfile still records a package that package.json no longer lists (expected `lockfile-in-sync`)
- `grow-lang-notebook-churn` `notebooks/score.ipynb:9`: a scoring notebook that loads a model file from a path held in a variable (expected `pickle-load`)
- `grow-low-r-h-gitlab-stage` `.gitlab-ci.yml:3`: a GitLab job in a stage the file never declares (expected `gitlab-ci-stages`)
- `grow-low-r-h-engines-vs-nvmrc` `.nvmrc:1`: engines asks for Node 20 and .nvmrc says 16 (expected `node-engines`)
- `grow-low-r-x-node-four-way` `.nvmrc:1`: the Node major differs between .nvmrc, engines, the Dockerfile and the workflow (expected `node-version-mismatch`)

<!-- accuracy:end -->

## Why the gaps exist

The list above is generated from the final run. The reasons in the table below were written for the gaps of an earlier, smaller run \*, and none of them is hidden by a lowered threshold.

> \*Corrected 2026-11-03: the table below describes the gaps of the earlier 1044-defect run. Those defects are no longer gaps. The seven gaps of the final run (the Node version mismatch rules, the lockfile that still lists a removed dependency, the notebook that loads a model from a variable path, the GitLab stage rule and the engines-versus-nvmrc rule) have no written reason yet; the generated list above is the current truth.

| Gap | Reason |
| --- | --- |
| `js-prototype-pollution` on a recursive `merge` helper | The rule is deliberately narrow: it flags `__proto__`, `constructor.prototype` and request-keyed writes, not the recursive-copy shape |
| `py-assert-in-prod` on `assert user.is_admin` | Only asserts that check input shape (`is None`, `isinstance`, `len`) are flagged; authorisation asserts are not |
| `risky-code` / `weak-crypto-modes` on `random.randint` in a reset token | The line itself must name token, secret, session and so on; the function name one line above does not count |
| `cp-java`, `cp-dotnet-php-ruby` rules for `new Random()`, `Process.Start`, `Digest::MD5` and `send(params[...])` | No rule exists for these shapes |
| `yaml-valid` | The structure check is lenient: an unclosed flow sequence (`build: [unclosed`) still reads as valid; a multi-line flow sequence is legal YAML, so a line-based rule cannot tell them apart safely |
| `random-seed-missing` on an `np.random.permutation` plus a scikit-learn model | Only the listed random calls count as sampling, and the trains-a-model test is narrow |

## Fixed because of this guard

- `toml-valid` did not see a key with no value (`port = = 80`).
- `debug-leftovers` did not see `debugger` written without a semicolon (the usual style in a project that does not use them).
- `cp-js` (`js-exec-variable`) skipped `cp.exec(...)` and `childProcess.exec(...)` because any dot before `exec` was treated as `regex.exec`; the common child_process aliases are now recognised, `regex.exec` still is not.
- `regex-dos` missed the classic `(\w+\s?)+` shape.

Each has a regression test in `lib/accuracy.test.ts`.

## Ground truth on real code

The planted-defect corpus above holds defects we wrote ourselves, so its recall says little about real code. `tools/benchmark.mjs` scans a known vulnerable open-source project and compares Meerkat's findings with the project's own published vulnerability list, stored as data in `benchmarks/<name>.json` (file, line range, vulnerability class, source URL, pinned commit).

```
node tools/benchmark.mjs nodegoat                      clone the pinned commit into a new temp folder, scan it, compare
node tools/benchmark.mjs nodegoat --dir <checkout>     scan a checkout you already have (a note appears if it is not the pinned commit)
```

It runs `node run.mjs --preset quick --plain` with `MEERKAT_FINDINGS=all`, then prints recall (expected found / expected), the missed vulnerabilities, and the findings that match no expected vulnerability, counted by rule. A finding matches an entry when it is in the same file, has the same vulnerability class (a table in the tool maps rules to classes) and a line within 5 lines of the entry's range; a finding that names no line matches by file and class. Unmatched findings are candidate false alarms only: nobody has judged them, and most are style or hygiene findings that a vulnerability list does not cover. The downloaded code is only read, never installed or run.

First measurement (2026-11-02, OWASP NodeGoat at `c5cb68a7084e`, 17 expected vulnerabilities):

| Result | Count |
|---|---|
| Found | 5 of 17 (29.4% recall): eval injection, open redirect, ReDoS, plain-HTTP server, missing security headers (matched by file) |
| Missed | 12: NoSQL injection (`$where`), SSRF, missing function-level access control, IDOR, XSS (autoescape off, wrong encoding context), insecure session cookie settings, missing CSRF protection, hard-coded cookie secret, session fixation, user enumeration, log injection |
| Findings matching no expected entry | 171 of 184 (top rules: deprecated-deps 25, final-newline 16, trailing-whitespace 9, iframe-title 8, ui-static 8) |

No rule was tuned for this measurement. The gap between this recall and the corpus recall is the point of the benchmark: it is the list of real misses to work from (GitHub issue 70).

## The false-positive side

The mirror of this corpus is the compatibility matrix (`tools/compat-fixtures.mjs`, `tools/compat-matrix.mjs`, `lib/compat.test.ts`, `docs/compatibility.md`): small CLEAN projects of twenty kinds on which every check must pass, not crash and not hang. Together the two say the checks neither cry wolf nor stay silent.

## False-alarm traps

`tools/accuracy-extra-trap-lang-*.mjs` write clean projects (names end in `-clean`) whose code looks like a bug to a naive rule but is safe: a constant argument list, a bounded regular expression, a placeholder secret in documentation, a hardened workflow. They plant no defect, so they add nothing to the recall table. Each trap names the check it is aimed at (the modules export `TRAPS`). To see which traps a check still flags (a real false alarm of that check, to be fixed in the check, never hidden):

```
node tools/accuracy-corpus.mjs --out <dir>
node tools/trap-lang-verify.mjs <dir>
```
