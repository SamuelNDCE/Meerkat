// Draws the findings screen (the REAL renderFindingsScreen) with a sample run, to ANSI text for tools/screenshot.py. Nothing reads your files.
//   node tools/findings-shot.mjs > findings.ansi ; python tools/screenshot.py findings.ansi findings.png
//   add "detail" to draw the full detail of the first finding instead, "plain" for no colour and no art, "narrow" for 60 columns
import { renderFindingDetail, renderFindingsScreen } from '../lib/findingsscreen.mjs'

const args = process.argv.slice(2)
const color = !args.includes('plain')
const width = args.includes('narrow') ? 60 : 100
const by = (check, pack, extra = {}) => ({ check, checkTitle: check, pack, origin: 'bundled', script: `thorough/${check}.mjs`, tool: null, rule: null, command: null, ...extra })
const f = (id, severity, suite, check, rule, file, line, message, status = 'known', more = {}) => ({ id, severity, title: message, message, suite, check, rule, file, line, column: null, detectedBy: by(check, suite), fix: null, confidence: 'high', status, firstSeen: '2026-10-29T09:14:02.000Z', logFile: `C:/Users/SamuelNDCE/.meerkat/logs/runs/20261031-142305-fast/${check}.log`, occurrences: 1, lines: [line], ...more })
const findings = [
  f('85eac75481ba8daa', 'critical', 'secrets', 'secrets-plus', 'aws-access-key-id', 'src/config.js', 2, 'AWS access key ID (AKIA prefix, 20 characters)', 'new'),
  f('1f0c7a93be4d2e60', 'high', 'risky-calls', 'risky-code', 'eval-call', 'src/app.js', 2, 'eval() runs text as code', 'new', { evidence: '  eval(x)', fix: 'Parse the data (JSON.parse) or call a named function instead of eval.' }),
  f('c92b6d1e0a7f4358', 'high', 'web-security', 'web-hardening', 'cors-wildcard', 'server/cors.js', 14, 'CORS allows every origin together with credentials'),
  f('5e3a8b04d7c19f26', 'medium', 'code-quality', 'code-smells', 'empty-catch', 'src/util/load.js', 41, 'An empty catch block hides errors'),
  f('b04d9e7a2c5f1836', 'medium', 'code-quality', 'code-smells', 'empty-catch', 'src/util/save.js', 18, 'An empty catch block hides errors', 'new'),
  f('72ad0c5e91b3f684', 'low', 'refactor', 'file-length', 'long-file', 'src/render.js', 0, 'The file has 1204 lines (limit 800)'),
  f('0d6f4b8a3e92c715', 'info', 'repo-docs', 'readme-sections', 'no-security-policy', 'SECURITY.md', 0, 'No security policy found'),
]
const count = (k, v) => findings.filter((x) => x[k] === v).length
const doc = {
  meerkat: { version: '1.3.2' },
  run: { id: '20261031-142305-fast', project: { name: 'plume', path: 'C:/Users/SamuelNDCE/code/plume' } },
  counts: { total: findings.length, bySeverity: { critical: count('severity', 'critical'), high: count('severity', 'high'), medium: count('severity', 'medium'), low: count('severity', 'low'), info: count('severity', 'info') }, new: count('status', 'new') },
  findings,
}
const lines = args.includes('detail') ? renderFindingDetail(findings[1], { width, color }) : renderFindingsScreen(doc, { cursor: 3, width, rows: 30, color, level: color ? 'truecolor' : false, env: color ? {} : { NO_COLOR: '1' }, version: '1.3.2' }).map((l) => l.text)
process.stdout.write(`${lines.join('\n')}\n`)
