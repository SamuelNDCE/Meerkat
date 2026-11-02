# Credits

Meerkat runs these tools as separate programs, when you have installed them. It does not bundle, copy or modify them, and it never installs them for you. Tool and project names are used only to identify them.

| Tool | Licence | Where | Author |
|---|---|---|---|
| gitleaks | MIT | github.com/gitleaks/gitleaks | gitleaks contributors |
| OSV-Scanner | Apache-2.0 | github.com/google/osv-scanner | Google |
| staticcheck | MIT | github.com/dominikh/go-tools | Dominik Honnef |
| govulncheck | BSD-3-Clause | github.com/golang/vuln | The Go Authors |
| Semgrep | LGPL-2.1 | github.com/semgrep/semgrep | Semgrep contributors |
| actionlint | MIT | github.com/rhysd/actionlint | rhysd |
| Clippy | Apache-2.0 and MIT | github.com/rust-lang/rust-clippy | The Rust Project |
| TypeScript tsc | Apache-2.0 | github.com/microsoft/TypeScript | Microsoft |
| OWASP NodeGoat | Apache-2.0 | github.com/OWASP/NodeGoat | OWASP |
| OpenSSF CVE Benchmark | MIT | github.com/ossf-cve-benchmark/ossf-cve-benchmark | OpenSSF |

## Semgrep rules

The Semgrep program is LGPL-2.1. The registry rules it downloads (for example `p/security-audit`) are a separate thing: they are under the Semgrep Rules License v1.0 (semgrep.dev/legal/rules-license), which allows internal business use only and does not allow distributing them or offering them as a service. So:

- Your own `semgrep` fetches those rules from semgrep.dev when you run the check. They are licensed for your own internal use.
- Meerkat does not bundle, copy or redistribute them, and its tests use a small rule file written for this repository.
- To use your own rules instead, set `MEERKAT_SEMGREP_CONFIG` to a rules file (or any `p/...` name).

## Advisory data

OSV-Scanner reports advisories from the OSV database, which collects them from sources with their own licences (for example CC-BY 4.0 and CC0). Meerkat does not store or redistribute that data; it only shows what the tool reports for your project.

## What leaves your computer

The detectors pack is opt-in (`--preset detectors`). Metrics are off for every tool Meerkat starts; Semgrep gets both `--metrics=off` and `SEMGREP_SEND_METRICS=off`.

| Tool | What is sent | Where | Offline option |
|---|---|---|---|
| OSV-Scanner | package names and versions from your lockfiles | the OSV API (osv.dev) | `MEERKAT_DETECTORS_OFFLINE=1` uses cached databases (`--offline-vulnerabilities`), or the check is NOT RUN. Fetch the cache once with `osv-scanner scan --download-offline-databases` |
| govulncheck | module paths and versions | the Go vulnerability database (vuln.go.dev) | none |
| Semgrep | nothing about your code; it downloads the rule set | semgrep.dev | `MEERKAT_DETECTORS_OFFLINE=1` needs `MEERKAT_SEMGREP_CONFIG` to be a local rules file, or the check is NOT RUN |
| gitleaks | nothing | none | not needed |
| staticcheck | nothing | none | not needed |
| Clippy | nothing | none | not needed |
| actionlint | nothing | none | not needed |
| tsc | nothing | none | not needed |

How this was checked: the OSV-Scanner flags `--offline-vulnerabilities` and `--download-offline-databases` come from `osv-scanner scan --help` (version 2.7.0). For gitleaks and actionlint, their README and usage documentation describe local scanning only and mention no telemetry or network use; Meerkat did not monitor their network traffic, so this rests on those documents. Go tools (staticcheck, govulncheck) may download Go modules through your own Go setup when a project's dependencies are missing.

## What runs

The detectors pack starts each tool as a program with metrics off. Which of them execute code from the project being scanned:

| Tool | Executes project code | Notes |
|---|---|---|
| OSV-Scanner, gitleaks, Semgrep, staticcheck, govulncheck, actionlint | no | they read files. A scanner binary is never taken from inside the scanned project: the PATH entries under the project are dropped, and `~/.meerkat-tools/bin` is checked first |
| Clippy | yes | `cargo clippy` runs the project's build scripts (build.rs) and procedural macros, like any cargo build. `RUSTC_WRAPPER`, `RUSTC_WORKSPACE_WRAPPER` and `CARGO_BUILD_RUSTC_WRAPPER` are set to empty strings so an environment variable cannot inject a program. A wrapper set in the project's own `.cargo/config.toml` still applies; Meerkat does not rewrite it |
| tsc | only if it has to use the project's TypeScript | Meerkat uses its own copy, then one on PATH. Only when neither exists does it run the project's own `node_modules/typescript` (the output header then says "runs the project's own TypeScript"), and it refuses when that file's real path lies outside the project (a symlink escape) |

The `full` preset already runs the project's own tests and scripts, so running its toolchain is consistent with that.
