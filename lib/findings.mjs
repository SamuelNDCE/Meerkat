// The finding protocol and the pure helpers around it. No I/O except the optional `exists` callback of the fallback extraction.
// docs/findings.md explains it for check authors.
//
// A check script may print to STDOUT, one per line, exactly:
//   MEERKAT-FINDING <severity> <rule-id> <path>:<line> <message>
//   severity   critical | high | medium | low | info
//   rule-id    /^[a-z0-9][a-z0-9-]{0,60}$/, or `-` when there is no rule
//   path       relative to the project, `/` separators, no control characters, at most 300 characters, no `..` segment, not absolute
//   line       digits (0 = the whole file or no line)
//   message    one line; control characters are removed and it is cut to 300 characters
// The runner (lib/exec.mjs) takes these lines out of the output exactly like MEERKAT-SUB lines (also across chunk boundaries), so they
// never reach the shown last line or the saved output. A line that starts with MEERKAT-FINDING but is not valid is dropped. At most 5000
// findings are kept per check.
import { createHash } from 'node:crypto'

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
export const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
export const MAX_FINDINGS = 5000
export const MAX_MESSAGE = 300
export const MAX_PATH = 300
export const FINDING_PREFIX_RE = /^MEERKAT-FINDING/
export const RULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/
const LINE_RE = /^MEERKAT-FINDING (critical|high|medium|low|info) (-|[a-z0-9][a-z0-9-]{0,60}) (.+?):(\d+) (.*)$/
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g
const HAS_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/

export const isFindingLine = (line) => FINDING_PREFIX_RE.test(String(line ?? '').replace(/\r$/, ''))
export const cleanMessage = (text) => String(text ?? '').replace(/\t/g, ' ').replace(CONTROL_RE, '').trim().slice(0, MAX_MESSAGE)

// A project-relative path with forward slashes, or null when it is not safe to keep.
export function cleanPath(p) {
  const text = String(p ?? '').replace(/\\/g, '/')
  if (!text || text.length > MAX_PATH || HAS_CONTROL_RE.test(text) || text !== text.trim()) return null
  if (/^([a-zA-Z]:|\/)/.test(text) || text.split('/').includes('..')) return null
  return text.replace(/^\.\//, '')
}

export function parseFindingLine(line) {
  const text = String(line ?? '').replace(/\r$/, '')
  const m = LINE_RE.exec(text)
  if (!m) return null
  const file = cleanPath(m[3])
  const message = cleanMessage(m[5])
  if (!file || !message) return null
  return { severity: m[1], rule: m[2] === '-' ? null : m[2], file, line: Number(m[4]), message }
}

// The protocol line for one finding, or null when the arguments are not valid (a check helper uses this).
export function formatFindingLine(severity, ruleId, file, line, message) {
  const rule = ruleId == null || ruleId === '' ? '-' : String(ruleId)
  const path = cleanPath(file)
  const msg = cleanMessage(message)
  if (!SEVERITIES.includes(severity) || (rule !== '-' && !RULE_ID_RE.test(rule)) || !path || !msg) return null
  const n = Number.isInteger(line) && line >= 0 ? line : 0
  return `MEERKAT-FINDING ${severity} ${rule} ${path}:${n} ${msg}`
}

// A collector the runner feeds one raw line at a time, at most MAX_FINDINGS.
export function createFindingCollector(cap = MAX_FINDINGS) {
  const findings = []
  let dropped = 0
  return {
    findings,
    get dropped() {
      return dropped
    },
    add(line) {
      const p = parseFindingLine(line)
      if (!p || findings.length >= cap) {
        dropped++
        return false
      }
      findings.push(p)
      return true
    },
  }
}

// A list from a function check (it returns `findings`), cleaned the same way as lines from a script.
export function normaliseFindings(list, cap = MAX_FINDINGS) {
  const c = createFindingCollector(cap)
  if (!Array.isArray(list)) return c.findings
  for (const x of list) {
    const line = formatFindingLine(String(x?.severity ?? ''), x?.rule ?? x?.ruleId ?? null, x?.file, Number(x?.line), x?.message)
    if (line) c.add(line)
  }
  return c.findings
}

// ---- severity ----

export const GROUP_SEVERITY = { security: 'high', functionality: 'medium', ui: 'medium', performance: 'low', refactor: 'low' }
export const isSeverity = (s) => SEVERITIES.includes(s)

// The severity a finding gets when nothing says otherwise: the check's own `severity`, else its group's, and critical for the secrets suite.
export function defaultSeverity(check, suite = null) {
  if (isSeverity(check?.severity)) return check.severity
  if (suite === 'secrets') return 'critical'
  return GROUP_SEVERITY[check?.group] ?? 'medium'
}

export const meetsSeverity = (severity, min) => (SEVERITY_RANK[severity] ?? -1) >= (SEVERITY_RANK[min] ?? 99)

// ---- fingerprint ----

// The message with the numbers that move when code moves removed (`:12`, `:12:5`, `line 12`, `lines 3-9`), so an id survives a shifted line.
export const normaliseMessage = (message) =>
  String(message ?? '')
    .replace(/:\d+(?::\d+)?/g, '')
    .replace(/\blines? \d+(?:\s*(?:-|to|and)\s*\d+)?/gi, 'line')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// sha256 hex, 16 characters, of ruleId|check|path|normalised message. No line number goes in.
export const fingerprint = ({ rule, check, file, message }) => createHash('sha256').update([rule ?? '-', check ?? '', file ?? '', normaliseMessage(message)].join('|')).digest('hex').slice(0, 16)

// ---- fallback extraction ----

// A check that is a script of Meerkat's own (`node <Meerkat>/thorough/...`, or a function) prints its own findings lines; anything else
// is a tool (eslint, tsc, cargo, npm, ...). A tool's output is not guessed at: the first lines are kept raw.
export function toolOf(check) {
  const run = check?.run
  if (!run || typeof run !== 'object' || typeof run.cmd !== 'string') return null
  const cmd = run.cmd.replace(/\\/g, '/').split('/').pop().replace(/\.(exe|cmd|bat)$/i, '')
  const script = String(run.args?.[0] ?? '').replace(/\\/g, '/')
  if (cmd === 'node' && /\/(thorough|packs)\/[^ ]*\.mjs$/.test(script)) return null
  if (cmd === 'bash' || cmd === 'sh') return { name: cmd === 'sh' ? 'sh' : 'bash', version: check.tool?.version ?? null }
  return { name: typeof check.tool === 'string' ? check.tool : check.tool?.name ?? cmd, version: check.tool?.version ?? null }
}

const ANSI_RE = /\u001b\[[0-9;]*m/g
const PATH_LINE_RE = /^\s*(?:[-*>]\s+)?(.+?):(\d+)(?::(\d+))?(?:\s*[-:]\s*|\s+)(\S.*)$/
const PATH_ONLY_RE = /^\s*(?:[-*>]\s+)?([^\s:][^:]*?):\s+(\S.*)$/

// Parses `path:line message` and `path: message` lines from a failed check's saved output. `exists(relativeOrAbsolutePath)` returns the
// project-relative path when it is a real file, else null. Returns [{ file, line, message }] (line 0 when the line had none).
export function parseOutputLines(output, exists, cap = 500) {
  const out = []
  for (const raw of String(output ?? '').split(/\r?\n/)) {
    if (out.length >= cap) break
    const text = raw.replace(ANSI_RE, '')
    if (!text.trim() || text.length > 2000) continue
    let m = PATH_LINE_RE.exec(text)
    if (m) {
      const file = exists(m[1].trim())
      if (file) {
        out.push({ file, line: Number(m[2]), message: cleanMessage(m[4]) })
        continue
      }
    }
    m = PATH_ONLY_RE.exec(text)
    if (m) {
      const file = exists(m[1].trim())
      if (file) out.push({ file, line: 0, message: cleanMessage(m[2]) })
    }
  }
  return out.filter((x) => x.message)
}

// The rule id for a parsed message: the failing sub-check whose title the message starts with, else null.
// `scanRules` writes `MEERKAT-SUB FAIL <id> <n> found: <title>`, and its finding lines start with the same title.
export function ruleForMessage(message, failedSubs) {
  const msg = String(message ?? '')
  for (const s of failedSubs ?? []) {
    const reason = String(s.reason ?? '')
    const title = reason.replace(/^\d+ found:\s*/, '').trim()
    if ((title && msg.startsWith(title.slice(0, 80))) || (msg === s.id || msg.startsWith(`${s.id} `))) return { id: s.id, title: title || s.id }
  }
  return null
}

export const firstLines = (text, n = 25) => String(text ?? '').replace(ANSI_RE, '').split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, n).map((l) => l.slice(0, 300))
