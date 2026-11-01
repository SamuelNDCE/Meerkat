// The findings screen: the list of what a run detected, as menu items and as a whole screen (pure: data in, lines of text out, so it is
// tested and screenshotted without a terminal). lib/menu.mjs shows it with the same Up/Down/Enter picker as the other screens; Enter on a
// finding prints findingDetailText (lib/findingscmd.mjs) or renderFindingDetail below.
import { renderScreen } from './menuscreen.mjs'
import { SEVERITIES } from './findings.mjs'
import { stripControl } from './tui/safe.mjs'

const one = (x) => stripControl(String(x ?? ''))
const cut = (t, n) => (t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)

// One heading per severity that has findings, then one row per finding: "file:line  rule" with the message to the right.
export function findingsItems(doc) {
  const items = []
  for (const sev of SEVERITIES) {
    const list = doc.findings.filter((f) => f.severity === sev)
    if (!list.length) continue
    items.push({ kind: 'heading', label: `${sev} (${list.length})` })
    for (const f of list) {
      const where = f.file ? `${one(f.file)}${f.line ? `:${f.line}` : ''}` : `(${one(f.check)})`
      items.push({ kind: 'item', label: cut(where, 40), value: f.id, about: `${f.status === 'new' ? '[new] ' : ''}${one(f.rule ?? f.check)}: ${one(f.message)}` })
    }
  }
  return items
}

export function renderFindingsScreen(doc, { cursor = null, width = 100, rows = 30, color = false, level = false, env = process.env, isTTY = true, version = '' } = {}) {
  const items = findingsItems(doc)
  const first = cursor ?? Math.max(0, items.findIndex((i) => i.kind === 'item'))
  return renderScreen({ items, cursor: first, multi: false }, { screen: 'Findings', project: doc.run.project.path, version, question: `${doc.counts.total} findings (${doc.counts.new} new)`, hint: '  Up/Down or j/k move, Enter shows the finding, q goes back', width, rows, color, level, env, isTTY })
}

// The full detail of one finding as lines of text that fit `width` (long values are folded).
export function renderFindingDetail(f, { width = 100, color = false, level = false } = {}) {
  const w = Math.max(30, width - 2)
  const dim = (t) => (color ? `\x1b[90m${t}\x1b[0m` : t)
  const bold = (t) => (color ? `\x1b[1m${t}\x1b[0m` : t)
  const out = []
  const row = (label, value) => {
    const text = one(value)
    const room = w - 14
    const parts = []
    for (let i = 0; i < Math.max(1, text.length); i += room) parts.push(text.slice(i, i + room))
    parts.forEach((p, i) => out.push(`  ${dim(i === 0 ? label.padEnd(12) : ' '.repeat(12))}  ${p}`))
  }
  const by = f.detectedBy ?? {}
  const sevCode = { critical: '31', high: level ? '38;5;208' : '1;33', medium: '33', low: '97', info: '37' }[f.severity]
  out.push(`  ${color && sevCode ? `[1;${sevCode}m[${one(f.severity)}][0m ${bold(one(f.title))}` : bold(`[${one(f.severity)}] ${one(f.title)}`)}`)
  row('what', f.message)
  row('where', f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '(no file)')
  if (f.evidence) row('evidence', f.evidence)
  row('rule', f.rule ?? '(none)')
  row('check', `${by.check ?? f.check} (${by.pack ? `pack ${by.pack}, ` : ''}${by.origin ?? 'bundled'})`)
  if (by.script) row('script', by.script)
  if (by.tool) row('tool', `${by.tool.name}${by.tool.version ? ` ${by.tool.version}` : ''}`)
  row('confidence', f.confidence)
  if (f.aiVerdict) row('AI verdict', `${f.aiVerdict}${f.aiReason ? `: ${f.aiReason}` : ''}`)
  row('log', f.logFile ?? '(none)')
  row('fix', f.fix ?? '(no hint from the check)')
  row('first seen', `${f.firstSeen} (${f.status})`)
  return out
}
