// `meerkat bug`: a bug report you can paste into an issue. It only prints; nothing is sent anywhere.
// Everything taken from a log goes through redact() and cleanText. A log that looks like it holds a secret is left out.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import { latestRunDir } from './runlog.mjs'
import { MEERKAT_DIR } from './paths.mjs'
import { cleanText, safeLogPath } from './tui/safe.mjs'
import { redact } from '../thorough/redact.mjs'

const TAIL_LINES = 30
const MAX_LOGS = 3
export const ISSUE_LINE = 'Open an issue at https://github.com/SamuelNDCE/Meerkat/issues/new and paste this in.'

const meerkatVersion = () => {
  try {
    return JSON.parse(readFileSync(join(MEERKAT_DIR, 'package.json'), 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

// Redacted, cleaned text; '' when it cannot be cleaned safely.
const safe = (text) => cleanText(redact(String(text ?? '')).text)

function logTail(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return '(log could not be read)'
  }
  // The whole log (up to its last megabyte) is checked for secrets, then the tail is taken from the cleaned text: a secret above the
  // tail still stops the report, and one inside it is blanked.
  const whole = text.replace(/\r\n?/g, '\n').slice(-1_000_000)
  const r = redact(whole)
  if (r.long) return '(log left out: it has a very long line, so it cannot be checked for secrets)'
  if (r.hard > 0) return '(log left out: it looks like it contains a secret)'
  return cleanText(r.text.split('\n').slice(-TAIL_LINES - 1).join('\n').trimEnd())
}

export function buildBugReport({ env = process.env } = {}) {
  const out = ['# Meerkat bug report', '']
  out.push(`- Meerkat version: ${meerkatVersion()}`)
  out.push(`- Operating system: ${process.platform} ${release()}`)
  out.push(`- Node: ${process.version}`)
  out.push('')
  const dir = latestRunDir(env)
  let summary = null
  if (dir) {
    try {
      summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
    } catch {
      /* no readable summary */
    }
  }
  if (!summary) {
    out.push('No run has been saved yet, so there is no run to report. Run a check first (meerkat verify), then try again.', '')
  } else {
    out.push('## Newest run', '')
    out.push(`- command: \`meerkat ${safe((summary.argv ?? []).join(' '))}\``)
    out.push(`- result: ${safe(summary.summary)} (exit code ${Number(summary.exitCode)})`)
    out.push('')
    const bad = (summary.results ?? []).filter((r) => r && (r.status === 'FAIL' || r.status === 'NOT RUN'))
    out.push('## Failed and not run', '')
    if (!bad.length) out.push('Nothing failed and nothing was left out.', '')
    for (const r of bad) out.push(`- ${safe(r.id)}: ${r.status}${r.detail ? `: ${safe(r.detail)}` : ''}`)
    if (bad.length) out.push('')
    for (const r of bad.filter((x) => x.logFile).slice(0, MAX_LOGS)) {
      // The path comes from a file on disk, so it is opened only if it is a real file inside Meerkat's own log folder.
      const file = safeLogPath(r.logFile, { env })
      if (!file) {
        out.push(`## Log: ${safe(r.id)}`, '', '(log left out: it is not inside the log folder)', '')
        continue
      }
      out.push(`## Log: ${safe(r.id)} (last ${TAIL_LINES} lines)`, '', '```', logTail(file).replace(/```/g, "'''"), '```', '')
    }
  }
  out.push(ISSUE_LINE)
  return out.join('\n')
}
