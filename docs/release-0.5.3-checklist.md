# Release checklist

Steps to cut the release, in order. Run each command from the repository root, one at a time (no `&&`, so it pastes into PowerShell 5.1). Stop at the first failure and fix it before going on. The publish steps (9 to 11) are a person's job: nothing here runs them for you. Background: [release.md](release.md).

Replace `<version>` with the version in `package.json` wherever it appears.

Before you start: be on the release branch with a clean `git status`, and Node 22.14 or later.

## 1. Full test suite on the head

- [ ] Note the head you are releasing.

```
git rev-parse --short HEAD
```

- [ ] Run every test. It must pass with zero failures. Do not release on a partial run.

```
npx vitest run
```

## 2. Quick self-run

- [ ] Meerkat's quick checks on its own repository.

```
node bin/meerkat.mjs verify
```

## 3. Full self-run

- [ ] Every check, the slow ones too. Read any NOT RUN line; it is not a pass.

```
node bin/meerkat.mjs full
```

## 4. Changelog check

- [ ] The changelog has an Unreleased section, dated versions, and its newest version equals `package.json`.

```
node tools/release/changelog-check.mjs
```

- [ ] The docs still agree with the code (command names, flags, counts).

```
npx vitest run tests/docdrift.test.ts tests/repodocs.test.ts
```

## 5. Release gate

- [ ] Changelog, pack list, `npm audit`, secret scan and fix-needs-a-test, in one run.

```
node tools/release/gate.mjs
```

- [ ] The same with the tarball smoke test, as the publish workflow runs it.

```
node tools/release/gate.mjs --smoke
```

## 6. Tarball smoke test

- [ ] Pack, install the tarball in a fresh project and run the installed bin.

```
node tools/release/tarball-smoke.mjs
```

- [ ] Upgrade path: install the last published version, save state, install this one over it, read the state back. Replace `<old version>` with the version on npm now.

```
node tools/release/upgrade-smoke.mjs --previous @samuelndce/meerkat@<old version> --online
```

## 7. Version bump

- [ ] The version is already the one in `package.json`. Confirm `package.json` and `package-lock.json` agree.

```
node -p "require('./package.json').version"
```

```
node -p "require('./package-lock.json').version"
```

## 8. Commit and merge

- [ ] Everything committed, working tree clean.

```
git status --short
```

- [ ] Merge to the release branch the way the project does (pull request and the local queue). Confirm the merged head is the one tested in steps 1 to 6.

## 9. Tag (not run by this checklist)

- [ ] Create the annotated tag on the tested head. `v<version>` must equal the `package.json` version; the publish workflow checks this.

```
git tag -a v<version> -m "Meerkat <version>"
```

- [ ] Push the tag, only when you mean to release.

```
git push origin v<version>
```

## 10. npm publish (not run by this checklist)

The `Publish to npm` workflow publishes when the GitHub release in step 11 is published, with trusted publishing and no token. It needs the one-time Trusted Publisher setup on npmjs.com (see release.md) and has not been run end to end. Manual fallback, from the tagged head, only if the workflow cannot be used:

```
npm publish --access public
```

## 11. GitHub release (not run by this checklist)

- [ ] Publish a release for the tag with this version's changelog section as its notes. This starts the publish workflow.

```
gh release create v<version> --title "Meerkat <version>" --notes-file release-notes.md
```

## 12. After publishing

- [ ] The new version is on npm.

```
npm view @samuelndce/meerkat version
```

- [ ] If the release is bad, do not unpublish: deprecate it and ship a fixed patch (release.md, "Rolling back a bad release").
