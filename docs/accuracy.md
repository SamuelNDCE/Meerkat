# Accuracy: does every check catch what it should?

Meerkat's checks can be wrong in two ways. A **false positive** is a FAIL on a project that is fine. A **false negative** is a PASS on a project that has the very defect the check exists for. The compatibility matrix guards the first kind; the accuracy corpus guards the second.

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

## Recall by suite

<!-- accuracy:begin -->

Generated by `node tools/accuracy-corpus.mjs --run` on 2026-11-01: 622 planted defects in 25 projects, 591 detected (95.0%).

| Suite | Planted | Detected by a check | Recall | In findings.json | Findings recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| accessibility | 20 | 20 | 100.0% | 20 | 100.0% |
| api-resilience | 1 | 1 | 100.0% | 1 | 100.0% |
| ci-config | 11 | 8 | 72.7% | 8 | 72.7% |
| ci-workflows | 4 | 4 | 100.0% | 4 | 100.0% |
| code-quality | 6 | 6 | 100.0% | 6 | 100.0% |
| config-files | 26 | 23 | 88.5% | 23 | 88.5% |
| content-and-docs | 10 | 9 | 90.0% | 9 | 90.0% |
| crypto-and-auth | 15 | 15 | 100.0% | 15 | 100.0% |
| data-files | 18 | 15 | 83.3% | 15 | 83.3% |
| dependencies | 8 | 6 | 75.0% | 6 | 75.0% |
| desktop-apps | 12 | 12 | 100.0% | 12 | 100.0% |
| docker | 134 | 131 | 97.8% | 130 | 97.0% |
| git-history | 3 | 3 | 100.0% | 3 | 100.0% |
| go | 2 | 2 | 100.0% | 2 | 100.0% |
| html-and-css | 7 | 6 | 85.7% | 6 | 85.7% |
| injection-patterns | 27 | 27 | 100.0% | 27 | 100.0% |
| javascript | 5 | 5 | 100.0% | 5 | 100.0% |
| licensing | 1 | 1 | 100.0% | 1 | 100.0% |
| python | 6 | 6 | 100.0% | 6 | 100.0% |
| repo-docs | 4 | 3 | 75.0% | 3 | 75.0% |
| repo-files | 4 | 4 | 100.0% | 4 | 100.0% |
| risky-calls | 168 | 164 | 97.6% | 164 | 97.6% |
| rust | 4 | 4 | 100.0% | 4 | 100.0% |
| secrets | 49 | 49 | 100.0% | 49 | 100.0% |
| seo-and-meta | 1 | 1 | 100.0% | 1 | 100.0% |
| slow-code-patterns | 1 | 1 | 100.0% | 1 | 100.0% |
| supply-chain | 5 | 5 | 100.0% | 5 | 100.0% |
| test-hygiene | 2 | 2 | 100.0% | 2 | 100.0% |
| web-security | 68 | 58 | 85.3% | 53 | 77.9% |
| **all** | 622 | 591 | 95.0% | 585 | 94.1% |

### Known gaps

- `variants-js` `src/js/exec-aliases-3.js:1`: exec wrapped with promisify and called with concatenation (expected `cp-js`)
- `variants-js` `src/js/injection.js:110`: require of a computed name (expected `cp-js`)
- `variants-js` `src/js/injection.js:116`: require of a concatenated name (expected `cp-js`)
- `variants-cs` `src/cs/Variants.cs:50`: System.Random for a token (expected `cp-dotnet-php-ruby`)
- `x-terraform` `terraform/v6.tf:5`: SSH open to every IPv6 address (expected `ip-terraform-compose/tf-sg-open-22`)
- `x-ci` `.github/workflows/perm-all-quoted.yml:2`: write-all quoted (expected `ip-gha/gha-permissions-write-all`)
- `x-ci` `.github/workflows/prt-checkout3.yml:8`: checkout of refs/pull merge ref (expected `ip-gha/gha-prt-checkout-pr-head`)
- `x-ci` `ci/gitlab-extra.gitlab-ci.yml:6`: docker-in-docker with TLS turned off (expected `gitlab-ci-privileged`)
- `x-ci` `.circleci/config.yml:5`: an executor image with the latest tag (expected `circleci-config`)
- `x-ci` `Jenkinsfile:6`: curl piped to sh in a shell step (expected `jenkinsfile-safety`)
- `x-web` `Caddyfile:2`: Caddy CSP with unsafe-inline scripts (expected `wh-headers/csp-unsafe-inline-script`)
- `x-web` `src/server-helmet.js:4`: helmet with HSTS turned off (expected `wh-headers`)
- `x-web` `src/server-helmet.js:6`: helmet with the content security policy turned off (expected `wh-headers`)
- `x-web` `src/server-cookie.js:7`: a session cookie with httpOnly false (expected `wh-headers/session-cookie-no-httponly`)
- `x-web` `src/server-powered.js:3`: app.enable('x-powered-by') (expected `wh-headers/express-x-powered-by-enabled`)
- `x-web` `src/server-cors.js:4`: the request Origin echoed back (expected `wh-headers/cors-reflects-request-origin`)
- `x-web` `site/iframe-nosandbox.html:10`: a third-party iframe with no sandbox, attributes on several lines (expected `wh-html/iframe-no-sandbox`)
- `x-web` `site/script-http.html:10`: a script loaded over plain http (expected `mixed-content`)
- `x-web` `site/tabindex.html:10`: a positive tabindex in single quotes (expected `ui-static`)
- `x-web` `public/app.js.map:1`: a source map in the published folder (expected `wh-publish-root/sourcemap-shipped`)
- `x-packages` `pkgs/b/package.json:4`: an open >= range (expected `wildcard-versions`)
- `x-packages` `pkgs/c/package.json:4`: a 1.x range (expected `wildcard-versions`)
- `x-packages` `pkgs/n/.npmrc:1`: strict-ssl turned off, with spaces (expected `wh-supply`)
- `x-config` `cfg/arr-open.toml:2`: a multi-line array that is never closed (expected `toml-valid`)
- `x-config` `data/semicolon.csv:3`: a long row in a semicolon-separated file (expected `csv-consistent`)
- `x-config` `docs/typo2.txt:1`: a misspelling in a text file (expected `spell-common-typos`)
- `x-config` `CHANGES/CHANGELOG.md:3`: a version heading with no date (expected `changelog-format`)
- `x-config` `build/Makefile.mk:2`: a recipe indented with spaces in a second Makefile (expected `makefile-tabs`)
- `x-config` `build/GNUmakefile:2`: a recipe indented with spaces in a GNUmakefile (expected `makefile-tabs`)
- `x-config` `notebooks/secret.ipynb`: a token printed in a notebook output (expected `notebook-secrets`)
- `x-config` `notebooks/paths.ipynb`: an absolute Windows path in a notebook (expected `notebook-absolute-paths`)

<!-- accuracy:end -->

## Why the gaps exist

The list above is generated. The reasons, from reading each rule, are in the table below; none of them is hidden by a lowered threshold.

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

## The false-positive side

The mirror of this corpus is the compatibility matrix (`tools/compat-fixtures.mjs`, `tools/compat-matrix.mjs`, `lib/compat.test.ts`, `docs/compatibility.md`): small CLEAN projects of twenty kinds on which every check must pass, not crash and not hang. Together the two say the checks neither cry wolf nor stay silent.
