# Releasing Meerkat

How a version gets from a branch to npm, what is checked on the way, and how to take a bad one back. Nothing here publishes by itself: a person cuts the version and publishes the GitHub release.

## The release gate

One command runs every pre-release check. It publishes, tags and pushes nothing.

```
node tools/release/gate.mjs
```

| Step | What it proves | Script |
|---|---|---|
| changelog | `CHANGELOG.md` has an `## Unreleased` section, every version heading has a real date, and the newest version heading equals the version in `package.json` | `tools/release/changelog-check.mjs` |
| pack-list | The files `npm pack` would ship are inside the allow rule below | `tools/release/pack-list.mjs` |
| audit | `npm audit --audit-level=high --omit=dev` finds no high or critical advisory in a shipped dependency | `tools/release/gate.mjs` |
| secrets | Meerkat's own secret scan finds nothing in the tracked files | `thorough/secret-scan.mjs` |
| fix-tests | Every commit since the last tag whose subject starts with "fix" also touches a test file | `tools/release/fix-tests.mjs` |
| smoke | Only with `--smoke`: the packed tarball installs in a fresh project and the installed bin runs | `tools/release/tarball-smoke.mjs` |

Exit codes: 0 every step passed, 1 a step failed, 75 a step could not run and none failed. A step that cannot run (for example the registry is unreachable for the audit) is never counted as a pass.

Flags: `--smoke` adds the tarball install test, `--strict` makes fix-tests fail instead of warn, `--skip-audit` skips the audit (it then shows as NOT RUN), `--range <a..b>` sets the commit range for fix-tests.

The gate runs in CI on every pull request (job `release gate` in `.github/workflows/ci.yml`) and again before `npm publish` in `.github/workflows/publish.yml`, so a failing gate stops the publish.

### Audit threshold

`npm audit --audit-level=high --omit=dev`: the run fails on a high or critical advisory and passes on low and moderate ones. npm documents that `--audit-level` only sets the failure threshold and does not filter the report, so lower-severity advisories are still printed. `--omit=dev` leaves out the development dependencies (vitest), because only what is installed by users can reach them. Meerkat has no runtime dependencies at the time of writing, so this normally finds nothing; the step is there so that adding one cannot slip past. Source: [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit). The separate `npm-audit-all` check (`thorough/npm-audit.mjs`) audits every dependency, development ones included, in the full run.

### Pack file-list rule

`npm pack --dry-run --json` lists the tarball, and every path must pass:

- top-level folders: `bin`, `lib`, `packs`, `thorough`, `profiles`, `fixtures`, `examples`; top-level files: `package.json`, README, LICENSE, `CHANGELOG.md`, `llms.txt`, `run.mjs`, `meerkat.config.json`
- fixtures only under `fixtures/` or `examples/<name>/fixtures/`. The package ships those on purpose, because `meerkat self-test` reads the planted-defect folders at run time; a fixture anywhere else fails
- never: `.env` files (`.env.example` and `.env.sample` are fine), `.pem`, `.key`, `.p12`, `.pfx`, `.jks` files, `id_rsa` style names, `.npmrc`, files named `credentials` or `secrets`, test files (`*.test.*`, `*.spec.*`) and `tests/` folders

The rule is the `checkPackList` function in `tools/release/pack-list.mjs`; change it there and in `tests/release-tools.test.ts`. The `files` field and what npm always includes are described in the [package.json documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files) and [npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack).

## Tarball install test

```
node tools/release/tarball-smoke.mjs
```

Packs the repo, checks the file list, installs the `.tgz` into a fresh temp project, then runs the installed bin: `--version` must equal the packed version, `--help` must work, and a quick scan (`security-fast`) of a tiny fixture must finish with a summary line. It runs with a temp home folder, so it never reads or writes the real `~/.meerkat`, and it removes every temp folder (`--keep` leaves them). The install is `--offline` because Meerkat has no dependencies, so the local tarball alone is enough; `--online` lets npm use the registry. It takes about a minute and a half.

## Upgrade test

```
node tools/release/upgrade-smoke.mjs --previous @samuelndce/meerkat@<old version> --online
```

Installs the previous version, lets it scan a fixture and save a baseline, plants a dismissal in the documented format, installs the new tarball over it, and checks that every saved file (run store, baselines, dismissals, findings) is still there byte for byte and that the new version reads the run store and the dismissals. `--previous` can also be a folder holding an unpacked package or a `.tgz`, which needs no network: for example `git archive v<old version> | tar -x -C <folder>`. Without `--previous` it prints NOT RUN and exits 75 (it never uses the network on its own). `--new <tgz or folder>` replaces the default (a pack of this repo), `--allow-same` accepts equal version numbers for a rehearsal.

## Cutting a release

1. Merge the work. Notes collect under `## Unreleased` in `CHANGELOG.md`.
2. `node tools/release.mjs patch "what changed; one point per semicolon"` (or `minor`, `major`, an exact version). It bumps `package.json` and `package-lock.json`, writes the dated changelog entry and redraws the version badge. It changes files only.
3. `node tools/release/gate.mjs --smoke`, and the upgrade test against the last published version.
4. Commit, merge, tag `v<version>`, and publish a GitHub release for that tag. Releases come in batches, at most one a day (see PROJECT.md).
5. The `Publish to npm` workflow runs on the published release.

## Publishing: npm trusted publishing

`.github/workflows/publish.yml` publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): the job has `id-token: write`, there is no `NPM_TOKEN` anywhere, and the tag must equal the `package.json` version before anything runs. npm documents that trusted publishing needs npm CLI 11.5.1 or later and Node 22.14.0 or later (the workflow uses Node 24), and that a publish from GitHub Actions this way also generates provenance.

**It needs one-time setup on npm before the first use**, which only the package owner can do: on npmjs.com open the package `@samuelndce/meerkat`, Settings, Trusted Publisher, GitHub Actions, and enter user `SamuelNDCE`, repository `Meerkat`, workflow filename `publish.yml`. Until that is done the publish step fails; this was not tested end to end here. Nothing in this repository publishes.

## Rolling back a bad release

npm does not let a published version be replaced, so the fix is always a new version.

1. **Deprecate the bad version.** `npm deprecate @samuelndce/meerkat@<bad version> "<message: what is wrong, and which version fixes it>"`. This gives everyone who installs it a deprecation warning. It also takes a version range, for example `"< 0.6.2"`. You must be a package owner; an empty message undoes the deprecation. Source: [npm deprecate](https://docs.npmjs.com/cli/v11/commands/npm-deprecate).
2. **Ship a fixed patch.** Fix on a branch with a test, add the note under `## Unreleased`, run `node tools/release.mjs patch "..."`, run the gate, and publish a new GitHub release. A version number is never reused, even if the version is unpublished.
3. **Unpublishing is a last resort.** npm allows it only in the cases its [unpublish policy](https://docs.npmjs.com/policies/unpublish) lists: within 72 hours of publishing when nothing else in the public registry depends on the package, or when no package depends on it, it had under 300 downloads in the last week and it has a single owner. Otherwise deprecate.

What the release tool does **not** do: it does not commit, tag, push, publish, deprecate or unpublish anything, it does not edit a version that is already published, and it does not move a dist-tag. Every one of those is a person's step.

## OpenSSF Scorecard (optional)

[OpenSSF Scorecard](https://github.com/ossf/scorecard) scores a repository's security practices (branch protection, pinned dependencies, token permissions, signed releases and more). It is not enabled in this repository, on purpose: the Scorecard action's own README says it is free for public repositories and supported for private ones only with GitHub Advanced Security, and this repository is private until its owner decides otherwise. Without Advanced Security it can still be run from the command line with the `scorecard` program.

When the repository is public, add `.github/workflows/scorecard.yml` like this. The action SHAs were read with `git ls-remote` on 2026-11-07 and must be re-read before use; the tag is annotated, so the commit is the peeled `^{}` line:

```yaml
name: Scorecard
on:
  schedule:
    - cron: '30 4 * * 1'
  push:
    branches: [main]
permissions: read-all
jobs:
  analysis:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ossf/scorecard-action@4eaacf0543bb3f2c246792bd56e8cdeffafb205a # v2.4.3
        with:
          results_file: results.sarif
          results_format: sarif
          publish_results: true
      - uses: github/codeql-action/upload-sarif@33d7b85da1a04171e211befe2c739303b9a4c066 # v4.39.3
        with:
          sarif_file: results.sarif
```

`ossf/scorecard-action` v2.4.3 resolves to `4eaacf0543bb3f2c246792bd56e8cdeffafb205a`; `github/codeql-action` v4.39.3 resolves to `33d7b85da1a04171e211befe2c739303b9a4c066`. The workflow was not run here.

## Repository topics

The GitHub topics match the `keywords` in `package.json`: verdict, branch-check, code-review, static-analysis, lint, security, ai-agents, mcp, code-map, pre-commit, pre-push, cli, ci, sarif, accessibility, developer-tools. They are set on GitHub, not by this repository; `gh repo edit --add-topic <name>` adds one. Not verified in this build: whether the live repository already carries them.
