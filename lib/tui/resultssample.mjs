// Sample data for the results screen: a 154-check run with failures, checks that could not run, skipped ones and findings of every
// severity. Used by the tests and by tools/results-shot.mjs (the screenshots); nothing here reads a real run.
import { buildResultsData } from './results.mjs'

const SUITES = ['secrets', 'risky-calls', 'web-security', 'code-quality', 'refactor', 'repo-files', 'accessibility', 'dependencies']
export function sampleData({ checks = 154, fail = 26, notRun = 12, skipped = 3 } = {}) {
  const results = []
  const timeline = []
  let t = 0
  for (let i = 0; i < checks; i++) {
    const id = `check-${String(i).padStart(3, '0')}`
    const status = i < fail ? 'FAIL' : i < fail + notRun ? 'NOT RUN' : 'PASS'
    const ms = status === 'NOT RUN' ? 15 : 120 + ((i * 37) % 700) + (i === 77 ? 2400 : 0)
    const start = Math.floor(i / 12) * 380 + (i % 12) * 9
    timeline.push({ t: start, event: 'start', id, lane: 'free' }, { t: start + ms, event: 'end', id, status, ms })
    t = Math.max(t, start + ms)
    results.push({ id, title: `Sample check number ${i}`, status, detail: status === 'FAIL' ? `src/file${i}.js:${10 + i} sample problem ${i}  [full output: x]` : status === 'NOT RUN' ? `missing on PATH: tool${i} (install it)` : 'ok', ms, suite: SUITES[i % SUITES.length], command: `node thorough/sample.mjs ${id}`, logFile: `C:/Users/sam/.meerkat/logs/runs/x/${id}.log`, exitCode: status === 'PASS' ? 0 : 1, startedAt: new Date(1_700_000_000_000 + start).toISOString() })
  }
  const sevs = ['critical', 'high', 'high', 'medium', 'medium', 'medium', 'low', 'low', 'info']
  const findings = Array.from({ length: 60 }, (_, i) => {
    const check = `check-${String(i % fail).padStart(3, '0')}`
    return { id: `f${String(i).padStart(15, '0')}`, severity: sevs[i % sevs.length], title: `Sample rule title ${i}`, message: `Sample finding message number ${i} that is long enough to be cut at narrow widths`, suite: SUITES[i % SUITES.length], check, rule: `rule-${i % 7}`, file: `src/modules/file${i}.js`, line: 3 + i, column: null, detectedBy: { check, checkTitle: `Sample check ${i}`, pack: 'sample', origin: 'bundled', script: 'thorough/sample.mjs', tool: null, rule: `rule-${i % 7}`, command: null }, fix: 'Change the code as the rule says.', confidence: 'high', occurrences: 1, lines: [], logFile: `C:/Users/sam/.meerkat/logs/runs/x/${check}.log`, status: i % 9 === 0 ? 'new' : 'known', firstSeen: '2026-10-29T09:14:02.000Z', evidence: '  el.innerHTML = value' }
  })
  const by = Object.fromEntries(['critical', 'high', 'medium', 'low', 'info'].map((s) => [s, findings.filter((f) => f.severity === s).length]))
  const summary = { startedAt: new Date(1_700_000_000_000).toISOString(), ms: t, preset: 'full', tier: 'thorough', version: '1.0.0', results, selection: { skipped: Array.from({ length: skipped }, (_, i) => `skipped-${i} (no files changed in its paths)`), covered: [], disabled: [] } }
  return buildResultsData({ summary, timeline, findingsDoc: { findings, counts: { total: findings.length, new: findings.filter((f) => f.status === 'new').length, bySeverity: by }, run: { project: { path: 'C:/Users/sam/code/plume' } } }, runDir: 'C:/Users/sam/.meerkat/logs/runs/20261031-142305-full' })
}
