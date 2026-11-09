// Editor output for a run's findings (--format vscode | jetbrains), built from findings.json so the ids match `meerkat findings`.
// vscode: a JSON array of problems (file, line, column, severity, message, code, plus id and check). jetbrains: one line per finding,
// `path:line:col: severity: check: message [id]`, which a JetBrains console filter matches with EDITOR_LINE_REGEX.
export const EDITOR_FORMATS = ['vscode', 'jetbrains']
export const EDITOR_LINE_REGEX = '^(.+?):(\\d+):(\\d+): (error|warning|info): ([^:\\s]+): (.*)$'

const sevOf = (s) => (s === 'critical' || s === 'high' ? 'error' : s === 'medium' ? 'warning' : 'info')
const oneLine = (t) => String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()
const open = (doc) => (doc?.findings ?? []).filter((f) => f.status !== 'accepted' && f.status !== 'fixed')

export function vscodeProblems(doc) {
  return open(doc).map((f) => ({
    file: f.file || '(no file)',
    line: Number(f.line) > 0 ? Number(f.line) : 1,
    column: Number(f.column) > 0 ? Number(f.column) : 1,
    severity: sevOf(f.severity),
    message: oneLine(f.message ?? f.title),
    code: oneLine(f.rule || f.check),
    id: f.id,
    check: oneLine(f.check),
  }))
}

export function jetbrainsLines(doc) {
  return open(doc).map((f) => {
    const file = oneLine(f.file || '(no file)')
    const check = oneLine(f.check).replace(/[:\s]+/g, '-') || 'check'
    return `${file}:${Number(f.line) > 0 ? Number(f.line) : 1}:${Number(f.column) > 0 ? Number(f.column) : 1}: ${sevOf(f.severity)}: ${check}: ${oneLine(f.message ?? f.title)} [${f.id}]`
  })
}

// The text to print for a format: the JSON array for vscode, the lines for jetbrains.
export function editorOutput(doc, format) {
  if (format === 'vscode') return JSON.stringify(vscodeProblems(doc), null, 2)
  if (format === 'jetbrains') return jetbrainsLines(doc).join('\n')
  return ''
}
