# Planted-bug accuracy: results

**Recall on planted bugs measures what was planted, not real-world accuracy.** The corpus is written by the project, so a high number says the checks find the defects the project already knew about.

## Final run for 0.4.0

The numbers in this section come from the final corpus run before 0.4.0 (the same run as the table in [accuracy.md](accuracy.md)). The per-defect list further down is from an earlier, smaller run and was not regenerated; see the note there.

- Planted defects: 1540
- Detected by a check: 1533 (99.5%)
- Found in the findings file: 1532 (99.5%)
- Missed by the check itself: 7
- Clean and trap twin false alarms in that run: 601 across 166 twins. This run was made before the test-quality fix and the later guard changes, so 601 is not the current rate. The final false-alarm rate was not re-measured, because the corpus was not run again for this release.

### Recall by impact

| Impact | Planted | Detected by a check | Recall |
| --- | ---: | ---: | ---: |
| critical | 484 | 484 | 100.0% |
| high | 466 | 465 | 99.8% |
| medium | 352 | 349 | 99.1% |
| low | 238 | 235 | 98.7% |
| **all** | 1540 | 1533 | 99.5% |

### Recall by difficulty to find

| Difficulty to find | Planted | Detected by a check | Recall |
| --- | ---: | ---: | ---: |
| easy | 1021 | 1021 | 100.0% |
| medium | 324 | 323 | 99.7% |
| hard | 120 | 118 | 98.3% |
| extreme | 75 | 71 | 94.7% |
| **all** | 1540 | 1533 | 99.5% |

### Recall by suite

| Suite | Planted | Detected by a check | Recall |
| --- | ---: | ---: | ---: |
| accessibility | 28 | 28 | 100.0% |
| api-contracts | 1 | 1 | 100.0% |
| api-resilience | 8 | 8 | 100.0% |
| ci-config | 20 | 19 | 95.0% |
| ci-workflows | 5 | 5 | 100.0% |
| code-quality | 20 | 20 | 100.0% |
| config-files | 36 | 36 | 100.0% |
| content-and-docs | 20 | 20 | 100.0% |
| crypto-and-auth | 67 | 67 | 100.0% |
| data-files | 38 | 37 | 97.4% |
| database | 2 | 2 | 100.0% |
| dependencies | 15 | 14 | 93.3% |
| desktop-apps | 99 | 99 | 100.0% |
| docker | 157 | 157 | 100.0% |
| git-history | 3 | 3 | 100.0% |
| go | 5 | 5 | 100.0% |
| html-and-css | 10 | 10 | 100.0% |
| i18n | 4 | 4 | 100.0% |
| injection-patterns | 126 | 126 | 100.0% |
| javascript | 19 | 19 | 100.0% |
| licensing | 2 | 2 | 100.0% |
| node | 5 | 1 | 20.0% |
| python | 12 | 12 | 100.0% |
| release-versioning | 14 | 14 | 100.0% |
| repo-docs | 6 | 6 | 100.0% |
| repo-files | 7 | 7 | 100.0% |
| risky-calls | 506 | 506 | 100.0% |
| rust | 7 | 7 | 100.0% |
| secrets | 131 | 131 | 100.0% |
| seo-and-meta | 1 | 1 | 100.0% |
| slow-code-patterns | 4 | 4 | 100.0% |
| supply-chain | 6 | 6 | 100.0% |
| test-hygiene | 6 | 6 | 100.0% |
| web-security | 150 | 150 | 100.0% |
| **all** | 1540 | 1533 | 99.5% |

### Defects the checks missed

- `grow-extreme-node-docker-old` `Dockerfile:1`: the Dockerfile builds on an older Node than the version file, the engines range and the workflow (expected `node-version-mismatch`)
- `grow-extreme-node-nvmrc-old` `.nvmrc:1`: the version file pins an older Node than the engines range, the Dockerfile and the workflow (expected `node-version-mismatch`)
- `grow-extreme-lock-removed-dependency` `package.json:7`: the lockfile still records a package that package.json no longer lists (expected `lockfile-in-sync`)
- `grow-lang-notebook-churn` `notebooks/score.ipynb:9`: a scoring notebook that loads a model file from a path held in a variable (expected `pickle-load`)
- `grow-low-r-h-gitlab-stage` `.gitlab-ci.yml:3`: a GitLab job in a stage the file never declares (expected `gitlab-ci-stages`)
- `grow-low-r-h-engines-vs-nvmrc` `.nvmrc:1`: engines asks for Node 20 and .nvmrc says 16 (expected `node-engines`)
- `grow-low-r-x-node-four-way` `.nvmrc:1`: the Node major differs between .nvmrc, engines, the Dockerfile and the workflow (expected `node-version-mismatch`)

## Earlier run: per-defect list

> *Corrected 2026-11-03: everything below this line is the generated output of an earlier run of 1044 planted defects. It is kept because it lists every defect with its result, but its totals are superseded by the final run above, and the "false alarms" line in it is out of date. The generator (`node tools/gen-accuracy-results.mjs <run-output>`) needs the saved output of a run to regenerate it, and the final run's output was not saved, so the per-defect list for all 1540 defects is not regenerated here.

### Summary (earlier run, 1044 defects)

- Planted defects: 1044
- Found by a check: 1038 (99.4%)
- Missed: 6
- Clean-twin false alarms: not recorded in this run output (30 clean twins were run, but the run prints no per-twin result)

### Recall by tier (earlier run, 1044 defects)

| Tier | Planted | Found | Recall |
| --- | ---: | ---: | ---: |
| critical | 312 | 312 | 100.0% |
| hard | 115 | 109 | 94.8% |
| medium | 392 | 392 | 100.0% |
| easy | 225 | 225 | 100.0% |
| **all** | 1044 | 1038 | 99.4% |

### Recall by suite (earlier run, 1044 defects)

| Suite | Planted | Found | Recall |
| --- | ---: | ---: | ---: |
| accessibility | 26 | 26 | 100.0% |
| api-resilience | 5 | 4 | 80.0% |
| ci-config | 12 | 12 | 100.0% |
| ci-workflows | 5 | 5 | 100.0% |
| code-quality | 17 | 17 | 100.0% |
| config-files | 31 | 31 | 100.0% |
| content-and-docs | 18 | 18 | 100.0% |
| crypto-and-auth | 38 | 38 | 100.0% |
| data-files | 24 | 24 | 100.0% |
| dependencies | 10 | 10 | 100.0% |
| desktop-apps | 75 | 75 | 100.0% |
| docker | 157 | 157 | 100.0% |
| git-history | 3 | 3 | 100.0% |
| go | 5 | 5 | 100.0% |
| html-and-css | 9 | 9 | 100.0% |
| injection-patterns | 69 | 69 | 100.0% |
| javascript | 17 | 15 | 88.2% |
| licensing | 1 | 1 | 100.0% |
| python | 12 | 12 | 100.0% |
| repo-docs | 5 | 5 | 100.0% |
| repo-files | 6 | 6 | 100.0% |
| risky-calls | 256 | 254 | 99.2% |
| rust | 7 | 7 | 100.0% |
| secrets | 101 | 101 | 100.0% |
| seo-and-meta | 1 | 1 | 100.0% |
| slow-code-patterns | 4 | 3 | 75.0% |
| supply-chain | 6 | 6 | 100.0% |
| test-hygiene | 6 | 6 | 100.0% |
| web-security | 118 | 118 | 100.0% |
| **all** | 1044 | 1038 | 99.4% |

### Missed defects (earlier run, 1044 defects)

- `hard-config-tls-verify-dict` (hard, risky-calls): expected `risky-code` at `http_opts.py:1`
- `hard-race-sync-fs-helper` (hard, slow-code-patterns): expected `sync-fs-in-handlers` at `src/lib/store.js:3`
- `hard-race-floating-promise` (hard, javascript): expected `js-unhandled-promise` at `src/routes/signup.js:3`
- `hard-race-session-no-timeout` (hard, risky-calls): expected `cp-python/py-requests-no-timeout` at `svc/prices.py:4`
- `hard-taint-error-leak-helper` (hard, api-resilience): expected `error-leak` at `src/lib/errors.js:1`
- `hard-taint-proto-merge` (hard, javascript): expected `js-prototype-pollution` at `src/lib/merge.js:7`

### Clean-twin false alarms (earlier run, 1044 defects)

This run output does not record false alarms. 30 clean twins (the same code written safely) were run: ai-env-fallback-key-clean, ai-jwt-decode-auth-clean, ai-tls-verify-off-clean, ai-reset-token-random-clean, ai-login-next-redirect-clean, ai-download-path-join-clean, ai-swallowed-error-clean, ai-floating-promise-clean, ai-new-buffer-clean, ai-react-inner-html-clean, client-web-react-clean, client-desktop-clean, client-mobile-clean, client-api-next-clean, client-static-site-clean, client-monorepo-clean, crit-crypto-auth-clean, crit-deserialise-clean, crit-exec-clean, crit-injection-clean, crit-secrets-clean, easy-docs-clean, easy-hygiene-clean, hard-authz-clean, hard-config-clean, hard-race-clean, hard-taint-clean, med-config-clean, med-lang-clean, med-web-clean.

### Every planted defect (earlier run, 1044 defects)

Result: OK means a check reported it at the planted place, MISS means none did.

| Key | Tier | Suite | Expected check | Result |
| --- | --- | --- | --- | --- |
| `client-site-img-noalt` | easy | accessibility | `image-alt-quality` | OK |
| `css-low-contrast` | easy | accessibility | `css-contrast` | OK |
| `css-outline-none` | easy | accessibility | `focus-visible` | OK |
| `easy-css-outline-none` | easy | accessibility | `focus-visible` | OK |
| `easy-html-iframe-no-title` | easy | accessibility | `iframe-title` | OK |
| `easy-html-img-no-alt` | easy | accessibility | `image-alt-quality` | OK |
| `easy-html-link-click-here` | easy | accessibility | `link-text` | OK |
| `easy-html-table-no-th` | easy | accessibility | `table-headers` | OK |
| `html-iframe-no-title` | easy | accessibility | `iframe-title` | OK |
| `html-img-no-alt` | easy | accessibility | `image-alt-quality` | OK |
| `html-link-text` | easy | accessibility | `link-text` | OK |
| `html-table-no-th` | easy | accessibility | `table-headers` | OK |
| `html-video-no-captions` | easy | accessibility | `media-captions` | OK |
| `xi-web-css-outline-none-oneline` | easy | accessibility | `focus-visible` | OK |
| `xi-web-css-outline-zero` | easy | accessibility | `focus-visible` | OK |
| `xi-web-iframe-no-title` | easy | accessibility | `iframe-title` | OK |
| `xi-web-img-multiline-no-alt` | medium | accessibility | `image-alt-quality` | OK |
| `xi-web-img-unquoted-no-alt` | easy | accessibility | `image-alt-quality` | OK |
| `xi-web-img-upper-no-alt` | easy | accessibility | `image-alt-quality` | OK |
| `xi-web-jsx-img-no-alt` | easy | accessibility | `image-alt-quality` | OK |
| `xi-web-link-text-click-here` | easy | accessibility | `link-text` | OK |
| `xi-web-link-text-read-more` | easy | accessibility | `link-text` | OK |
| `xi-web-svelte-img-no-alt` | easy | accessibility | `image-alt-quality` | OK |
| `xi-web-table-no-th` | easy | accessibility | `table-headers` | OK |
| `xi-web-video-no-track` | easy | accessibility | `media-captions` | OK |
| `xi-web-vue-img-no-alt` | easy | accessibility | `image-alt-quality` | OK |
| `hard-taint-error-leak-helper` | hard | api-resilience | `error-leak` | MISS |
| `js-error-leak` | medium | api-resilience | `error-leak` | OK |
| `med-error-leak-message` | medium | api-resilience | `error-leak` | OK |
| `med-error-leak-stack` | medium | api-resilience | `error-leak` | OK |
| `med-error-leak-traceback` | medium | api-resilience | `error-leak` | OK |
| `gitlab-image-latest` | easy | ci-config | `gitlab-ci-images` | OK |
| `helm-password` | critical | ci-config | `helm-values-secrets` | OK |
| `med-gitlab-latest-image` | medium | ci-config | `gitlab-ci-images` | OK |
| `repo-no-ci` | easy | ci-config | `ci-present` | OK |
| `xi-azure-curl-bash` | medium | ci-config | `azure-pipelines` | OK |
| `xi-circle-image-latest` | easy | ci-config | `circleci-config` | OK |
| `xi-gitlab-dind-tls-off` | medium | ci-config | `gitlab-ci-privileged` | OK |
| `xi-gitlab-image-latest-explicit` | easy | ci-config | `gitlab-ci-images` | OK |
| `xi-gitlab-image-name-form` | easy | ci-config | `gitlab-ci-images` | OK |
| `xi-gitlab-secret-variable` | critical | ci-config | `gitlab-ci-secrets` | OK |
| `xi-gitlab-service-latest` | easy | ci-config | `gitlab-ci-images` | OK |
| `xi-jenkins-curl-sh` | medium | ci-config | `jenkinsfile-safety` | OK |
| `gha-unpinned-action` | medium | ci-workflows | `workflow-security` | OK |
| `med-gha-unpinned-branch` | medium | ci-workflows | `workflow-security` | OK |
| `xi-gha-unpinned-main` | medium | ci-workflows | `workflow-security` | OK |
| `xi-gha-unpinned-quoted` | medium | ci-workflows | `workflow-security` | OK |
| `xi-gha-unpinned-thirdparty-tag` | medium | ci-workflows | `workflow-security` | OK |
| `ai-swallowed-error` | easy | code-quality | `empty-catch` | OK |
| `easy-console-log-handler` | easy | code-quality | `debug-leftovers` | OK |
| `easy-console-log-render` | easy | code-quality | `debug-leftovers` | OK |
| `easy-debugger-statement` | easy | code-quality | `debug-leftovers` | OK |
| `easy-go-debug-println` | easy | code-quality | `debug-leftovers` | OK |
| `easy-py-debug-print` | easy | code-quality | `debug-leftovers` | OK |
| `easy-rust-dbg-macro` | easy | code-quality | `debug-leftovers` | OK |
| `easy-trailing-spaces-py` | easy | code-quality | `trailing-whitespace` | OK |
| `easy-trailing-tab-js` | easy | code-quality | `trailing-whitespace` | OK |
| `java-empty-catch` | easy | code-quality | `empty-catch` | OK |
| `js-debug-leftover` | easy | code-quality | `debug-leftovers` | OK |
| `js-empty-catch` | easy | code-quality | `empty-catch` | OK |
| `med-empty-catch-cache` | medium | code-quality | `empty-catch` | OK |
| `med-empty-except-pass` | medium | code-quality | `empty-catch` | OK |
| `trailing-ws` | easy | code-quality | `trailing-whitespace` | OK |
| `xi-trailing-ws-crlf-spaces` | easy | code-quality | `trailing-whitespace` | OK |
| `xi-trailing-ws-tab` | easy | code-quality | `trailing-whitespace` | OK |
| `easy-json-single-quotes` | easy | config-files | `json-valid` | OK |
| `easy-json-trailing-comma` | easy | config-files | `json-valid` | OK |
| `easy-makefile-spaces` | easy | config-files | `makefile-tabs` | OK |
| `easy-toml-unclosed-string` | easy | config-files | `toml-valid` | OK |
| `easy-yaml-tab-indent` | easy | config-files | `yaml-valid` | OK |
| `json-invalid` | easy | config-files | `json-valid` | OK |
| `makefile-spaces` | easy | config-files | `makefile-tabs` | OK |
| `toml-invalid` | easy | config-files | `toml-valid` | OK |
| `xi-gnumakefile-spaces` | easy | config-files | `makefile-tabs` | OK |
| `xi-json-line-comment` | easy | config-files | `json-valid` | OK |
| `xi-json-single-quotes` | easy | config-files | `json-valid` | OK |
| `xi-json-trailing-comma-nested` | easy | config-files | `json-valid` | OK |
| `xi-mk-spaces` | easy | config-files | `makefile-tabs` | OK |
| `xi-toml-array-unclosed` | easy | config-files | `toml-valid` | OK |
| `xi-toml-bad-header` | easy | config-files | `toml-valid` | OK |
| `xi-toml-crlf-empty-value` | easy | config-files | `toml-valid` | OK |
| `xi-toml-dup-key` | medium | config-files | `toml-valid` | OK |
| `xi-toml-dup-table` | medium | config-files | `toml-valid` | OK |
| `xi-toml-string-unclosed` | easy | config-files | `toml-valid` | OK |
| `xi-yaml-crlf-dup` | medium | config-files | `yaml-valid` | OK |
| `xi-yaml-dup-in-item` | medium | config-files | `yaml-valid` | OK |
| `xi-yaml-dup-nested` | medium | config-files | `yaml-valid` | OK |
| `xi-yaml-flow-map-eof` | easy | config-files | `yaml-valid` | OK |
| `xi-yaml-flow-mismatch` | easy | config-files | `yaml-valid` | OK |
| `xi-yaml-flow-seq-eof` | easy | config-files | `yaml-valid` | OK |
| `xi-yaml-flow-seq-multiline-unclosed` | medium | config-files | `yaml-valid` | OK |
| `xi-yaml-multidoc-dup` | medium | config-files | `yaml-valid` | OK |
| `xi-yaml-quote-unclosed` | easy | config-files | `yaml-valid` | OK |
| `xi-yaml-tab-mid-file` | easy | config-files | `yaml-valid` | OK |
| `xi-yaml-undefined-alias` | hard | config-files | `yaml-valid` | OK |
| `yaml-invalid` | easy | config-files | `yaml-valid` | OK |
| `easy-md-anchor-broken` | easy | content-and-docs | `markdown-anchors` | OK |
| `easy-md-anchor-renamed` | easy | content-and-docs | `markdown-anchors` | OK |
| `easy-md-fence-unclosed` | easy | content-and-docs | `markdown-code-fences` | OK |
| `easy-md-heading-skip` | easy | content-and-docs | `markdown-headings` | OK |
| `easy-md-heading-skip-h3` | easy | content-and-docs | `markdown-headings` | OK |
| `easy-md-typo-recieve` | easy | content-and-docs | `spell-common-typos` | OK |
| `easy-md-typo-seperate` | easy | content-and-docs | `spell-common-typos` | OK |
| `easy-txt-typo-teh` | easy | content-and-docs | `spell-common-typos` | OK |
| `md-broken-anchor` | easy | content-and-docs | `markdown-anchors` | OK |
| `md-heading-skip` | easy | content-and-docs | `markdown-headings` | OK |
| `md-typo` | easy | content-and-docs | `spell-common-typos` | OK |
| `md-unclosed-fence` | easy | content-and-docs | `markdown-code-fences` | OK |
| `xi-md-anchor-case` | easy | content-and-docs | `markdown-anchors` | OK |
| `xi-md-anchor-missing-ref` | easy | content-and-docs | `markdown-anchors` | OK |
| `xi-md-heading-skip-h4` | easy | content-and-docs | `markdown-headings` | OK |
| `xi-md-tilde-fence-unclosed` | easy | content-and-docs | `markdown-code-fences` | OK |
| `xi-md-typo-definately` | easy | content-and-docs | `spell-common-typos` | OK |
| `xi-txt-typo-teh` | easy | content-and-docs | `spell-common-typos` | OK |
| `ai-jwt-decode-auth` | critical | crypto-and-auth | `jwt-weak` | OK |
| `ai-reset-token-random` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `client-next-jwt-literal` | critical | crypto-and-auth | `jwt-weak` | OK |
| `client-next-jwt-none` | critical | crypto-and-auth | `jwt-weak` | OK |
| `crit-aes-ecb` | critical | crypto-and-auth | `weak-crypto-modes` | OK |
| `crit-create-cipher` | critical | crypto-and-auth | `weak-crypto-modes` | OK |
| `crit-jwt-literal-secret` | critical | crypto-and-auth | `jwt-weak` | OK |
| `crit-jwt-none-sign` | critical | crypto-and-auth | `jwt-weak` | OK |
| `crit-jwt-none-verify` | critical | crypto-and-auth | `jwt-weak` | OK |
| `crit-md5-password` | critical | crypto-and-auth | `weak-crypto-modes` | OK |
| `crit-rand-reset` | critical | crypto-and-auth | `weak-crypto-modes` | OK |
| `crit-rand-session` | critical | crypto-and-auth | `weak-crypto-modes` | OK |
| `hard-authz-jwt-decode-middleware` | hard | crypto-and-auth | `jwt-weak` | OK |
| `hard-config-cipher-constant` | hard | crypto-and-auth | `weak-crypto-modes` | OK |
| `hard-config-fixed-key-constant` | hard | crypto-and-auth | `weak-crypto-modes` | OK |
| `hard-config-jwt-alg-list` | hard | crypto-and-auth | `jwt-weak` | OK |
| `hard-config-jwt-secret-fallback` | hard | crypto-and-auth | `jwt-weak` | OK |
| `js-aes-ecb` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `js-jwt-none` | critical | crypto-and-auth | `jwt-weak` | OK |
| `js-math-random-token` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `js-md5-password` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `med-jwt-decode-as-auth` | medium | crypto-and-auth | `jwt-weak` | OK |
| `med-jwt-literal-secret` | medium | crypto-and-auth | `jwt-weak` | OK |
| `med-jwt-signature-off` | medium | crypto-and-auth | `jwt-weak` | OK |
| `med-weak-aes-ecb` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `med-weak-md5-password-py` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `med-weak-random-token` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `php-md5-password` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `v-java-des` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `v-js-createcipher` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `v-js-des` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `v-js-ecb` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `v-js-jwt-hardcoded` | critical | crypto-and-auth | `jwt-weak` | OK |
| `v-js-jwt-none` | critical | crypto-and-auth | `jwt-weak` | OK |
| `v-js-math-random-fn` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `v-js-math-random-token` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `v-js-md5-require` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `v-php-md5-password` | medium | crypto-and-auth | `weak-crypto-modes` | OK |
| `crit-deser-py-pickle-load` | critical | data-files | `pickle-load` | OK |
| `crit-deser-py-pickle-loads` | critical | data-files | `pickle-load` | OK |
| `csv-ragged` | easy | data-files | `csv-consistent` | OK |
| `easy-csv-ragged-row` | easy | data-files | `csv-consistent` | OK |
| `easy-json-duplicate-key` | easy | data-files | `json-duplicate-keys` | OK |
| `hard-taint-pickle-loads` | hard | data-files | `pickle-load` | OK |
| `json-dup-key` | medium | data-files | `json-duplicate-keys` | OK |
| `med-py-pickle-cookie` | medium | data-files | `pickle-load` | OK |
| `ml-no-seed` | easy | data-files | `random-seed-missing` | OK |
| `py-pickle` | critical | data-files | `pickle-load` | OK |
| `v-py-pickle-load-file` | critical | data-files | `pickle-load` | OK |
| `v-py-pickle-loads` | critical | data-files | `pickle-load` | OK |
| `xi-csv-crlf-ragged` | easy | data-files | `csv-consistent` | OK |
| `xi-csv-quoted-then-short` | easy | data-files | `csv-consistent` | OK |
| `xi-csv-semicolon-ragged` | easy | data-files | `csv-consistent` | OK |
| `xi-json-dup-in-array` | medium | data-files | `json-duplicate-keys` | OK |
| `xi-json-dup-nested` | medium | data-files | `json-duplicate-keys` | OK |
| `xi-ml-no-seed-shuffle` | easy | data-files | `random-seed-missing` | OK |
| `xi-ml-no-seed-split` | easy | data-files | `random-seed-missing` | OK |
| `xi-ml-no-seed-torch` | medium | data-files | `random-seed-missing` | OK |
| `xi-notebook-outputs` | medium | data-files | `notebook-outputs-stripped` | OK |
| `xi-notebook-paths` | easy | data-files | `notebook-absolute-paths` | OK |
| `xi-notebook-pip` | easy | data-files | `notebook-pip-magics` | OK |
| `xi-notebook-secret` | critical | data-files | `notebook-secrets` | OK |
| `easy-pkg-latest-version` | easy | dependencies | `wildcard-versions` | OK |
| `easy-pkg-star-version` | easy | dependencies | `wildcard-versions` | OK |
| `pkg-dev-in-prod` | easy | dependencies | `dev-deps-in-prod` | OK |
| `pkg-latest` | easy | dependencies | `wildcard-versions` | OK |
| `pkg-wildcard` | easy | dependencies | `wildcard-versions` | OK |
| `xi-pkg-empty-range` | easy | dependencies | `wildcard-versions` | OK |
| `xi-pkg-eslint-in-deps` | easy | dependencies | `dev-deps-in-prod` | OK |
| `xi-pkg-gte-range` | easy | dependencies | `wildcard-versions` | OK |
| `xi-pkg-jest-in-deps` | easy | dependencies | `dev-deps-in-prod` | OK |
| `xi-pkg-x-range` | easy | dependencies | `wildcard-versions` | OK |
| `client-el-args-secret` | critical | desktop-apps | `ep-window/ep-additional-args-secret` | OK |
| `client-el-bypass-csp` | easy | desktop-apps | `ep-window/ep-protocol-bypass-csp` | OK |
| `client-el-cert-accept` | medium | desktop-apps | `ep-window/ep-cert-verify-null-accept` | OK |
| `client-el-ctx` | critical | desktop-apps | `electron-context-isolation` | OK |
| `client-el-devtools` | easy | desktop-apps | `electron-devtools-prod` | OK |
| `client-el-dragdrop` | easy | desktop-apps | `ep-window/ep-drag-drop-navigate` | OK |
| `client-el-exec-js` | critical | desktop-apps | `ep-window/ep-execute-js-concat` | OK |
| `client-el-experimental` | easy | desktop-apps | `ep-window/ep-experimental-features` | OK |
| `client-el-fetch-http` | medium | desktop-apps | `ep-content-renderer/ep-fetch-plain-http` | OK |
| `client-el-html-csp` | easy | desktop-apps | `ep-content-renderer/ep-csp-unsafe-inline` | OK |
| `client-el-html-jshref` | medium | desktop-apps | `ep-content-renderer/ep-html-javascript-href` | OK |
| `client-el-html-remote-script` | medium | desktop-apps | `ep-content-renderer/ep-html-remote-script` | OK |
| `client-el-insecure` | medium | desktop-apps | `electron-web-security` | OK |
| `client-el-ipc-exec` | critical | desktop-apps | `electron-ipc-validation` | OK |
| `client-el-ipc-nosender` | hard | desktop-apps | `ep-ipc-preload/ep-ipc-handler-no-sender-check` | OK |
| `client-el-ipc-readfile` | critical | desktop-apps | `electron-ipc-validation` | OK |
| `client-el-loadurl-concat` | hard | desktop-apps | `ep-window/ep-load-url-concat` | OK |
| `client-el-loadurl-http` | easy | desktop-apps | `ep-window/ep-load-url-http` | OK |
| `client-el-loadurl-var` | hard | desktop-apps | `ep-window/ep-load-url-variable` | OK |
| `client-el-md-nosanitize` | medium | desktop-apps | `ep-content-renderer/ep-markdown-no-sanitizer` | OK |
| `client-el-message-origin` | hard | desktop-apps | `ep-content-renderer/ep-message-listener-no-origin` | OK |
| `client-el-node` | critical | desktop-apps | `electron-node-integration` | OK |
| `client-el-open-handler` | hard | desktop-apps | `ep-window/ep-open-all-windows` | OK |
| `client-el-openext-deeplink` | critical | desktop-apps | `electron-open-external` | OK |
| `client-el-openext-ipc` | critical | desktop-apps | `electron-open-external` | OK |
| `client-el-openpath` | hard | desktop-apps | `ep-window/ep-shell-path-variable` | OK |
| `client-el-perm-all` | hard | desktop-apps | `ep-window/ep-permission-grant-all` | OK |
| `client-el-preload-channel` | hard | desktop-apps | `ep-ipc-preload/ep-ipc-channel-forwarded` | OK |
| `client-el-preload-ipcrenderer` | hard | desktop-apps | `electron-preload-exposure` | OK |
| `client-el-preload-node` | critical | desktop-apps | `ep-ipc-preload/ep-preload-node-object` | OK |
| `client-el-preload-require` | critical | desktop-apps | `ep-ipc-preload/ep-window-require-global` | OK |
| `client-el-react-dsih` | medium | desktop-apps | `ep-content-renderer/ep-dangerous-inner-html-react` | OK |
| `client-el-remote` | hard | desktop-apps | `electron-remote-module` | OK |
| `client-el-sandbox` | medium | desktop-apps | `ep-window/ep-sandbox-off` | OK |
| `client-el-switch-cert` | medium | desktop-apps | `ep-window/ep-cli-ignore-cert-errors` | OK |
| `client-el-switch-debugport` | medium | desktop-apps | `ep-window/ep-cli-remote-debugging` | OK |
| `client-el-switch-nosandbox` | medium | desktop-apps | `ep-window/ep-no-sandbox-switch` | OK |
| `client-el-switch-websec` | medium | desktop-apps | `ep-window/ep-cli-disable-web-security` | OK |
| `client-el-updater-http` | medium | desktop-apps | `electron-updater-https` | OK |
| `client-el-websec` | medium | desktop-apps | `electron-web-security` | OK |
| `client-el-webviewtag` | easy | desktop-apps | `ep-window/ep-webview-tag-on` | OK |
| `client-mono-desktop-ctx` | critical | desktop-apps | `electron-context-isolation` | OK |
| `client-mono-desktop-ipc-nosender` | hard | desktop-apps | `ep-ipc-preload/ep-ipc-handler-no-sender-check` | OK |
| `client-mono-desktop-node` | critical | desktop-apps | `electron-node-integration` | OK |
| `client-mono-desktop-openext` | critical | desktop-apps | `electron-open-external` | OK |
| `client-mono-desktop-preload` | hard | desktop-apps | `electron-preload-exposure` | OK |
| `client-mono-desktop-updater` | medium | desktop-apps | `electron-updater-https` | OK |
| `client-mono-desktop-websec` | medium | desktop-apps | `electron-web-security` | OK |
| `client-mono-mobile-cleartext` | easy | desktop-apps | `capacitor-cordova-cleartext` | OK |
| `client-mono-mobile-debuggable` | easy | desktop-apps | `android-manifest-flags` | OK |
| `client-rn-allowbackup` | easy | desktop-apps | `android-manifest-flags` | OK |
| `client-rn-ats-off` | easy | desktop-apps | `ep-fuses-build/ep-plist-arbitrary-loads` | OK |
| `client-rn-capacitor-cleartext` | easy | desktop-apps | `capacitor-cordova-cleartext` | OK |
| `client-rn-cordova-access` | medium | desktop-apps | `ep-tauri-cross/ep-cordova-access-any` | OK |
| `client-rn-debuggable` | easy | desktop-apps | `android-manifest-flags` | OK |
| `client-rn-manifest-cleartext` | easy | desktop-apps | `capacitor-cordova-cleartext` | OK |
| `client-rn-network-config` | easy | desktop-apps | `capacitor-cordova-cleartext` | OK |
| `client-rn-webview-debug` | medium | desktop-apps | `ep-tauri-cross/ep-android-webview-debug` | OK |
| `client-rn-webview-fileaccess` | medium | desktop-apps | `ep-tauri-cross/ep-android-webview-file-access` | OK |
| `client-rn-webview-jsinterface` | hard | desktop-apps | `ep-tauri-cross/ep-android-js-interface` | OK |
| `el-context-isolation` | medium | desktop-apps | `electron-context-isolation` | OK |
| `el-devtools-open` | easy | desktop-apps | `electron-devtools-prod` | OK |
| `el-expose-ipcrenderer` | hard | desktop-apps | `electron-preload-exposure` | OK |
| `el-insecure-content` | medium | desktop-apps | `electron-web-security` | OK |
| `el-ipc-no-sender` | hard | desktop-apps | `electron-ipc-validation` | OK |
| `el-node-integration` | medium | desktop-apps | `electron-node-integration` | OK |
| `el-open-external-var` | hard | desktop-apps | `electron-open-external` | OK |
| `el-remote-module` | medium | desktop-apps | `electron-remote-module` | OK |
| `el-remote-url` | medium | desktop-apps | `ep-window/ep-load-url-http` | OK |
| `el-sandbox-off` | medium | desktop-apps | `ep-window/ep-sandbox-off` | OK |
| `el-updater-http` | medium | desktop-apps | `electron-updater-https` | OK |
| `el-web-security` | medium | desktop-apps | `electron-web-security` | OK |
| `med-electron-context-isolation` | medium | desktop-apps | `electron-context-isolation` | OK |
| `med-electron-node-integration` | medium | desktop-apps | `electron-node-integration` | OK |
| `med-electron-web-security` | medium | desktop-apps | `electron-web-security` | OK |
| `compose-db-port` | medium | docker | `compose-hygiene` | OK |
| `compose-docker-sock` | critical | docker | `ip-terraform-compose` | OK |
| `compose-host-network` | medium | docker | `compose-hygiene` | OK |
| `compose-latest` | easy | docker | `compose-hygiene` | OK |
| `compose-password` | critical | docker | `compose-hygiene` | OK |
| `compose-privileged` | critical | docker | `compose-hygiene` | OK |
| `docker-add-http` | medium | docker | `ip-docker/docker-add-from-url` | OK |
| `docker-chmod-777` | medium | docker | `ip-docker/docker-chmod-world-writable` | OK |
| `docker-curl-pipe` | medium | docker | `ip-docker/docker-curl-pipe-shell` | OK |
| `docker-env-secret` | critical | docker | `ip-docker/docker-secret-in-env` | OK |
| `docker-latest-tag` | easy | docker | `docker-base-pinning` | OK |
| `docker-user-root` | medium | docker | `ip-docker/docker-user-root-last` | OK |
| `gha-checkout-pr-head` | hard | docker | `ip-gha/gha-prt-checkout-pr-head` | OK |
| `gha-curl-bash` | medium | docker | `ip-gha/gha-curl-pipe-shell` | OK |
| `gha-pr-target` | hard | docker | `ip-gha/gha-pull-request-target-trigger` | OK |
| `gha-untrusted-input` | critical | docker | `ip-gha/gha-inject-issue-text-run` | OK |
| `gha-write-all` | hard | docker | `ip-gha/gha-permissions-write-all` | OK |
| `k8s-docker-sock` | critical | docker | `ip-k8s/k8s-host-path-docker-socket` | OK |
| `k8s-host-network` | medium | docker | `ip-k8s/k8s-host-network` | OK |
| `k8s-host-pid` | medium | docker | `ip-k8s/k8s-host-pid` | OK |
| `k8s-inline-secret` | critical | docker | `ip-k8s/k8s-secret-literal-env` | OK |
| `k8s-latest-image` | easy | docker | `ip-k8s/k8s-image-latest` | OK |
| `k8s-priv-escalation` | medium | docker | `ip-k8s/k8s-priv-escalation-true` | OK |
| `k8s-privileged` | critical | docker | `ip-k8s/k8s-privileged` | OK |
| `k8s-run-as-root` | medium | docker | `ip-k8s/k8s-run-as-user-zero` | OK |
| `med-compose-db-port` | medium | docker | `compose-hygiene` | OK |
| `med-compose-docker-sock` | medium | docker | `ip-terraform-compose` | OK |
| `med-compose-latest-db` | medium | docker | `compose-hygiene` | OK |
| `med-compose-password` | medium | docker | `compose-hygiene` | OK |
| `med-compose-privileged` | medium | docker | `compose-hygiene` | OK |
| `med-gha-checkout-head` | medium | docker | `ip-gha/gha-prt-checkout-pr-head` | OK |
| `med-gha-curl-bash` | medium | docker | `ip-gha/gha-curl-pipe-shell` | OK |
| `med-gha-prt-trigger` | medium | docker | `ip-gha/gha-pull-request-target-trigger` | OK |
| `med-gha-untrusted-title` | medium | docker | `ip-gha/gha-inject-issue-text-run` | OK |
| `med-gha-write-all` | medium | docker | `ip-gha/gha-permissions-write-all` | OK |
| `med-k8s-docker-sock` | medium | docker | `ip-k8s/k8s-host-path-docker-socket` | OK |
| `med-k8s-escalation` | medium | docker | `ip-k8s/k8s-priv-escalation-true` | OK |
| `med-k8s-host-network` | medium | docker | `ip-k8s/k8s-host-network` | OK |
| `med-k8s-host-pid` | medium | docker | `ip-k8s/k8s-host-pid` | OK |
| `med-k8s-image-latest` | medium | docker | `ip-k8s/k8s-image-latest` | OK |
| `med-k8s-privileged-sidecar` | medium | docker | `ip-k8s/k8s-privileged` | OK |
| `med-k8s-run-as-root` | medium | docker | `ip-k8s/k8s-run-as-user-zero` | OK |
| `med-k8s-secret-env` | medium | docker | `ip-k8s/k8s-secret-literal-env` | OK |
| `med-tf-bucket-public` | medium | docker | `ip-terraform-compose/tf-s3-public-acl` | OK |
| `med-tf-db-public` | medium | docker | `ip-terraform-compose/tf-rds-public` | OK |
| `med-tf-db-unencrypted` | medium | docker | `ip-terraform-compose/tf-rds-unencrypted` | OK |
| `med-tf-iam-star` | medium | docker | `ip-terraform-compose/tf-iam-wildcard-action` | OK |
| `med-tf-ssh-open` | medium | docker | `ip-terraform-compose/tf-sg-open-22` | OK |
| `tf-db-public` | critical | docker | `ip-terraform-compose/tf-rds-public` | OK |
| `tf-db-unencrypted` | medium | docker | `ip-terraform-compose/tf-rds-unencrypted` | OK |
| `tf-hardcoded-password` | critical | docker | `ip-terraform-compose` | OK |
| `tf-iam-star` | hard | docker | `ip-terraform-compose/tf-iam-wildcard-action` | OK |
| `tf-open-ssh` | critical | docker | `ip-terraform-compose/tf-sg-open-22` | OK |
| `tf-public-bucket` | critical | docker | `ip-terraform-compose/tf-s3-public-acl` | OK |
| `xi-compose-cap-sys-admin` | medium | docker | `ip-terraform-compose/compose-cap-add-dangerous` | OK |
| `xi-compose-dbport-long-syntax` | medium | docker | `compose-hygiene` | OK |
| `xi-compose-dbport-unquoted` | medium | docker | `compose-hygiene` | OK |
| `xi-compose-image-untagged` | easy | docker | `compose-hygiene` | OK |
| `xi-compose-latest-quoted` | easy | docker | `compose-hygiene` | OK |
| `xi-compose-nethost-quoted` | medium | docker | `compose-hygiene` | OK |
| `xi-compose-pid-host` | medium | docker | `ip-terraform-compose/compose-pid-host` | OK |
| `xi-compose-priv-quoted` | critical | docker | `compose-hygiene` | OK |
| `xi-compose-priv-yes` | critical | docker | `compose-hygiene` | OK |
| `xi-compose-pw-list-form` | critical | docker | `compose-hygiene` | OK |
| `xi-compose-pw-map-form` | critical | docker | `compose-hygiene` | OK |
| `xi-compose-pw-quoted` | critical | docker | `compose-hygiene` | OK |
| `xi-compose-sock-long` | critical | docker | `ip-terraform-compose` | OK |
| `xi-compose-sock-quoted` | critical | docker | `ip-terraform-compose` | OK |
| `xi-compose-user-root-pair` | medium | docker | `ip-terraform-compose/compose-user-root` | OK |
| `xi-docker-add-chown-url` | medium | docker | `ip-docker/docker-add-from-url` | OK |
| `xi-docker-add-http-checksum` | medium | docker | `ip-docker/docker-add-from-url` | OK |
| `xi-docker-add-lower` | medium | docker | `ip-docker/docker-add-from-url` | OK |
| `xi-docker-apt-multiline-no-y` | medium | docker | `ip-docker/docker-apt-install-no-yes` | OK |
| `xi-docker-apt-no-recommends-multiline` | medium | docker | `ip-docker/docker-apt-recommends` | OK |
| `xi-docker-apt-upgrade-chain` | easy | docker | `ip-docker/docker-apt-upgrade` | OK |
| `xi-docker-chmod-0777` | medium | docker | `ip-docker/docker-chmod-world-writable` | OK |
| `xi-docker-chmod-a-rwx` | medium | docker | `ip-docker/docker-chmod-world-writable` | OK |
| `xi-docker-chmod-multiline` | hard | docker | `ip-docker/docker-chmod-world-writable` | OK |
| `xi-docker-curl-pipe-multiline` | medium | docker | `ip-docker/docker-curl-pipe-shell` | OK |
| `xi-docker-curl-pipe-sudo-flags` | medium | docker | `ip-docker/docker-curl-pipe-shell` | OK |
| `xi-docker-download-http-multiline` | hard | docker | `ip-docker/docker-download-http` | OK |
| `xi-docker-download-http-wget` | medium | docker | `ip-docker/docker-download-http` | OK |
| `xi-docker-env-arg-token` | critical | docker | `ip-docker/docker-secret-in-env` | OK |
| `xi-docker-env-multi-pair` | hard | docker | `ip-docker/docker-secret-in-env` | OK |
| `xi-docker-env-quoted` | critical | docker | `ip-docker/docker-secret-in-env` | OK |
| `xi-docker-env-space-form` | critical | docker | `ip-docker/docker-secret-in-env` | OK |
| `xi-docker-expose-ssh-list` | medium | docker | `ip-docker/docker-expose-ssh` | OK |
| `xi-docker-expose-ssh-proto` | medium | docker | `ip-docker/docker-expose-ssh` | OK |
| `xi-docker-from-latest-as` | easy | docker | `docker-base-pinning` | OK |
| `xi-docker-from-platform-untagged` | easy | docker | `docker-base-pinning` | OK |
| `xi-docker-from-untagged-stage` | easy | docker | `docker-base-pinning` | OK |
| `xi-docker-healthcheck-none-spaced` | easy | docker | `ip-docker/docker-healthcheck-none` | OK |
| `xi-docker-npm-global-multiline` | medium | docker | `ip-docker/docker-npm-global-unpinned` | OK |
| `xi-docker-pip-http-index` | easy | docker | `ip-docker/docker-pip-untrusted-host` | OK |
| `xi-docker-pip-multiline` | medium | docker | `ip-docker/docker-pip-no-cache` | OK |
| `xi-docker-pip3-unpinned` | easy | docker | `ip-docker/docker-pip-unpinned` | OK |
| `xi-docker-root-last-comment` | medium | docker | `ip-docker/docker-user-root-last` | OK |
| `xi-docker-root-last-pair` | medium | docker | `ip-docker/docker-user-root-last` | OK |
| `xi-docker-root-last-zero` | medium | docker | `ip-docker/docker-user-root-last` | OK |
| `xi-docker-setuid-find` | medium | docker | `ip-docker/docker-setuid-bit` | OK |
| `xi-docker-sudo-chain` | easy | docker | `ip-docker/docker-sudo` | OK |
| `xi-docker-volume-json` | medium | docker | `ip-docker/docker-volume-sensitive` | OK |
| `xi-docker-wget-pipe` | medium | docker | `ip-docker/docker-curl-pipe-shell` | OK |
| `xi-gha-curl-block-bash` | medium | docker | `ip-gha/gha-curl-pipe-shell` | OK |
| `xi-gha-curl-sudo-bash` | medium | docker | `ip-gha/gha-curl-pipe-shell` | OK |
| `xi-gha-hardcoded-token-env` | critical | docker | `ip-gha/gha-hardcoded-env-secret` | OK |
| `xi-gha-inj-block` | critical | docker | `ip-gha/gha-inject-issue-text-run` | OK |
| `xi-gha-inj-head-ref` | hard | docker | `ip-gha/gha-inject-head-ref-run` | OK |
| `xi-gha-inj-head-ref-pr` | hard | docker | `ip-gha/gha-inject-head-ref-run` | OK |
| `xi-gha-inj-nospace` | critical | docker | `ip-gha/gha-inject-issue-text-run` | OK |
| `xi-gha-inj-pr-body` | critical | docker | `ip-gha/gha-inject-issue-text-run` | OK |
| `xi-gha-perm-flow-multi` | medium | docker | `ip-gha/gha-contents-write` | OK |
| `xi-gha-perm-flow-write` | medium | docker | `ip-gha/gha-contents-write` | OK |
| `xi-gha-perm-job-write` | medium | docker | `ip-gha/gha-contents-write` | OK |
| `xi-gha-perm-write-all-comment` | medium | docker | `ip-gha/gha-permissions-write-all` | OK |
| `xi-gha-perm-write-all-quoted` | medium | docker | `ip-gha/gha-permissions-write-all` | OK |
| `xi-gha-prt-block-quoted-on` | hard | docker | `ip-gha/gha-pull-request-target-trigger` | OK |
| `xi-gha-prt-checkout-head-ref` | hard | docker | `ip-gha/gha-prt-checkout-pr-head` | OK |
| `xi-gha-prt-checkout-merge-ref` | hard | docker | `ip-gha/gha-prt-checkout-pr-head` | OK |
| `xi-gha-prt-flow-list` | hard | docker | `ip-gha/gha-pull-request-target-trigger` | OK |
| `xi-gha-prt-flow-map` | hard | docker | `ip-gha/gha-pull-request-target-trigger` | OK |
| `xi-gha-wget-sh` | medium | docker | `ip-gha/gha-curl-pipe-shell` | OK |
| `xi-k8s-escalation-flow` | medium | docker | `ip-k8s/k8s-priv-escalation-true` | OK |
| `xi-k8s-escalation-quoted` | medium | docker | `ip-k8s/k8s-priv-escalation-true` | OK |
| `xi-k8s-helm-hostnet` | hard | docker | `ip-k8s/k8s-host-network` | OK |
| `xi-k8s-hostnet-quoted` | medium | docker | `ip-k8s/k8s-host-network` | OK |
| `xi-k8s-hostnet-title` | medium | docker | `ip-k8s/k8s-host-network` | OK |
| `xi-k8s-hostpid-comment` | medium | docker | `ip-k8s/k8s-host-pid` | OK |
| `xi-k8s-image-untagged-plain` | easy | docker | `ip-k8s/k8s-image-untagged` | OK |
| `xi-k8s-kustomize-patch-priv` | hard | docker | `ip-k8s/k8s-privileged` | OK |
| `xi-k8s-latest-quoted` | easy | docker | `ip-k8s/k8s-image-latest` | OK |
| `xi-k8s-latest-single-quote` | easy | docker | `ip-k8s/k8s-image-latest` | OK |
| `xi-k8s-priv-crlf` | critical | docker | `ip-k8s/k8s-privileged` | OK |
| `xi-k8s-priv-flow` | critical | docker | `ip-k8s/k8s-privileged` | OK |
| `xi-k8s-priv-quoted` | critical | docker | `ip-k8s/k8s-privileged` | OK |
| `xi-k8s-priv-second-doc` | hard | docker | `ip-k8s/k8s-privileged` | OK |
| `xi-k8s-runasuser-flow` | medium | docker | `ip-k8s/k8s-run-as-user-zero` | OK |
| `xi-k8s-runasuser-quoted` | medium | docker | `ip-k8s/k8s-run-as-user-zero` | OK |
| `xi-k8s-secret-env-flow` | critical | docker | `ip-k8s/k8s-secret-literal-env` | OK |
| `xi-k8s-secret-env-quoted-name` | critical | docker | `ip-k8s/k8s-secret-literal-env` | OK |
| `xi-k8s-sock-flow` | critical | docker | `ip-k8s/k8s-host-path-docker-socket` | OK |
| `xi-k8s-sock-quoted` | critical | docker | `ip-k8s/k8s-host-path-docker-socket` | OK |
| `xi-tf-acl-compact` | critical | docker | `ip-terraform-compose/tf-s3-public-acl` | OK |
| `xi-tf-acl-public-rw` | critical | docker | `ip-terraform-compose/tf-s3-public-acl` | OK |
| `xi-tf-iam-heredoc-star` | hard | docker | `ip-terraform-compose/tf-iam-wildcard-action` | OK |
| `xi-tf-iam-jsonencode-star` | hard | docker | `ip-terraform-compose/tf-iam-wildcard-action` | OK |
| `xi-tf-iam-star-spaced` | hard | docker | `ip-terraform-compose/tf-iam-wildcard-action` | OK |
| `xi-tf-json-public-acl` | hard | docker | `ip-terraform-compose/tf-s3-public-acl` | OK |
| `xi-tf-json-rds-public` | hard | docker | `ip-terraform-compose/tf-rds-public` | OK |
| `xi-tf-json-ssh` | hard | docker | `ip-terraform-compose/tf-sg-open-22` | OK |
| `xi-tf-password-compact` | critical | docker | `ip-terraform-compose` | OK |
| `xi-tf-rds-public-comment` | critical | docker | `ip-terraform-compose/tf-rds-public` | OK |
| `xi-tf-rds-public-compact` | critical | docker | `ip-terraform-compose/tf-rds-public` | OK |
| `xi-tf-rds-unencrypted-compact` | medium | docker | `ip-terraform-compose/tf-rds-unencrypted` | OK |
| `xi-tf-ssh-compact` | critical | docker | `ip-terraform-compose/tf-sg-open-22` | OK |
| `xi-tf-ssh-ipv6` | critical | docker | `ip-terraform-compose/tf-sg-open-22` | OK |
| `xi-tf-ssh-spaced-list` | critical | docker | `ip-terraform-compose/tf-sg-open-22` | OK |
| `hist-long-subject` | easy | git-history | `commit-message-format` | OK |
| `hist-secret-committed` | critical | git-history | `git-history-secrets` | OK |
| `hist-vague-subject` | easy | git-history | `commit-message-format` | OK |
| `go-defer-loop` | medium | go | `go-defer-in-loop` | OK |
| `go-ignored-error` | easy | go | `go-ignored-errors` | OK |
| `med-go-defer-in-loop-files` | medium | go | `go-defer-in-loop` | OK |
| `med-go-ignored-err-assign` | medium | go | `go-ignored-errors` | OK |
| `med-go-ignored-err-rename` | medium | go | `go-ignored-errors` | OK |
| `client-site-nolang` | easy | html-and-css | `html-structure` | OK |
| `easy-html-duplicate-id` | easy | html-and-css | `duplicate-ids` | OK |
| `html-duplicate-id` | easy | html-and-css | `duplicate-ids` | OK |
| `html-input-no-label` | easy | html-and-css | `ui-static` | OK |
| `html-no-lang` | easy | html-and-css | `html-structure` | OK |
| `html-tabindex-positive` | easy | html-and-css | `ui-static` | OK |
| `xi-web-dupe-id-single` | easy | html-and-css | `duplicate-ids` | OK |
| `xi-web-html-no-lang-upper` | easy | html-and-css | `html-structure` | OK |
| `xi-web-tabindex-positive-single` | easy | html-and-css | `ui-static` | OK |
| `ai-download-path-join` | critical | injection-patterns | `path-traversal-pattern` | OK |
| `ai-login-next-redirect` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `client-mono-api-redirect` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `client-mono-api-sql` | critical | injection-patterns | `sql-concat` | OK |
| `client-mono-next-redirect` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `client-mono-web-redirect` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `client-next-action-sql` | critical | injection-patterns | `sql-concat` | OK |
| `client-next-api-path` | critical | injection-patterns | `path-traversal-pattern` | OK |
| `client-next-redirect-api` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `client-next-redirect-page` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `client-next-redirect-searchparams` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `client-react-redirect-hash` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `client-react-redirect-next` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `crit-inj-js-sql-concat` | critical | injection-patterns | `sql-concat` | OK |
| `crit-inj-js-sql-template` | critical | injection-patterns | `sql-concat` | OK |
| `crit-inj-py-sql-fstring` | critical | injection-patterns | `sql-concat` | OK |
| `hard-authz-oauth-return-redirect` | hard | injection-patterns | `open-redirect-pattern` | OK |
| `hard-config-regex-constant` | hard | injection-patterns | `regex-dos` | OK |
| `hard-taint-path-helper` | hard | injection-patterns | `path-traversal-pattern` | OK |
| `hard-taint-path-python` | hard | injection-patterns | `path-traversal-pattern` | OK |
| `hard-taint-redirect-helper` | hard | injection-patterns | `open-redirect-pattern` | OK |
| `hard-taint-redirect-python` | hard | injection-patterns | `open-redirect-pattern` | OK |
| `hard-taint-second-order-path` | hard | injection-patterns | `path-traversal-pattern` | OK |
| `hard-taint-sql-order-column` | hard | injection-patterns | `sql-concat` | OK |
| `hard-taint-sql-split-lines` | hard | injection-patterns | `sql-concat` | OK |
| `js-open-redirect` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `js-path-traversal` | critical | injection-patterns | `path-traversal-pattern` | OK |
| `js-regex-dos` | medium | injection-patterns | `regex-dos` | OK |
| `js-sql-concat` | critical | injection-patterns | `sql-concat` | OK |
| `med-path-flask-send-file` | medium | injection-patterns | `path-traversal-pattern` | OK |
| `med-path-go-readfile` | medium | injection-patterns | `path-traversal-pattern` | OK |
| `med-path-join-query` | medium | injection-patterns | `path-traversal-pattern` | OK |
| `med-path-sendfile-taint` | medium | injection-patterns | `path-traversal-pattern` | OK |
| `med-redirect-flask-next` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `med-redirect-location-header` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `med-redirect-return-to` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `med-regex-nested-plus` | medium | injection-patterns | `regex-dos` | OK |
| `med-regex-new-regexp` | medium | injection-patterns | `regex-dos` | OK |
| `med-regex-python-compile` | medium | injection-patterns | `regex-dos` | OK |
| `med-sql-concat-java` | medium | injection-patterns | `sql-concat` | OK |
| `med-sql-dot-php` | medium | injection-patterns | `sql-concat` | OK |
| `med-sql-fstring-orders` | medium | injection-patterns | `sql-concat` | OK |
| `med-sql-interp-ruby` | medium | injection-patterns | `sql-concat` | OK |
| `med-sql-percent-format` | medium | injection-patterns | `sql-concat` | OK |
| `med-sql-sprintf-go` | medium | injection-patterns | `sql-concat` | OK |
| `med-sql-template-js` | medium | injection-patterns | `sql-concat` | OK |
| `py-sql-fstring` | critical | injection-patterns | `sql-concat` | OK |
| `v-cs-sql-interp` | critical | injection-patterns | `sql-concat` | OK |
| `v-java-sql-format` | critical | injection-patterns | `sql-concat` | OK |
| `v-java-sql-variable` | hard | injection-patterns | `sql-concat` | OK |
| `v-js-createreadstream` | critical | injection-patterns | `path-traversal-pattern` | OK |
| `v-js-fs-readfile-join` | critical | injection-patterns | `path-traversal-pattern` | OK |
| `v-js-redirect-body` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `v-js-redirect-location` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `v-js-redirect-multiline` | hard | injection-patterns | `open-redirect-pattern` | OK |
| `v-js-sendfile-multiline` | hard | injection-patterns | `path-traversal-pattern` | OK |
| `v-js-sql-concat-multiline` | hard | injection-patterns | `sql-concat` | OK |
| `v-js-sql-template` | critical | injection-patterns | `sql-concat` | OK |
| `v-js-sql-template-multiline` | hard | injection-patterns | `sql-concat` | OK |
| `v-js-sql-variable` | hard | injection-patterns | `sql-concat` | OK |
| `v-js-window-location` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `v-php-redirect` | medium | injection-patterns | `open-redirect-pattern` | OK |
| `v-py-sql-concat-multiline` | hard | injection-patterns | `sql-concat` | OK |
| `v-py-sql-format` | critical | injection-patterns | `sql-concat` | OK |
| `v-py-sql-fstring` | critical | injection-patterns | `sql-concat` | OK |
| `v-py-sql-percent` | critical | injection-patterns | `sql-concat` | OK |
| `v-py-sql-variable` | hard | injection-patterns | `sql-concat` | OK |
| `v-ts-regex-dos` | medium | injection-patterns | `regex-dos` | OK |
| `v-ts-regex-dos-ctor` | medium | injection-patterns | `regex-dos` | OK |
| `ai-floating-promise` | easy | javascript | `js-unhandled-promise` | OK |
| `easy-loose-equality-id` | easy | javascript | `js-eqeqeq` | OK |
| `easy-loose-equality-role` | easy | javascript | `js-eqeqeq` | OK |
| `easy-loose-inequality-count` | easy | javascript | `js-eqeqeq` | OK |
| `easy-ts-ignore-line` | easy | javascript | `ts-ignore-comments` | OK |
| `easy-ts-nocheck-file` | easy | javascript | `ts-ignore-comments` | OK |
| `hard-race-floating-promise` | hard | javascript | `js-unhandled-promise` | MISS |
| `hard-taint-proto-merge` | hard | javascript | `js-prototype-pollution` | MISS |
| `js-await-in-loop` | easy | javascript | `js-await-in-loop` | OK |
| `js-loose-equality` | easy | javascript | `js-eqeqeq` | OK |
| `js-proto-pollution` | hard | javascript | `js-prototype-pollution` | OK |
| `js-unhandled-promise` | easy | javascript | `js-unhandled-promise` | OK |
| `med-await-loop-emails` | medium | javascript | `js-await-in-loop` | OK |
| `med-proto-pollution-assign` | medium | javascript | `js-prototype-pollution` | OK |
| `med-proto-pollution-two-level` | medium | javascript | `js-prototype-pollution` | OK |
| `med-unhandled-then` | medium | javascript | `js-unhandled-promise` | OK |
| `ts-ignore` | easy | javascript | `ts-ignore-comments` | OK |
| `repo-no-license` | easy | licensing | `license` | OK |
| `med-py-assert-admin` | medium | python | `py-assert-in-prod` | OK |
| `med-py-assert-none` | medium | python | `py-assert-in-prod` | OK |
| `med-py-bare-except-loop` | medium | python | `py-bare-except` | OK |
| `med-py-bare-except-parse` | medium | python | `py-bare-except` | OK |
| `med-py-mutable-dict-default` | medium | python | `py-mutable-default` | OK |
| `med-py-mutable-list-default` | medium | python | `py-mutable-default` | OK |
| `py-assert-prod` | medium | python | `py-assert-in-prod` | OK |
| `py-bare-except` | easy | python | `py-bare-except` | OK |
| `py-mutable-default` | easy | python | `py-mutable-default` | OK |
| `v-py-assert-auth` | medium | python | `py-assert-in-prod` | OK |
| `v-py-assert-token` | medium | python | `py-assert-in-prod` | OK |
| `v-py-assert-validate` | medium | python | `py-assert-in-prod` | OK |
| `changelog-format` | easy | repo-docs | `changelog-format` | OK |
| `easy-changelog-no-date` | easy | repo-docs | `changelog-format` | OK |
| `repo-no-security-policy` | easy | repo-docs | `security-policy` | OK |
| `repo-readme-thin` | easy | repo-docs | `readme-sections` | OK |
| `xi-changelog-no-date` | easy | repo-docs | `changelog-format` | OK |
| `conflict-marker` | easy | repo-files | `conflict-markers` | OK |
| `easy-conflict-in-js` | easy | repo-files | `conflict-markers` | OK |
| `easy-conflict-in-yaml` | easy | repo-files | `conflict-markers` | OK |
| `repo-no-gitignore` | easy | repo-files | `gitignore-essentials` | OK |
| `xi-md-conflict-marker` | easy | repo-files | `conflict-markers` | OK |
| `xi-py-conflict-marker` | easy | repo-files | `conflict-markers` | OK |
| `ai-new-buffer` | easy | risky-calls | `cp-js` | OK |
| `ai-react-inner-html` | medium | risky-calls | `risky-code` | OK |
| `ai-tls-verify-off` | medium | risky-calls | `risky-code` | OK |
| `client-mono-api-exec` | critical | risky-calls | `cp-js` | OK |
| `client-mono-api-md5` | medium | risky-calls | `risky-code` | OK |
| `client-mono-mobile-fetch-http` | medium | risky-calls | `risky-code` | OK |
| `client-mono-next-action` | critical | risky-calls | `cp-js` | OK |
| `client-mono-shared-tls` | medium | risky-calls | `risky-code` | OK |
| `client-mono-web-dsih` | medium | risky-calls | `risky-code` | OK |
| `client-next-action-eval` | critical | risky-calls | `risky-code` | OK |
| `client-next-action-exec` | critical | risky-calls | `cp-js` | OK |
| `client-next-fetch-http` | medium | risky-calls | `risky-code` | OK |
| `client-next-reset-token` | medium | risky-calls | `risky-code` | OK |
| `client-next-tls-off` | medium | risky-calls | `risky-code` | OK |
| `client-react-dsih-bio` | medium | risky-calls | `risky-code` | OK |
| `client-react-dsih-comment` | medium | risky-calls | `risky-code` | OK |
| `client-react-dsih-snippet` | medium | risky-calls | `risky-code` | OK |
| `client-react-eval-formula` | critical | risky-calls | `risky-code` | OK |
| `client-react-fetch-http` | medium | risky-calls | `risky-code` | OK |
| `client-react-innerhtml-ref` | medium | risky-calls | `risky-code` | OK |
| `client-react-math-random-token` | medium | risky-calls | `risky-code` | OK |
| `client-react-md5-password` | medium | risky-calls | `risky-code` | OK |
| `client-react-new-function` | critical | risky-calls | `risky-code` | OK |
| `client-react-timer-string` | critical | risky-calls | `cp-js` | OK |
| `client-react-tls-off` | medium | risky-calls | `risky-code` | OK |
| `client-rn-axios-http` | medium | risky-calls | `risky-code` | OK |
| `client-rn-fetch-http` | medium | risky-calls | `risky-code` | OK |
| `client-rn-tls-off` | medium | risky-calls | `risky-code` | OK |
| `client-site-docwrite` | medium | risky-calls | `risky-code` | OK |
| `crit-deser-cs-binaryformatter` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `crit-deser-java-objectinput` | critical | risky-calls | `cp-java` | OK |
| `crit-deser-js-node-serialize` | critical | risky-calls | `cp-js` | OK |
| `crit-deser-php-unserialize` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `crit-deser-py-yaml-load` | critical | risky-calls | `risky-code` | OK |
| `crit-deser-rb-marshal` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `crit-deser-rb-yaml-load` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `crit-exec-go-bash-c` | critical | risky-calls | `cp-go` | OK |
| `crit-exec-go-sh-c` | critical | risky-calls | `cp-go` | OK |
| `crit-exec-js-destructured` | critical | risky-calls | `cp-js` | OK |
| `crit-exec-js-renamed` | critical | risky-calls | `cp-js` | OK |
| `crit-exec-js-spawn-shell` | critical | risky-calls | `cp-js` | OK |
| `crit-exec-php-shell-exec` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `crit-exec-py-alias-call` | critical | risky-calls | `risky-code` | OK |
| `crit-exec-py-check-output` | critical | risky-calls | `risky-code` | OK |
| `crit-exec-py-popen` | critical | risky-calls | `cp-python` | OK |
| `crit-exec-py-shell-true` | critical | risky-calls | `risky-code` | OK |
| `crit-exec-rb-backtick` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `crit-exec-rs-format` | critical | risky-calls | `cp-rust` | OK |
| `crit-go-tls-skip` | critical | risky-calls | `risky-code` | OK |
| `crit-inj-java-runtime-exec` | critical | risky-calls | `cp-java` | OK |
| `crit-inj-js-eval-body` | critical | risky-calls | `risky-code` | OK |
| `crit-inj-js-eval-spaced` | critical | risky-calls | `risky-code` | OK |
| `crit-inj-js-exec-concat` | critical | risky-calls | `cp-js` | OK |
| `crit-inj-js-execsync-template` | critical | risky-calls | `cp-js` | OK |
| `crit-inj-php-eval` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `crit-inj-py-eval-request` | critical | risky-calls | `risky-code` | OK |
| `crit-inj-py-os-system` | critical | risky-calls | `risky-code` | OK |
| `crit-inj-rb-eval` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `crit-py-md5-password` | critical | risky-calls | `risky-code` | OK |
| `crit-py-ssl-unverified` | critical | risky-calls | `cp-python` | OK |
| `crit-py-verify-false` | critical | risky-calls | `risky-code` | OK |
| `crit-tls-agent-off` | critical | risky-calls | `risky-code` | OK |
| `crit-tls-env-off` | critical | risky-calls | `risky-code` | OK |
| `cs-binaryformatter` | critical | risky-calls | `cp-dotnet-php-ruby/cs-binary-formatter` | OK |
| `cs-cert-callback` | medium | risky-calls | `cp-dotnet-php-ruby/cs-accept-any-certificate` | OK |
| `cs-md5` | medium | risky-calls | `cp-dotnet-php-ruby/cs-weak-hash` | OK |
| `cs-process-start` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `cs-sql-concat` | critical | risky-calls | `cp-dotnet-php-ruby/cs-sql-concat` | OK |
| `easy-ip-in-js` | easy | risky-calls | `hardcoded-ip` | OK |
| `easy-ip-in-python` | easy | risky-calls | `hardcoded-ip` | OK |
| `easy-ip-in-yaml` | easy | risky-calls | `hardcoded-ip` | OK |
| `go-exec-shell` | critical | risky-calls | `cp-go/go-shell-dash-c` | OK |
| `go-insecure-tls` | medium | risky-calls | `risky-code` | OK |
| `go-listen-no-timeouts` | easy | risky-calls | `cp-go/go-default-listen-no-timeouts` | OK |
| `go-md5` | medium | risky-calls | `cp-go/go-md4-md5-sha1` | OK |
| `go-sql-concat` | critical | risky-calls | `cp-go/go-sql-built-string` | OK |
| `hard-config-tls-verify-dict` | hard | risky-calls | `risky-code` | MISS |
| `hard-race-mktemp-helper` | hard | risky-calls | `cp-python/py-mktemp-race` | OK |
| `hard-race-session-no-timeout` | hard | risky-calls | `cp-python/py-requests-no-timeout` | MISS |
| `hard-taint-cp-helper` | hard | risky-calls | `cp-js` | OK |
| `hard-taint-eval-newfunction` | hard | risky-calls | `risky-code` | OK |
| `hard-taint-yaml-load` | hard | risky-calls | `risky-code` | OK |
| `java-deserialize` | critical | risky-calls | `cp-java/java-object-stream-read` | OK |
| `java-md5` | medium | risky-calls | `cp-java/java-weak-digest` | OK |
| `java-runtime-exec` | critical | risky-calls | `cp-java/java-runtime-exec-variable` | OK |
| `java-sql-concat` | critical | risky-calls | `cp-java/java-statement-concat` | OK |
| `java-util-random` | medium | risky-calls | `cp-java` | OK |
| `js-eval` | critical | risky-calls | `risky-code` | OK |
| `js-exec-concat` | critical | risky-calls | `cp-js` | OK |
| `js-hardcoded-ip` | easy | risky-calls | `hardcoded-ip` | OK |
| `js-innerhtml` | medium | risky-calls | `risky-code` | OK |
| `med-cs-accept-any-cert` | medium | risky-calls | `cp-dotnet-php-ruby/cs-accept-any-certificate` | OK |
| `med-cs-sql-concat-users` | medium | risky-calls | `cp-dotnet-php-ruby/cs-sql-concat` | OK |
| `med-go-insecure-skip-verify` | medium | risky-calls | `risky-code` | OK |
| `med-go-md5-checksum` | medium | risky-calls | `cp-go/go-md4-md5-sha1` | OK |
| `med-go-shell-dash-c` | medium | risky-calls | `cp-go/go-shell-dash-c` | OK |
| `med-java-object-stream` | medium | risky-calls | `cp-java/java-object-stream-read` | OK |
| `med-java-runtime-exec-dir` | medium | risky-calls | `cp-java/java-runtime-exec-variable` | OK |
| `med-java-weak-digest-md5` | medium | risky-calls | `cp-java/java-weak-digest` | OK |
| `med-php-include-page` | medium | risky-calls | `cp-dotnet-php-ruby/php-include-variable` | OK |
| `med-php-unserialize-cookie` | medium | risky-calls | `cp-dotnet-php-ruby/php-unserialize-variable` | OK |
| `med-py-shell-true-ping` | medium | risky-calls | `risky-code` | OK |
| `med-py-verify-false-session` | medium | risky-calls | `risky-code` | OK |
| `med-py-yaml-load-config` | medium | risky-calls | `risky-code` | OK |
| `med-rb-marshal-body` | medium | risky-calls | `cp-dotnet-php-ruby/rb-marshal-load` | OK |
| `med-rb-system-interp-dir` | medium | risky-calls | `cp-dotnet-php-ruby/rb-system-interpolation` | OK |
| `med-rust-unsafe-no-safety` | medium | risky-calls | `cp-rust/rs-unsafe-no-safety` | OK |
| `php-eval` | critical | risky-calls | `cp-dotnet-php-ruby/php-eval-assert` | OK |
| `php-include-var` | critical | risky-calls | `cp-dotnet-php-ruby/php-include-variable` | OK |
| `php-sql-concat` | critical | risky-calls | `cp-dotnet-php-ruby/php-sql-concat` | OK |
| `php-system` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `php-unserialize` | critical | risky-calls | `cp-dotnet-php-ruby/php-unserialize-variable` | OK |
| `py-md5` | medium | risky-calls | `risky-code` | OK |
| `py-mktemp` | medium | risky-calls | `cp-python/py-mktemp-race` | OK |
| `py-no-timeout` | easy | risky-calls | `cp-python/py-requests-no-timeout` | OK |
| `py-os-system` | critical | risky-calls | `risky-code` | OK |
| `py-random-token` | medium | risky-calls | `risky-code` | OK |
| `py-shell-true` | critical | risky-calls | `risky-code` | OK |
| `py-verify-false` | medium | risky-calls | `risky-code` | OK |
| `py-yaml-load` | critical | risky-calls | `risky-code` | OK |
| `rb-eval` | critical | risky-calls | `cp-dotnet-php-ruby/rb-eval-params` | OK |
| `rb-marshal-load` | critical | risky-calls | `cp-dotnet-php-ruby/rb-marshal-load` | OK |
| `rb-md5` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `rb-send-param` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `rb-system-interp` | critical | risky-calls | `cp-dotnet-php-ruby/rb-system-interpolation` | OK |
| `rb-yaml-load` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `rust-transmute` | easy | risky-calls | `cp-rust/rs-transmute` | OK |
| `rust-unsafe-no-safety` | medium | risky-calls | `cp-rust/rs-unsafe-no-safety` | OK |
| `rust-unwrap-lib` | easy | risky-calls | `cp-rust/rs-unwrap-in-library` | OK |
| `unicode-control` | hard | risky-calls | `unicode-control-chars` | OK |
| `v-cs-binaryformatter` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-cert-callback` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-hardcoded-password` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-md5-create` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-process-start-interp` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-process-start-var` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-processstartinfo` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-random-token` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-sha1-managed` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-cs-sql-concat-multiline` | hard | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-go-exec-bash-multiline` | hard | risky-calls | `cp-go` | OK |
| `v-go-exec-sh` | critical | risky-calls | `cp-go` | OK |
| `v-go-exec-var` | critical | risky-calls | `cp-go` | OK |
| `v-go-hardcoded-secret` | critical | risky-calls | `cp-go` | OK |
| `v-go-http-get-var` | medium | risky-calls | `cp-go` | OK |
| `v-go-listen` | easy | risky-calls | `cp-go` | OK |
| `v-go-math-rand-token` | medium | risky-calls | `cp-go` | OK |
| `v-go-md5` | medium | risky-calls | `cp-go` | OK |
| `v-go-sql-concat` | critical | risky-calls | `cp-go` | OK |
| `v-go-sql-multiline` | hard | risky-calls | `cp-go` | OK |
| `v-go-sql-sprintf` | critical | risky-calls | `cp-go` | OK |
| `v-go-sql-variable` | hard | risky-calls | `cp-go` | OK |
| `v-go-tls-skip` | medium | risky-calls | `risky-code` | OK |
| `v-go-tls-skip-multiline` | hard | risky-calls | `risky-code` | OK |
| `v-java-deserialize-multiline` | hard | risky-calls | `cp-java` | OK |
| `v-java-ecb` | medium | risky-calls | `cp-java` | OK |
| `v-java-exec-multiline` | hard | risky-calls | `cp-java` | OK |
| `v-java-exec-string-array` | critical | risky-calls | `cp-java` | OK |
| `v-java-hardcoded-password` | critical | risky-calls | `cp-java` | OK |
| `v-java-hostname-verifier` | medium | risky-calls | `cp-java` | OK |
| `v-java-md5-single-quote-arg` | medium | risky-calls | `cp-java` | OK |
| `v-java-processbuilder` | critical | risky-calls | `cp-java` | OK |
| `v-java-random-math` | medium | risky-calls | `cp-java` | OK |
| `v-java-random-token-field` | medium | risky-calls | `cp-java` | OK |
| `v-java-sql-concat-multiline` | hard | risky-calls | `cp-java` | OK |
| `v-java-trust-all` | medium | risky-calls | `cp-java` | OK |
| `v-java-xxe` | medium | risky-calls | `cp-java` | OK |
| `v-js-document-write` | medium | risky-calls | `risky-code` | OK |
| `v-js-eval-indirect` | critical | risky-calls | `risky-code` | OK |
| `v-js-eval-multiline` | hard | risky-calls | `risky-code` | OK |
| `v-js-eval-spaced` | critical | risky-calls | `risky-code` | OK |
| `v-js-exec-alias-destructure` | hard | risky-calls | `cp-js` | OK |
| `v-js-exec-alias-namespace` | hard | risky-calls | `cp-js` | OK |
| `v-js-exec-alias-promisify` | hard | risky-calls | `cp-js` | OK |
| `v-js-exec-alias-renamed` | hard | risky-calls | `cp-js` | OK |
| `v-js-exec-multiline` | hard | risky-calls | `cp-js` | OK |
| `v-js-exec-sync-template` | critical | risky-calls | `cp-js` | OK |
| `v-js-fs-readfile-request` | critical | risky-calls | `cp-js` | OK |
| `v-js-innerhtml-concat` | medium | risky-calls | `risky-code` | OK |
| `v-js-innerhtml-template` | medium | risky-calls | `risky-code` | OK |
| `v-js-insertadjacent` | medium | risky-calls | `risky-code` | OK |
| `v-js-new-buffer` | easy | risky-calls | `cp-js` | OK |
| `v-js-newfunction` | critical | risky-calls | `risky-code` | OK |
| `v-js-newfunction-spaced` | critical | risky-calls | `risky-code` | OK |
| `v-js-node-serialize` | critical | risky-calls | `cp-js` | OK |
| `v-js-outerhtml` | medium | risky-calls | `risky-code` | OK |
| `v-js-require-concat` | hard | risky-calls | `cp-js` | OK |
| `v-js-require-var` | hard | risky-calls | `cp-js` | OK |
| `v-js-settimeout-string` | medium | risky-calls | `cp-js` | OK |
| `v-js-sha1-multiline` | hard | risky-calls | `risky-code` | OK |
| `v-js-spawn-shell-multiline` | hard | risky-calls | `cp-js` | OK |
| `v-js-tls-off-agent` | medium | risky-calls | `risky-code` | OK |
| `v-js-tls-off-env` | medium | risky-calls | `risky-code` | OK |
| `v-js-tls-off-multiline` | hard | risky-calls | `risky-code` | OK |
| `v-js-vm-compile` | hard | risky-calls | `cp-js` | OK |
| `v-js-vm-runinnewcontext` | hard | risky-calls | `cp-js` | OK |
| `v-js-yaml-full` | critical | risky-calls | `cp-js` | OK |
| `v-php-backtick` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-curl-verify` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-eval` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-extract` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-file-from-request` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-include` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-rand-token` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-shell-exec` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-sql-concat` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-sql-interp` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-sql-multiline` | hard | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-system-concat` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-php-unserialize` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-py-bind-all` | easy | risky-calls | `cp-python` | OK |
| `v-py-eval-input` | critical | risky-calls | `risky-code` | OK |
| `v-py-exec-text` | critical | risky-calls | `cp-python` | OK |
| `v-py-flask-secret` | critical | risky-calls | `cp-python` | OK |
| `v-py-hardcoded-password` | critical | risky-calls | `cp-python` | OK |
| `v-py-md5-hexdigest` | medium | risky-calls | `risky-code` | OK |
| `v-py-mktemp` | medium | risky-calls | `cp-python` | OK |
| `v-py-os-popen` | critical | risky-calls | `cp-python` | OK |
| `v-py-os-system-alias` | critical | risky-calls | `risky-code` | OK |
| `v-py-os-system-from-import` | critical | risky-calls | `risky-code` | OK |
| `v-py-os-system-fstring` | critical | risky-calls | `risky-code` | OK |
| `v-py-random-fn` | medium | risky-calls | `risky-code` | OK |
| `v-py-random-otp` | medium | risky-calls | `risky-code` | OK |
| `v-py-random-token` | medium | risky-calls | `risky-code` | OK |
| `v-py-requests-no-timeout-multiline` | easy | risky-calls | `cp-python` | OK |
| `v-py-sha1-new` | medium | risky-calls | `risky-code` | OK |
| `v-py-shell-true-fstring` | critical | risky-calls | `risky-code` | OK |
| `v-py-shell-true-multiline` | hard | risky-calls | `risky-code` | OK |
| `v-py-ssl-unverified` | medium | risky-calls | `cp-python` | OK |
| `v-py-subprocess-alias-func` | hard | risky-calls | `risky-code` | OK |
| `v-py-subprocess-alias-module` | hard | risky-calls | `risky-code` | OK |
| `v-py-tmp-path` | medium | risky-calls | `cp-python` | OK |
| `v-py-verify-false` | medium | risky-calls | `risky-code` | OK |
| `v-py-verify-false-multiline` | hard | risky-calls | `risky-code` | OK |
| `v-py-yaml-load` | critical | risky-calls | `risky-code` | OK |
| `v-py-yaml-load-multiline` | hard | risky-calls | `risky-code` | OK |
| `v-rb-constantize` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-eval` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-exec-interp` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-html-safe` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-marshal` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-md5` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-open` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-open3` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-random-token` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-send` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-sha1` | medium | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-sql-interp` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-system-backtick` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-rb-yaml` | critical | risky-calls | `cp-dotnet-php-ruby` | OK |
| `v-ts-dangerously` | medium | risky-calls | `risky-code` | OK |
| `v-ts-eval-template` | critical | risky-calls | `risky-code` | OK |
| `v-ts-innerhtml-as-any` | medium | risky-calls | `risky-code` | OK |
| `v-ts-md5-hash` | medium | risky-calls | `risky-code` | OK |
| `xi-md-zero-width` | medium | risky-calls | `unicode-control-chars` | OK |
| `xi-py-rlo` | hard | risky-calls | `unicode-control-chars` | OK |
| `med-rust-blocking-sleep-async` | medium | rust | `rp-async/rasync-blocking-thread-sleep` | OK |
| `med-rust-todo-handler` | medium | rust | `rust-todo-macros` | OK |
| `med-rust-unimplemented-trait` | medium | rust | `rust-todo-macros` | OK |
| `rust-blocking-async` | medium | rust | `rp-async/rasync-blocking-thread-sleep` | OK |
| `rust-blocking-fs-async` | medium | rust | `rp-async/rasync-blocking-fs` | OK |
| `rust-todo-macro` | easy | rust | `rust-todo-macros` | OK |
| `rust-wildcard-dep` | easy | rust | `rp-cargo/rcargo-wildcard-version` | OK |
| `ai-env-fallback-key` | critical | secrets | `secrets-plus/stripe-live-secret-key` | OK |
| `client-mono-api-key-github` | critical | secrets | `secrets-plus/github-pat-classic` | OK |
| `client-mono-api-key-stripe` | critical | secrets | `secrets-plus/stripe-live-secret-key` | OK |
| `client-mono-mobile-key` | critical | secrets | `secrets-plus/gcp-api-key` | OK |
| `client-mono-next-env` | critical | secrets | `secrets-plus/stripe-live-secret-key` | OK |
| `client-mono-web-log-token` | medium | secrets | `pii-in-logs` | OK |
| `client-mono-web-ls` | medium | secrets | `local-storage-pii` | OK |
| `client-next-config-env-key` | critical | secrets | `secrets-plus/sendgrid-api-key` | OK |
| `client-next-dbpass-url` | critical | secrets | `credentials-in-urls` | OK |
| `client-next-env-aws` | critical | secrets | `secrets-plus/aws-access-key-id` | OK |
| `client-next-env-dburl` | critical | secrets | `secrets-plus/postgres-url-password` | OK |
| `client-next-env-sendgrid` | critical | secrets | `secrets-plus/sendgrid-api-key` | OK |
| `client-next-env-slack` | critical | secrets | `secrets-plus/slack-bot-token` | OK |
| `client-next-env-stripe` | critical | secrets | `secrets-plus/stripe-live-secret-key` | OK |
| `client-next-log-card` | medium | secrets | `pii-in-logs` | OK |
| `client-next-log-password` | medium | secrets | `pii-in-logs` | OK |
| `client-react-log-card` | medium | secrets | `pii-in-logs` | OK |
| `client-react-log-email` | medium | secrets | `pii-in-logs` | OK |
| `client-react-log-password` | medium | secrets | `pii-in-logs` | OK |
| `client-react-log-token-closure` | hard | secrets | `pii-in-logs` | OK |
| `client-react-ls-email` | medium | secrets | `local-storage-pii` | OK |
| `client-react-ls-password` | medium | secrets | `local-storage-pii` | OK |
| `client-react-ls-token` | medium | secrets | `local-storage-pii` | OK |
| `client-react-secret-google` | critical | secrets | `secrets-plus/gcp-api-key` | OK |
| `client-react-secret-sendgrid` | critical | secrets | `secrets-plus/sendgrid-api-key` | OK |
| `client-react-secret-stripe` | critical | secrets | `secrets-plus/stripe-live-secret-key` | OK |
| `client-react-ss-jwt` | medium | secrets | `local-storage-pii` | OK |
| `client-rn-key-aws` | critical | secrets | `secrets-plus/aws-access-key-id` | OK |
| `client-rn-key-google` | critical | secrets | `secrets-plus/gcp-api-key` | OK |
| `client-rn-key-sendgrid` | critical | secrets | `secrets-plus/sendgrid-api-key` | OK |
| `client-rn-key-slack` | critical | secrets | `secrets-plus/slack-bot-token` | OK |
| `client-rn-key-stripe` | critical | secrets | `secrets-plus/stripe-live-secret-key` | OK |
| `client-rn-key-telegram` | critical | secrets | `secrets-plus` | OK |
| `client-rn-log-token` | medium | secrets | `pii-in-logs` | OK |
| `client-site-font-cdn` | easy | secrets | `external-fonts-cdn` | OK |
| `client-site-key-inline` | critical | secrets | `secrets-plus/gcp-api-key` | OK |
| `client-site-tracker` | easy | secrets | `third-party-trackers` | OK |
| `client-site-url-creds` | critical | secrets | `credentials-in-urls` | OK |
| `crit-sec-aws-id` | critical | secrets | `secrets-plus/aws-access-key-id` | OK |
| `crit-sec-aws-secret` | critical | secrets | `secrets-plus/aws-secret-access-key` | OK |
| `crit-sec-discord` | critical | secrets | `secrets-plus/discord-webhook-url` | OK |
| `crit-sec-github-pat` | critical | secrets | `secrets-plus/github-pat-classic` | OK |
| `crit-sec-google` | critical | secrets | `secrets-plus/gcp-api-key` | OK |
| `crit-sec-jwt` | critical | secrets | `secrets-plus/jwt-literal` | OK |
| `crit-sec-npm` | critical | secrets | `secrets-plus/npm-access-token` | OK |
| `crit-sec-pg-url` | critical | secrets | `secrets-plus/postgres-url-password` | OK |
| `crit-sec-private-key` | critical | secrets | `secrets-plus` | OK |
| `crit-sec-sendgrid` | critical | secrets | `secrets-plus/sendgrid-api-key` | OK |
| `crit-sec-shopify` | critical | secrets | `secrets-plus/shopify-access-token` | OK |
| `crit-sec-slack` | critical | secrets | `secrets-plus/slack-bot-token` | OK |
| `crit-sec-stripe` | critical | secrets | `secrets-plus/stripe-live-secret-key` | OK |
| `crit-sec-telegram` | critical | secrets | `secrets-plus` | OK |
| `env-tracked` | critical | secrets | `sensitive-files` | OK |
| `npmrc-token` | critical | secrets | `secrets-plus/npmrc-auth-token` | OK |
| `sec-aws-id` | critical | secrets | `secrets-plus/aws-access-key-id` | OK |
| `sec-aws-secret` | critical | secrets | `secrets-plus/aws-secret-access-key` | OK |
| `sec-db-url` | critical | secrets | `secrets-plus/postgres-url-password` | OK |
| `sec-discord` | critical | secrets | `secrets-plus/discord-webhook-url` | OK |
| `sec-github-pat` | critical | secrets | `secrets-plus/github-pat-classic` | OK |
| `sec-google` | critical | secrets | `secrets-plus/gcp-api-key` | OK |
| `sec-jwt` | critical | secrets | `secrets-plus/jwt-literal` | OK |
| `sec-npm` | critical | secrets | `secrets-plus/npm-access-token` | OK |
| `sec-password-literal` | critical | secrets | `secrets-plus` | OK |
| `sec-private-key` | critical | secrets | `secrets-plus` | OK |
| `sec-py-secret` | critical | secrets | `secrets-plus/aws-session-key-id` | OK |
| `sec-script-token` | critical | secrets | `secrets-plus/github-app-server-token` | OK |
| `sec-sendgrid` | critical | secrets | `secrets-plus/sendgrid-api-key` | OK |
| `sec-shopify` | critical | secrets | `secrets-plus/shopify-access-token` | OK |
| `sec-slack` | critical | secrets | `secrets-plus/slack-bot-token` | OK |
| `sec-stripe` | critical | secrets | `secrets-plus/stripe-live-secret-key` | OK |
| `sec-telegram` | critical | secrets | `secrets-plus` | OK |
| `sec-twilio` | critical | secrets | `secrets-plus/twilio-api-key-sid` | OK |
| `v-sec-docker-env-token` | critical | secrets | `secrets-plus` | OK |
| `v-sec-go-aws` | critical | secrets | `secrets-plus` | OK |
| `v-sec-go-const` | critical | secrets | `secrets-plus` | OK |
| `v-sec-java-github` | critical | secrets | `secrets-plus` | OK |
| `v-sec-java-shopify` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-aws-object` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-aws-secret-object` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-discord` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-google-key` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-jwt-header` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-npm-concat` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-password-config` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-sendgrid-double` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-stripe-template` | critical | secrets | `secrets-plus` | OK |
| `v-sec-js-telegram` | critical | secrets | `secrets-plus` | OK |
| `v-sec-json-aws` | critical | secrets | `secrets-plus` | OK |
| `v-sec-php-sendgrid` | critical | secrets | `secrets-plus` | OK |
| `v-sec-props-aws` | critical | secrets | `secrets-plus` | OK |
| `v-sec-props-password` | critical | secrets | `secrets-plus` | OK |
| `v-sec-py-aws-dict` | critical | secrets | `secrets-plus` | OK |
| `v-sec-py-db-url` | critical | secrets | `secrets-plus` | OK |
| `v-sec-py-github-fstring` | critical | secrets | `secrets-plus` | OK |
| `v-sec-py-slack-webhook-token` | critical | secrets | `secrets-plus` | OK |
| `v-sec-py-twilio` | critical | secrets | `secrets-plus` | OK |
| `v-sec-rb-stripe` | critical | secrets | `secrets-plus` | OK |
| `v-sec-sh-curl-bearer` | critical | secrets | `secrets-plus` | OK |
| `v-sec-sh-export-github` | critical | secrets | `secrets-plus` | OK |
| `v-sec-yaml-slack` | critical | secrets | `secrets-plus` | OK |
| `xi-npmrc-token-line` | critical | secrets | `secrets-plus/npmrc-auth-token` | OK |
| `html-no-viewport` | easy | seo-and-meta | `meta-seo` | OK |
| `hard-race-sync-fs-helper` | hard | slow-code-patterns | `sync-fs-in-handlers` | MISS |
| `js-sync-fs-handler` | medium | slow-code-patterns | `sync-fs-in-handlers` | OK |
| `med-sync-exec-handler` | medium | slow-code-patterns | `sync-fs-in-handlers` | OK |
| `med-sync-fs-handler-read` | medium | slow-code-patterns | `sync-fs-in-handlers` | OK |
| `easy-req-unpinned` | easy | supply-chain | `dependency-pinning` | OK |
| `pkg-postinstall-curl` | medium | supply-chain | `install-scripts` | OK |
| `req-unpinned` | easy | supply-chain | `dependency-pinning` | OK |
| `xi-pkg-install-script-curl` | medium | supply-chain | `install-scripts` | OK |
| `xi-pkg-postinstall-node-e` | medium | supply-chain | `install-scripts` | OK |
| `xi-pkg-preinstall-wget` | medium | supply-chain | `install-scripts` | OK |
| `easy-describe-only` | easy | test-hygiene | `focused-tests` | OK |
| `easy-it-skip` | easy | test-hygiene | `skipped-tests` | OK |
| `easy-test-only` | easy | test-hygiene | `focused-tests` | OK |
| `easy-test-skip` | easy | test-hygiene | `skipped-tests` | OK |
| `js-focused-test` | easy | test-hygiene | `focused-tests` | OK |
| `js-skipped-test` | easy | test-hygiene | `skipped-tests` | OK |
| `client-mono-api-cookie` | medium | web-security | `cookie-flags` | OK |
| `client-mono-mobile-asyncstorage` | medium | web-security | `cf-mobile/rn-async-storage-secret` | OK |
| `client-mono-mobile-exported` | medium | web-security | `cf-mobile/rn-android-exported` | OK |
| `client-mono-next-public-use` | critical | web-security | `cf-next/next-public-secret-env` | OK |
| `client-mono-web-javascript-href` | medium | web-security | `cf-react/react-js-href` | OK |
| `client-next-action-noauth` | critical | web-security | `cf-next/next-action-no-auth` | OK |
| `client-next-action-path` | critical | web-security | `cf-next/next-action-path-traversal` | OK |
| `client-next-cookie-flags` | medium | web-security | `cookie-flags` | OK |
| `client-next-cors-origin` | medium | web-security | `cors-wildcard` | OK |
| `client-next-public-dbpass` | critical | web-security | `cf-next/next-public-secret-env` | OK |
| `client-next-public-secret-use` | critical | web-security | `cf-next/next-public-secret-env` | OK |
| `client-next-public-token-use` | critical | web-security | `cf-next/next-public-secret-env` | OK |
| `client-react-blank-docs` | easy | web-security | `target-blank-noopener` | OK |
| `client-react-blank-social` | easy | web-security | `target-blank-noopener` | OK |
| `client-react-hooks-conditional` | hard | web-security | `cf-react/react-hooks-conditional` | OK |
| `client-react-javascript-href` | medium | web-security | `cf-react/react-js-href` | OK |
| `client-react-javascript-href-var` | medium | web-security | `cf-react/react-js-href` | OK |
| `client-rn-asyncstorage-password` | medium | web-security | `cf-mobile/rn-async-storage-secret` | OK |
| `client-rn-asyncstorage-token` | medium | web-security | `cf-mobile/rn-async-storage-secret` | OK |
| `client-rn-exported-activity` | medium | web-security | `cf-mobile/rn-android-exported` | OK |
| `client-rn-exported-provider` | medium | web-security | `cf-mobile/rn-android-exported` | OK |
| `client-rn-exported-receiver` | medium | web-security | `cf-mobile/rn-android-exported` | OK |
| `client-rn-linking-open` | hard | web-security | `cf-mobile/rn-linking-open` | OK |
| `client-rn-webview-origin-any` | hard | web-security | `cf-mobile/rn-webview-origin-any` | OK |
| `client-site-blank` | easy | web-security | `target-blank-noopener` | OK |
| `client-site-form-http` | medium | web-security | `wh-html/form-action-over-http` | OK |
| `client-site-iframe-nosandbox` | medium | web-security | `wh-html/iframe-no-sandbox` | OK |
| `client-site-jshref` | medium | web-security | `inline-event-handlers` | OK |
| `client-site-no-sri` | easy | web-security | `sri-missing` | OK |
| `client-site-onclick` | easy | web-security | `inline-event-handlers` | OK |
| `client-site-script-http` | medium | web-security | `mixed-content` | OK |
| `crit-cookie-no-flags` | critical | web-security | `cookie-flags` | OK |
| `easy-html-blank-no-rel` | easy | web-security | `target-blank-noopener` | OK |
| `easy-html-inline-onclick` | easy | web-security | `inline-event-handlers` | OK |
| `easy-html-sri-missing` | easy | web-security | `sri-missing` | OK |
| `hard-authz-cookie-helper` | hard | web-security | `cookie-flags` | OK |
| `hard-config-cookie-shared-opts` | hard | web-security | `cookie-flags` | OK |
| `hard-config-cors-credentials-split` | hard | web-security | `cors-wildcard` | OK |
| `hard-config-cors-origin-helper` | hard | web-security | `cors-wildcard` | OK |
| `hard-config-flask-debug-opts` | hard | web-security | `debug-enabled` | OK |
| `headers-hsts` | easy | web-security | `wh-headers/hsts-missing` | OK |
| `headers-nosniff` | easy | web-security | `wh-headers/xcto-missing` | OK |
| `headers-referrer` | easy | web-security | `wh-headers/referrer-policy-missing` | OK |
| `headers-xfo` | easy | web-security | `wh-headers/xfo-missing` | OK |
| `html-blank-no-rel` | easy | web-security | `target-blank-noopener` | OK |
| `html-http-css` | easy | web-security | `wh-html/stylesheet-over-http` | OK |
| `html-http-link-mixed` | easy | web-security | `mixed-content` | OK |
| `html-inline-handler` | easy | web-security | `inline-event-handlers` | OK |
| `html-sri-missing` | medium | web-security | `sri-missing` | OK |
| `js-cookie-flags` | medium | web-security | `cookie-flags` | OK |
| `js-cors-wildcard` | hard | web-security | `cors-wildcard` | OK |
| `lock-http-resolved` | medium | web-security | `wh-supply/lockfile-resolved-over-http` | OK |
| `med-cookie-flask-set` | medium | web-security | `cookie-flags` | OK |
| `med-cookie-httponly-only` | medium | web-security | `cookie-flags` | OK |
| `med-cookie-max-age-only` | medium | web-security | `cookie-flags` | OK |
| `med-cors-header-star` | medium | web-security | `cors-wildcard` | OK |
| `med-cors-origin-true` | medium | web-security | `cors-wildcard` | OK |
| `med-cors-python-star` | medium | web-security | `cors-wildcard` | OK |
| `med-cors-reflect-origin` | medium | web-security | `cors-wildcard` | OK |
| `med-debug-django-settings` | medium | web-security | `debug-enabled` | OK |
| `med-debug-flask-run` | medium | web-security | `debug-enabled` | OK |
| `med-nginx-old-tls` | medium | web-security | `wh-headers/tls-protocol-legacy` | OK |
| `nginx-cors-star` | medium | web-security | `wh-headers` | OK |
| `nginx-csp-unsafe-inline` | medium | web-security | `wh-headers/csp-unsafe-inline-script` | OK |
| `nginx-old-tls` | medium | web-security | `wh-headers/tls-protocol-legacy` | OK |
| `npmrc-strict-ssl` | medium | web-security | `wh-supply` | OK |
| `pkg-git-http` | medium | web-security | `wh-supply` | OK |
| `pkg-http-tarball` | medium | web-security | `wh-supply` | OK |
| `publish-env` | critical | web-security | `wh-publish-root/env-file-present` | OK |
| `publish-git` | critical | web-security | `wh-publish-root/git-dir-in-publish` | OK |
| `publish-sql` | critical | web-security | `wh-publish-root/database-dump-in-public` | OK |
| `py-flask-debug` | critical | web-security | `debug-enabled` | OK |
| `v-js-cookie-no-flags` | medium | web-security | `cookie-flags` | OK |
| `v-js-cors-reflect` | hard | web-security | `cors-wildcard` | OK |
| `v-js-cors-star-header` | medium | web-security | `cors-wildcard` | OK |
| `v-py-flask-debug` | critical | web-security | `debug-enabled` | OK |
| `xi-lock-http-v3` | medium | web-security | `wh-supply/lockfile-resolved-over-http` | OK |
| `xi-lock-http-yarn` | medium | web-security | `wh-supply/lockfile-resolved-over-http` | OK |
| `xi-lock-no-integrity` | medium | web-security | `wh-supply/lockfile-entry-no-integrity` | OK |
| `xi-npmrc-registry-http` | medium | web-security | `wh-supply/npmrc-registry-over-http` | OK |
| `xi-npmrc-strict-ssl-spaced` | medium | web-security | `wh-supply` | OK |
| `xi-pkg-git-ssh` | medium | web-security | `wh-supply/package-git-or-tarball-dependency` | OK |
| `xi-pkg-github-shorthand` | medium | web-security | `wh-supply/package-git-or-tarball-dependency` | OK |
| `xi-pkg-tarball-https` | medium | web-security | `wh-supply/package-git-or-tarball-dependency` | OK |
| `xi-pub-bak` | medium | web-security | `wh-publish-root/backup-file-present` | OK |
| `xi-pub-ds-store` | easy | web-security | `wh-publish-root/desktop-metadata-file` | OK |
| `xi-pub-env-local` | critical | web-security | `wh-publish-root/env-file-present` | OK |
| `xi-pub-htpasswd` | critical | web-security | `wh-publish-root/htpasswd-file` | OK |
| `xi-pub-netlify-root` | medium | web-security | `wh-publish-root/netlify-publish-is-repo-root` | OK |
| `xi-pub-phpinfo` | medium | web-security | `wh-publish-root/phpinfo-or-test-page` | OK |
| `xi-pub-private-key` | critical | web-security | `wh-publish-root/private-key-file` | OK |
| `xi-pub-sourcemap` | medium | web-security | `wh-publish-root/sourcemap-shipped` | OK |
| `xi-pub-sql-dump` | critical | web-security | `wh-publish-root/database-dump-in-public` | OK |
| `xi-pub-web-inf` | medium | web-security | `wh-publish-root/web-inf-folder` | OK |
| `xi-web-apache-csp-unsafe-eval` | medium | web-security | `wh-headers/csp-unsafe-eval` | OK |
| `xi-web-apache-indexes` | medium | web-security | `wh-headers/apache-indexes-option` | OK |
| `xi-web-apache-sslprotocol` | medium | web-security | `wh-headers/tls-protocol-legacy` | OK |
| `xi-web-autoindex` | medium | web-security | `wh-headers/nginx-autoindex-on` | OK |
| `xi-web-blank-multiline` | medium | web-security | `target-blank-noopener` | OK |
| `xi-web-blank-single-quote` | easy | web-security | `target-blank-noopener` | OK |
| `xi-web-caddy-csp` | medium | web-security | `wh-headers/csp-unsafe-inline-script` | OK |
| `xi-web-cookie-httponly-false` | medium | web-security | `wh-headers/session-cookie-no-httponly` | OK |
| `xi-web-cors-reflect` | hard | web-security | `wh-headers/cors-reflects-request-origin` | OK |
| `xi-web-css-http-single-quote` | easy | web-security | `wh-html/stylesheet-over-http` | OK |
| `xi-web-form-http` | medium | web-security | `wh-html/form-action-over-http` | OK |
| `xi-web-helmet-csp-false` | medium | web-security | `wh-headers` | OK |
| `xi-web-helmet-hsts-false` | medium | web-security | `wh-headers` | OK |
| `xi-web-iframe-no-sandbox-multi` | medium | web-security | `wh-html/iframe-no-sandbox` | OK |
| `xi-web-inline-handler-single` | easy | web-security | `inline-event-handlers` | OK |
| `xi-web-jsx-blank` | easy | web-security | `target-blank-noopener` | OK |
| `xi-web-nginx-cors-always` | medium | web-security | `wh-headers` | OK |
| `xi-web-nginx-csp-location` | medium | web-security | `wh-headers/csp-unsafe-inline-script` | OK |
| `xi-web-script-http` | medium | web-security | `mixed-content` | OK |
| `xi-web-server-tokens` | easy | web-security | `wh-headers/nginx-server-tokens-on` | OK |
| `xi-web-sri-missing-link` | medium | web-security | `sri-missing` | OK |
| `xi-web-sri-missing-script` | medium | web-security | `sri-missing` | OK |
| `xi-web-tls-sslv3` | medium | web-security | `wh-headers/tls-protocol-legacy` | OK |
| `xi-web-x-powered-by-enable` | easy | web-security | `wh-headers/express-x-powered-by-enabled` | OK |
