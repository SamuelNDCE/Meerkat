// The problem classes used to confirm one finding with another check (lib/confirm.mjs). A rule id that matches nothing here has no class and
// is never merged with a finding from another tool: guessing that two rules mean the same thing would hide a real finding.
// Each entry: class name, how far apart (in lines) two findings of the class may be, and the rule-id pattern.
export const CLASSES = [
  { name: 'secret', lines: 2, rule: /(^|-)(secret|secrets|token|api-?key|apikey|password|passwd|credential|credentials|private-key|access-key|aws-access|stripe|slack|github-pat|jwt-secret)(-|$)/ },
  { name: 'injection', lines: 3, rule: /(sql-?(injection|concat)|command-?injection|child-process|code-injection|eval|exec-injection|os-command|shell-injection)/ },
  { name: 'xss', lines: 3, rule: /(xss|inner-?html|dangerously|html-injection|unsafe-html|document-write)/ },
  { name: 'path-traversal', lines: 3, rule: /(path-traversal|directory-traversal|zip-slip|readfile-user)/ },
  { name: 'weak-crypto', lines: 3, rule: /(weak-crypto|weak-hash|insecure-hash|(^|-)md5(-|$)|(^|-)sha1(-|$)|(^|-)ecb(-|$)|insecure-cipher)/ },
  { name: 'config', lines: 3, rule: /(cors|cookie-flags|csp-|content-security|tls-verify|reject-unauthorized|debug-true|permissive-)/ },
]

// Checks that are secret scanners by their nature, whatever their rule ids are called.
export const SECRET_CHECKS = new Set(['gitleaks-secrets', 'secret-scan'])

// Checks that run a mature external tool: when several checks report one problem, the evidence of these is kept.
export const SPECIFIC_CHECKS = new Set(['gitleaks-secrets', 'osv-scan', 'govulncheck-go', 'semgrep-security', 'clippy-correctness', 'staticcheck-go', 'actionlint-workflows', 'tsc-strict'])

// A dependency advisory is recognised by its identifier, in the rule id or the message.
export const ADVISORY_RE = /\b(GHSA(?:-[a-z0-9]{4}){3}|CVE-\d{4}-\d{4,}|RUSTSEC-\d{4}-\d{4}|GO-\d{4}-\d{4,}|PYSEC-\d{4}-\d+|OSV-\d{4}-\d+)\b/gi

export function classOf(f) {
  if (SECRET_CHECKS.has(f.check) || f.suite === 'secrets') return 'secret'
  const rule = String(f.rule ?? '').toLowerCase()
  if (!rule) return null
  for (const c of CLASSES) if (c.rule.test(rule)) return c.name
  return null
}

export const lineWindow = (cls) => CLASSES.find((c) => c.name === cls)?.lines ?? 0
