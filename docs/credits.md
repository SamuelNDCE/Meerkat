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
