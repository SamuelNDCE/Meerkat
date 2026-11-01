// The results screen: what you see when a run in a terminal is over. Three tabs on one full screen, nothing hidden:
//   1 FINDINGS  what the run detected, worst first (critical red, high orange, medium yellow, low and info white), Enter for the detail
//   2 CHECKS    every check that ran or was skipped, with its status, suite, time and a bar scaled to the slowest one
//   3 TIMELINE  a gantt of every check on one time axis, with how many ran at once on top
// Pure: data and a view state in, lines of text out (colour only when asked for; every colour has a word beside it), and a key table
// (resultsStep) that returns the next state and an action for the caller to carry out (copy, show a log, run again). The terminal
// loop that draws these and reads keys is lib/tui/resultsapp.mjs. Nothing here reads the run folder except loadResultsData.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clipLine, fitCells, padCells, stripAnsi, textWidth } from './cells.mjs'
import { buildProfile, PALETTE, pixelHead } from './pixelhead.mjs'
import { to256 } from './color.mjs'
import { VERSION } from '../version.mjs'
import { updateNotice } from '../update.mjs'
import { stripControl } from './safe.mjs'
import { renderFindingDetail } from '../findingsscreen.mjs'
import { readFindings } from '../findingsdoc.mjs'

const ESC = '\x1b['
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']
export const SEV_FILTERS = ['all', ...SEVERITY_ORDER, 'new']
export const STATUS_FILTERS = ['all', 'problems', 'not run', 'passed']
export const TABS = ['findings', 'checks', 'timeline']
export const FOOTER = 'Tab sections  Up/Down  Enter details  c copy findings folder  l log  r run again  m menu  q done  ? help'
export const TAB_FOOTER = {
  findings: FOOTER,
  checks: 'Tab sections  Up/Down PgUp/PgDn scroll  s filter  Enter details  l log  r run again  m menu  q done  ? help',
  timeline: 'Tab sections  Up/Down PgUp/PgDn scroll the timeline  Enter details  r run again  m menu  q done  ? help',
}
export const TAB_HELP = 'Tab or Left/Right arrows switch tabs, 1 2 3 jump'
export const FIRST_HINT = 'Press Tab or the arrow keys to see Checks and Timeline'
// The small pixel head (top left) needs a real terminal with colour and room: at least 70 columns by 24 rows.
export const MINI_HEAD_WIDTH = 14
export const showMiniHead = ({ width, rows, color, env = {} }) => Boolean(color) && !env.NO_COLOR && !env.MEERKAT_PLAIN && env.MEERKAT_MASCOT !== '0' && width >= 70 && rows >= 24

// Colour codes. High is orange (256-colour 208) where the terminal has 256 colours, else bold yellow.
export function severityCode(sev, level = 'truecolor') {
  if (sev === 'critical') return '31'
  if (sev === 'high') return level ? '38;5;208' : '1;33'
  if (sev === 'medium') return '33'
  if (sev === 'low') return '97'
  return '37'
}
// What each severity asks of you; shown as a legend above the findings and after each severity heading.
export const SEV_MEANING = { critical: 'fix before shipping', high: 'fix soon', medium: 'should fix', low: 'worth knowing', info: 'worth knowing' }
const SEV_BG = { critical: '41', high: '48;5;208', medium: '43', low: '47', info: '47' }
export const STATUS_CODE = { PASS: '32', FAIL: '31', 'NOT RUN': '33', NA: '90' }
const STATUS_WORD = { PASS: 'PASS', FAIL: 'FAIL', 'NOT RUN': 'NOT RUN', NA: 'SKIPPED' }
const FILL = { PASS: '=', FAIL: 'X', 'NOT RUN': '?', NA: '.' }

const one = (x) => stripControl(String(x ?? ''))
const paint = (on, code, text) => (on && text !== '' ? `${ESC}${code}m${text}${ESC}0m` : text)
export const durText = (ms) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}`
}
const reasonOf = (detail) => one(String(detail ?? '').replace(/\s*\[full output: [^\]]+\]\s*$/, ''))

// ---------- the data ----------

// summary + timeline events + findings document -> everything the screen shows. Pure. `timeline` events have t = ms from the run start.
export function buildResultsData({ summary = {}, timeline = [], findingsDoc = null, runDir = null } = {}) {
  const t0 = Date.parse(summary.startedAt ?? '') || null
  const span = new Map()
  for (const e of timeline) {
    if (e.event === 'start') span.set(e.id, { start: e.t, end: e.t })
    else if (e.event === 'end') span.set(e.id, { start: span.get(e.id)?.start ?? Math.max(0, e.t - (e.ms ?? 0)), end: e.t })
  }
  const findings = (findingsDoc?.findings ?? []).map((f) => ({ ...f }))
  const byCheck = new Map()
  for (const f of findings) byCheck.set(f.check, [...(byCheck.get(f.check) ?? []), f.id])
  const checks = []
  const seen = new Set()
  for (const r of summary.results ?? []) {
    if (!r?.id || seen.has(r.id)) continue
    seen.add(r.id)
    let s = span.get(r.id)
    if (!s && t0 && r.startedAt && Number.isFinite(r.ms)) {
      const start = Math.max(0, Date.parse(r.startedAt) - t0)
      s = { start, end: start + r.ms }
    }
    checks.push({ id: String(r.id), title: one(r.title ?? ''), suite: one(r.suite ?? ''), status: ['PASS', 'FAIL', 'NOT RUN'].includes(r.status) ? r.status : 'NOT RUN', ms: Number.isFinite(r.ms) ? r.ms : null, start: s?.start ?? null, end: s?.end ?? null, command: one(r.command ?? ''), reason: reasonOf(r.detail), logFile: typeof r.logFile === 'string' ? r.logFile : null, exitCode: r.exitCode ?? null, origin: r.origin ?? 'bundled', findingIds: byCheck.get(r.id) ?? [] })
  }
  // Checks that did not run on purpose are listed too, so nothing the run decided is hidden.
  const sel = summary.selection ?? {}
  const note = (list, why) => {
    for (const raw of list ?? []) {
      const m = /^(\S+)(?: \((.*)\))?$/.exec(String(raw))
      const id = m?.[1] ?? String(raw)
      if (seen.has(id)) continue
      seen.add(id)
      checks.push({ id, title: '', suite: '', status: 'NA', ms: null, start: null, end: null, command: '', reason: one(m?.[2] ?? why), logFile: null, exitCode: null, origin: 'bundled', findingIds: [] })
    }
  }
  note(sel.skipped, 'skipped')
  note(sel.covered, 'covered by a wider check')
  note(sel.disabled, 'turned off in the config')
  const n = (s) => checks.filter((c) => c.status === s).length
  const ends = checks.map((c) => c.end).filter((x) => x !== null)
  const sev = findingsDoc?.counts?.bySeverity ?? Object.fromEntries(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length]))
  return {
    runDir,
    label: one(summary.preset ?? summary.tier ?? 'run'),
    project: one(findingsDoc?.run?.project?.path ?? ''),
    version: one(summary.version ?? ''),
    ms: Number.isFinite(summary.ms) ? summary.ms : Math.max(0, ...ends),
    checks,
    findings,
    counts: { pass: n('PASS'), fail: n('FAIL'), notRun: n('NOT RUN'), skipped: n('NA') },
    findingCounts: { total: findings.length, new: findings.filter((f) => f.status === 'new').length, bySeverity: sev },
  }
}

export function loadResultsData(runDir, read = readFileSync) {
  try {
    const summary = JSON.parse(read(join(runDir, 'summary.json'), 'utf8'))
    let timeline = []
    try {
      timeline = String(read(join(runDir, 'timeline.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
    } catch {
      /* no timeline: the times come from each result */
    }
    let doc = null
    try {
      doc = readFindings(runDir)
    } catch {
      /* no findings file */
    }
    return buildResultsData({ summary, timeline, findingsDoc: doc, runDir })
  } catch {
    return null
  }
}

// ---------- lists, filters ----------

export const sortedFindings = (data) => [...data.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
export function visibleFindings(data, state) {
  const f = state.sev
  return sortedFindings(data).filter((x) => (f === 'all' ? true : f === 'new' ? x.status === 'new' : x.severity === f))
}
const STATUS_RANK = { FAIL: 0, 'NOT RUN': 1, PASS: 2, NA: 3 }
export function visibleChecks(data, state) {
  const f = state.status
  const keep = (c) => (f === 'all' ? true : f === 'problems' ? c.status === 'FAIL' || c.status === 'NOT RUN' : f === 'not run' ? c.status === 'NOT RUN' : c.status === 'PASS')
  return data.checks.filter(keep).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.id.localeCompare(b.id))
}
// Rows of the gantt: by start time; checks with no time at the end.
export const timelineRows = (data) => [...data.checks].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.id.localeCompare(b.id))

// ---------- the time axis ----------

const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000]
// The distance between tick labels: the smallest round step that keeps the labels from crowding `cols` cells. A run under a second gets 0.1 s ticks.
export function tickStep(totalMs, cols) {
  const maxTicks = Math.max(2, Math.floor(cols / 9))
  return NICE.find((s) => totalMs / s <= maxTicks) ?? NICE[NICE.length - 1]
}
export const tickLabel = (ms, step) => (step < 1000 ? `${(ms / 1000).toFixed(1)}s` : ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000}m` : `${ms / 1000}s`)
export function axisLines(totalMs, cols) {
  const step = tickStep(totalMs, cols)
  const labels = Array(cols).fill(' ')
  const rule = Array(cols).fill('─')
  let lastEnd = -2
  for (let ms = 0; ms <= totalMs + 1; ms += step) {
    const col = Math.min(cols - 1, Math.round((ms / totalMs) * (cols - 1)))
    rule[col] = '┼'
    const text = tickLabel(ms, step)
    const at = Math.min(col, cols - text.length)
    if (at > lastEnd) {
      for (let i = 0; i < text.length; i++) labels[at + i] = text[i]
      lastEnd = at + text.length
    }
  }
  return { labels: labels.join(''), rule: rule.join(''), step }
}
const BLOCKS = '▁▂▃▄▅▆▇█'
// How many checks ran at once in each column of the axis, as a sparkline and the peak.
export function concurrency(checks, totalMs, cols) {
  const per = Array(cols).fill(0)
  for (const c of checks) {
    if (c.start === null) continue
    const a = Math.min(cols - 1, Math.floor((c.start / totalMs) * cols))
    const b = Math.min(cols - 1, Math.max(a, Math.ceil(((c.end ?? c.start) / totalMs) * cols) - 1))
    for (let i = a; i <= b; i++) per[i]++
  }
  const peak = Math.max(0, ...per)
  return { per, peak, spark: per.map((n) => (n === 0 ? ' ' : BLOCKS[Math.min(7, Math.ceil((n / peak) * 8) - 1)])).join('') }
}
export function barCells(c, totalMs, cols) {
  if (c.start === null) return null
  const a = Math.min(cols - 1, Math.round((c.start / totalMs) * cols))
  const b = Math.min(cols, Math.max(a + 1, Math.round(((c.end ?? c.start) / totalMs) * cols)))
  return [a, b]
}

// ---------- drawing ----------

export function windowStart(total, cursor, size) {
  if (total <= size) return 0
  return Math.min(Math.max(0, cursor - Math.floor(size / 2)), total - size)
}
const scrollLine = (start, shown, total, color, width) => {
  const bar = 12
  const a = total ? Math.round((start / total) * bar) : 0
  const b = total ? Math.max(a + 1, Math.round(((start + shown) / total) * bar)) : bar
  return paint(color, '90', `  rows ${total ? start + 1 : 0}-${start + shown} of ${total}  [${'█'.repeat(Math.max(0, b - a)).padStart(b, '░').padEnd(bar, '░')}]`)
}
// The selected row: inverse video, or a > marker where there is no colour.
const inverse = (line, width, color = true) => (color ? `${ESC}7m${padCells(stripAnsi(line), width)}${ESC}0m` : `>${stripAnsi(line).slice(1)}`)
const chip = (sev, n, { color, level }) => (color ? `${ESC}30;${sev === 'high' && !level ? '43' : SEV_BG[sev]}m ${sev.toUpperCase()} ${n} ${ESC}0m` : `[${sev} ${n}]`)

// A run with nothing wrong: every check passed (none failed, none could not run) and nothing was detected.
export const isClean = (data) => data.counts.fail === 0 && data.counts.notRun === 0 && data.findingCounts.total === 0 && data.counts.pass > 0

// The header: the MEERKAT name and version first, the tags (counts, severity chips) directly under it, the run folder last. A clean run
// says ALL CLEAR in green on the line under the name, with the happy meerkat and a few sparkles.
export function headerBlock(data, { width, rows, color, level, env = {} }) {
  const c = data.counts
  const fc = data.findingCounts
  const clean = isClean(data)
  const counts = `${paint(color, '32', `${c.pass} passed`)}   ${c.fail ? paint(color, '31', `${c.fail} failed`) : '0 failed'}   ${c.notRun ? paint(color, '33', `${c.notRun} not run`) : '0 not run'}${c.skipped ? `   ${paint(color, '90', `${c.skipped} skipped`)}` : ''}   ${paint(color, '90', `${durText(data.ms)} elapsed`)}`
  const chips = SEVERITY_ORDER.filter((s) => fc.bySeverity[s]).map((s) => chip(s, fc.bySeverity[s], { color, level })).join(' ')
  const findingsLine = `${chips || paint(color, '32', 'no findings')}${fc.total ? `   ${paint(color, '90', `${fc.total} findings (new: ${fc.new})`)}` : ''}`
  const upd = data.update ?? (env.MEERKAT_NO_UPDATE_NOTE ? null : updateNotice({ current: VERSION }))
  const title = `${paint(color, '1', 'MEERKAT')} ${paint(color, '90', 'v' + VERSION)}${upd ? '  ' + paint(color, '33', 'update available: v' + String(upd.latest).replace(/^v/, '') + ' (you have v' + VERSION + ')') : ''}  ${one(data.label)}${data.project ? `   ${paint(color, '90', data.project)}` : ''}`
  const allClear = `${paint(color, '1;32', 'ALL CLEAR')}  ${paint(color, '32', `${c.pass} of ${data.checks.length} checks passed, 0 failed, nothing detected`)}`
  // Name first, then the tags: the headline (clean) or the counts, then the severity chips or the counts.
  const tags = clean ? [allClear, `${counts}   ${paint(color, '32', 'no findings')}`] : [counts, findingsLine]
  if (!showMiniHead({ width, rows, color, env })) return [title, ...tags]
  const head = miniHead(clean ? 'joy' : c.fail || c.notRun ? 'wide' : 'happy', level || 'truecolor')
  const side = [title, ...tags, paint(color, '90', fitCells(data.runDir ?? '', width - MINI_HEAD_WIDTH - 4))]
  const sparkle = clean ? [paint(color, '1;33', ' *'), '  ', paint(color, '33', '+ '), '  ', paint(color, '1;33', ' *')] : []
  return head.map((h, i) => `${h}${sparkle[i] ?? '  '} ${side[i] ?? ''}`.replace(/\s+$/, ''))
}

// The pixel head at half size: the same sprite as lib/tui/pixelhead.mjs (28x20 pixels) taken two by two, so 14x10 pixels, 14x5 cells.
export function miniHead(expression, level = 'truecolor') {
  const g = buildProfile(expression)
  const pick = (x, y) => {
    const px = [g[y]?.[x], g[y]?.[x + 1], g[y + 1]?.[x], g[y + 1]?.[x + 1]].filter((p) => p && p !== '.')
    if (px.length < 2) return '.'
    for (const keep of ['W', 'K']) if (px.includes(keep)) return keep
    const count = {}
    for (const p of px) count[p] = (count[p] ?? 0) + 1
    return Object.keys(count).sort((p, q) => count[q] - count[p])[0]
  }
  const grid = []
  for (let y = 0; y < 20; y += 2) grid.push(Array.from({ length: MINI_HEAD_WIDTH }, (_, i) => pick(i * 2, y)).join(''))
  // At this size the shut eye of the joy face would be lost, so it is drawn again as a two-pixel cream arc on the dark eye patch.
  if (expression === 'joy') {
    const set = (x, y, c) => { grid[y] = grid[y].slice(0, x) + c + grid[y].slice(x + 1) }
    for (const [x, y] of [[5, 3], [8, 3]]) set(x, y, 'L')
    for (const [x, y] of [[6, 2], [7, 2], [6, 3], [7, 3]]) set(x, y, y === 2 ? 'L' : 'D')
    for (const [x, y] of [[5, 4], [8, 4]]) set(x, y, 'D')
  }
  const col = (rgb, bgnd) => (level === '256' ? `${ESC}${bgnd ? 48 : 38};5;${to256(rgb)}m` : `${ESC}${bgnd ? 48 : 38};2;${rgb.join(';')}m`)
  const rows = []
  for (let y = 0; y < grid.length; y += 2) {
    let out = ''
    for (let x = 0; x < MINI_HEAD_WIDTH; x++) {
      const t = grid[y][x]
      const u = grid[y + 1]?.[x] ?? '.'
      if (t === '.' && u === '.') out += ' '
      else if (u === '.') out += `${col(PALETTE[t])}▀${ESC}0m`
      else if (t === '.') out += `${col(PALETTE[u])}▄${ESC}0m`
      else out += `${col(PALETTE[t])}${col(PALETTE[u], true)}▀${ESC}0m`
    }
    rows.push(out)
  }
  return rows
}

export function tabBar(state, data, { color }) {
  const names = [['Findings', data.findingCounts.total], ['Checks', data.checks.length], ['Timeline', null]]
  const parts = names.map(([name, n], i) => {
    const text = n === null ? name : `${name} (${n})`
    if (TABS[i] === state.tab) return color ? paint(true, '1;7', ` ${text} `) : `[${text}]`
    return color ? paint(true, '90', ` ${text} `) : ` ${text} `
  })
  return `${paint(color, '1', '<')}  ${parts.join(' | ')}  ${paint(color, '1', '>')}`
}

const sevLegend = (color, level) => `  ${['critical', 'high', 'medium'].map((s) => `${paint(color, `1;${severityCode(s, level)}`, s)} = ${SEV_MEANING[s]}`).join('   ')}   ${paint(color, '1;97', 'low')}, ${paint(color, '37', 'info')} = ${SEV_MEANING.low}`

// The happy picture shown in place of an empty findings list after a clean run: the big meerkat and the all-clear in words.
function allClearBody(data, { room, color, level }) {
  const head = color && room >= 12 ? pixelHead('joy', { color: level || 'truecolor' }) : []
  const text = ['', '', paint(color, '1;32', 'All clear'), paint(color, '32', `${data.counts.pass} of ${data.checks.length} checks passed, 0 failed, 0 not run`), 'Nothing was detected in this run: no findings at any severity.', '', paint(color, '90', 'Safe to push. Tab shows every check and the timeline.')]
  if (!head.length) return text.slice(1)
  return head.map((h, i) => `  ${h}   ${text[i] ?? ''}`.replace(/\s+$/, ''))
}

function findingsBody(state, data, { width, room, color, level }) {
  const list = visibleFindings(data, state)
  const out = [`${paint(color, '1', `${list.length} findings (new: ${list.filter((f) => f.status === 'new').length})`)}   ${paint(color, '90', `filter: ${state.sev}  (f changes it)`)}`, sevLegend(color, level)]
  if (!list.length && !data.findings.length && isClean(data)) return allClearBody(data, { room, color, level })
  if (!list.length) return [...out, '', paint(color, '32', data.findings.length ? '  No findings match this filter.' : '  Nothing was detected in this run.')]
  // Display lines: a heading before each severity, then its rows. The cursor is an index into `list`.
  const display = []
  let last = null
  list.forEach((f, i) => {
    if (f.severity !== last) {
      last = f.severity
      display.push({ head: f.severity, n: list.filter((x) => x.severity === f.severity).length })
    }
    display.push({ f, i })
  })
  const fileW = Math.max(14, Math.min(28, Math.floor(width * 0.25)))
  const ruleW = Math.max(10, Math.min(18, Math.floor(width * 0.16)))
  out.push(paint(color, '90', `  ${padCells('SEVERITY', 8)} ${padCells('RULE', ruleW)} ${padCells('FILE:LINE', fileW)} ${padCells('NEW', 3)} WHY`))
  const size = Math.max(3, room - out.length - 1)
  const cur = display.findIndex((d) => d.i === state.cursor.findings)
  const start = windowStart(display.length, cur, size)
  const view = display.slice(start, start + size)
  for (const d of view) {
    if (d.head) {
      out.push(`${paint(color, `1;${severityCode(d.head, level)}`, `  ${d.head.toUpperCase()} (${d.n})`)}  ${paint(color, '90', SEV_MEANING[d.head])}`)
      continue
    }
    const f = d.f
    const where = f.file ? `${one(f.file)}${f.line ? `:${f.line}` : ''}` : '(whole check)'
    const msgRoom = width - 4 - 9 - ruleW - fileW - 5
    const cells = (paintOn) => `  ${paint(paintOn && color, severityCode(f.severity, level), padCells(f.severity.toUpperCase(), 8))} ${padCells(fitCells(one(f.rule ?? f.check), ruleW), ruleW)} ${padCells(fitCells(where, fileW), fileW)} ${padCells(f.status === 'new' ? 'new' : '', 3)} ${fitCells(one(f.message), Math.max(8, msgRoom))}`
    out.push(d.i === state.cursor.findings ? inverse(cells(false), width - 1, color) : cells(true))
  }
  out.push(scrollLine(Math.max(0, view.filter((d) => d.f).length ? list.indexOf(view.find((d) => d.f).f) : 0), view.filter((d) => d.f).length, list.length, color, width))
  return out
}

function checksBody(state, data, { width, room, color }) {
  const list = visibleChecks(data, state)
  const slowest = Math.max(1, ...data.checks.map((c) => c.ms ?? 0))
  const k = data.counts
  const out = [`${paint(color, '1', `${list.length} of ${data.checks.length} checks`)}   ${paint(color, '90', `status filter: ${state.status}  (s changes it)`)}   ${paint(color, '32', `${k.pass} PASS`)} ${paint(color, '31', `${k.fail} FAIL`)} ${paint(color, '33', `${k.notRun} NOT RUN`)}${k.skipped ? ` ${paint(color, '90', `${k.skipped} SKIPPED`)}` : ''}`]
  const idW = Math.max(14, Math.min(28, Math.floor(width * 0.24)))
  const suiteW = Math.max(8, Math.min(18, Math.floor(width * 0.15)))
  out.push(paint(color, '90', `  ${padCells('STATUS', 8)} ${padCells('CHECK', idW)} ${padCells('SUITE', suiteW)} ${padCells('TIME', 7)} ${padCells('BAR', 10)} REASON`))
  const size = Math.max(3, room - out.length - 1)
  const start = windowStart(list.length, state.cursor.checks, size)
  const view = list.slice(start, start + size)
  view.forEach((cx, j) => {
    const bar = cx.ms === null ? '' : '█'.repeat(Math.max(1, Math.round((cx.ms / slowest) * 10)))
    const reason = cx.status === 'PASS' ? '' : cx.reason
    const cells = (on) => `  ${paint(on && color, STATUS_CODE[cx.status], padCells(STATUS_WORD[cx.status], 8))} ${padCells(fitCells(cx.id, idW), idW)} ${padCells(fitCells(cx.suite, suiteW), suiteW)} ${padCells(durText(cx.ms), 7, { right: true })} ${paint(on && color, '36', padCells(bar, 10))} ${fitCells(reason, Math.max(6, width - idW - suiteW - 34))}`
    out.push(start + j === state.cursor.checks ? inverse(cells(false), width - 1, color) : cells(true))
  })
  if (!list.length) out.push('  No checks match this filter.')
  else out.push(scrollLine(start, view.length, list.length, color, width))
  return out
}

function timelineBody(state, data, { width, room, color }) {
  const rows = timelineRows(data)
  const total = Math.max(1, data.ms, ...data.checks.map((c) => c.end ?? 0))
  const labelW = Math.max(14, Math.min(26, Math.floor(width * 0.22)))
  const tail = 18
  const cols = Math.max(10, width - 2 - labelW - 1 - tail)
  const ax = axisLines(total, cols)
  const cc = concurrency(data.checks, total, cols)
  const out = [`${paint(color, '1', `${data.checks.filter((c) => c.start !== null).length} checks over ${durText(total)}`)}   ${paint(color, '90', 'each bar is when a check ran; PASS green, FAIL red, NOT RUN yellow')}`]
  out.push(`  ${paint(color, '90', padCells(`running (max ${cc.peak})`, labelW))} ${paint(color, '36', cc.spark)}`)
  out.push(`  ${padCells('', labelW)} ${paint(color, '90', ax.labels)}`)
  out.push(`  ${padCells('', labelW)} ${paint(color, '90', ax.rule)}`)
  const size = Math.max(3, room - out.length - 1)
  const start = windowStart(rows.length, state.cursor.timeline, size)
  const view = rows.slice(start, start + size)
  view.forEach((cx, j) => {
    const cells = barCells(cx, total, cols)
    const sel = start + j === state.cursor.timeline
    let bar
    if (!cells) bar = paint(color, '90', padCells(cx.status === 'NA' ? 'not scheduled' : 'no time recorded', cols))
    else bar = ' '.repeat(cells[0]) + (color ? paint(true, STATUS_CODE[cx.status], '█'.repeat(cells[1] - cells[0])) : FILL[cx.status].repeat(cells[1] - cells[0])) + ' '.repeat(cols - cells[1])
    out.push(`${sel ? paint(color, '1', '>') : ' '} ${sel ? paint(color, '1', padCells(fitCells(cx.id, labelW), labelW)) : padCells(fitCells(cx.id, labelW), labelW)} ${bar} ${padCells(durText(cx.ms), 6, { right: true })} ${paint(color, STATUS_CODE[cx.status], STATUS_WORD[cx.status])}`)
  })
  out.push(scrollLine(start, view.length, rows.length, color, width))
  return out
}

// A check's detail as lines.
export function checkDetailLines(c, data, { width = 100, color = false, level = false } = {}) {
  const w = Math.max(30, width - 4)
  const out = []
  const row = (label, value) => {
    const text = one(value)
    const room = w - 14
    for (let i = 0; i < Math.max(1, text.length); i += room) out.push(`  ${paint(color, '90', (i === 0 ? label : '').padEnd(12))}  ${text.slice(i, i + room)}`)
  }
  out.push(`  ${paint(color, `1;${STATUS_CODE[c.status]}`, `${STATUS_WORD[c.status]}  ${c.id}`)}`)
  row('what it checks', c.title || '(no description)')
  row('status', `${STATUS_WORD[c.status]}${c.exitCode !== null ? `  (exit code ${c.exitCode})` : ''}`)
  row('suite', c.suite || '(none)')
  row('time', c.ms === null ? 'did not run' : `${durText(c.ms)}${c.start !== null ? `   from ${durText(c.start)} to ${durText(c.end)} into the run` : ''}`)
  row('command', c.command || '(a function inside Meerkat, no command)')
  if (c.reason) row(c.status === 'PASS' ? 'result' : 'reason', c.reason)
  row('log', c.logFile ?? '(none)')
  const found = data.findings.filter((f) => f.check === c.id)
  row('findings', found.length ? `${found.length} produced` : 'none produced')
  for (const f of found.slice(0, 12)) out.push(`    ${paint(color, severityCode(f.severity, level), padCells(f.severity.toUpperCase(), 8))} ${one(f.file ?? '')}${f.line ? `:${f.line}` : ''}  ${fitCells(one(f.message), Math.max(10, w - 40))}`)
  if (found.length > 12) out.push(`    ... and ${found.length - 12} more (Findings tab)`)
  return out
}

export function selectedOf(state, data) {
  if (state.tab === 'findings') {
    const f = visibleFindings(data, state)[state.cursor.findings]
    return f ? { kind: 'finding', id: f.id, checkId: f.check } : null
  }
  const c = (state.tab === 'checks' ? visibleChecks(data, state) : timelineRows(data))[state.cursor[state.tab]]
  return c ? { kind: 'check', id: c.id, checkId: c.id } : null
}

const HELP = ['  Keys on this screen', '', '  Tab / Left / Right or 1 2 3   switch between Findings, Checks and Timeline', '  Up / Down, PgUp / PgDn        move; Enter opens the detail, Esc comes back', '  f   (Findings) cycle the severity filter: all, critical, high, medium, low, info, new', '  s   (Checks) cycle the status filter: all, problems, not run, passed', '  l   show the log of the selected row (a finding shows its check\'s log)', '  c   copy the findings folder path (in a detail: copy that check\'s log path)', '  y   copy the log path of the selected row', '  o   show the run report      d   show the repo changes', '  r   run again                m   back to the menu', '  q / Esc / Ctrl+C   done', '', '  Press any key to close this help.']

// The whole screen as lines (at most rows - 1, so the terminal never scrolls).
export function renderResults(state, data, { width = 100, rows = 30, color = true, level = 'truecolor', env = {} } = {}) {
  const head = headerBlock(data, { width, rows, color, level, env })
  const top = [...head, tabBar(state, data, { color }), paint(color, '90', TAB_HELP), state.hint ? paint(color, '1;33', FIRST_HINT) : '']
  const status = state.message ? paint(color, '33', state.message) : ''
  const footerText = state.view ? 'Up/Down PgUp/PgDn scroll  Esc back' : state.detail ? `Up/Down scroll  l log  c copy log path  Esc back` : (TAB_FOOTER[state.tab] ?? FOOTER)
  const room = Math.max(4, rows - 1 - top.length - 2)
  let body
  if (state.help) body = HELP
  else if (state.view) {
    const size = room - 2
    const at = Math.min(Math.max(0, state.view.scroll), Math.max(0, state.view.lines.length - size))
    body = [paint(color, '1', `  ${one(state.view.title)}`), ...state.view.lines.slice(at, at + size).map((l) => `  ${l}`), paint(color, '90', `  lines ${at + 1}-${Math.min(state.view.lines.length, at + size)} of ${state.view.lines.length}`)]
  } else if (state.detail) {
    const lines = state.detail.kind === 'finding' ? renderFindingDetail(data.findings.find((f) => f.id === state.detail.id) ?? {}, { width, color, level }) : checkDetailLines(data.checks.find((c) => c.id === state.detail.id) ?? {}, data, { width, color, level })
    const at = Math.min(Math.max(0, state.detail.scroll ?? 0), Math.max(0, lines.length - room))
    body = lines.slice(at, at + room)
  } else if (state.tab === 'findings') body = findingsBody(state, data, { width, room, color, level })
  else if (state.tab === 'checks') body = checksBody(state, data, { width, room, color })
  else body = timelineBody(state, data, { width, room, color })
  const lines = [...top, ...body.slice(0, room)]
  while (lines.length < rows - 3) lines.push('')
  lines.push(status, paint(color, '90', fitCells(footerText, width - 1)))
  return lines.slice(0, Math.max(1, rows - 1)).map((l) => clipLine(l, width - 1))
}

// ---------- keys ----------

export const initialResultsState = ({ message = '' } = {}) => ({ tab: 'findings', cursor: { findings: 0, checks: 0, timeline: 0 }, sev: 'all', status: 'all', detail: null, view: null, help: false, hint: true, message })

const cycle = (list, v) => list[(list.indexOf(v) + 1) % list.length]
const listLength = (state, data) => (state.tab === 'findings' ? visibleFindings(data, state).length : state.tab === 'checks' ? visibleChecks(data, state).length : data.checks.length)

// One key in, { state, action } out. `action` is for the caller to carry out: done, menu, again, copyFolder, copyLog {id}, log {id}, report, changes.
export function resultsStep(state, key, data, { rows = 30 } = {}) {
  const s = { ...state, cursor: { ...state.cursor }, message: '', hint: false }
  const page = Math.max(3, rows - 14)
  if (key === 'ctrl-c') return { state: s, action: { type: 'done' } }
  if (s.help) return { state: { ...s, help: false }, action: null }
  if (s.view) {
    const v = { ...s.view }
    if (key === 'up') v.scroll = Math.max(0, v.scroll - 1)
    else if (key === 'down') v.scroll++
    else if (key === 'pgup') v.scroll = Math.max(0, v.scroll - page)
    else if (key === 'pgdn' || key === 'space') v.scroll += page
    else if (['escape', 'q', 'enter', 'left'].includes(key)) return { state: { ...s, view: null }, action: null }
    return { state: { ...s, view: v }, action: null }
  }
  if (s.detail) {
    const d = { ...s.detail }
    const checkId = d.kind === 'finding' ? data.findings.find((f) => f.id === d.id)?.check : d.id
    if (key === 'up') d.scroll = Math.max(0, (d.scroll ?? 0) - 1)
    else if (key === 'down') d.scroll = (d.scroll ?? 0) + 1
    else if (['escape', 'q', 'left'].includes(key)) return { state: { ...s, detail: null }, action: null }
    else if (key === 'l' && checkId) return { state: s, action: { type: 'log', id: checkId } }
    else if ((key === 'c' || key === 'y') && checkId) return { state: s, action: { type: 'copyLog', id: checkId } }
    return { state: { ...s, detail: d }, action: null }
  }
  const count = listLength(s, data)
  const move = (to) => {
    s.cursor[s.tab] = Math.max(0, Math.min(Math.max(0, count - 1), to))
  }
  const here = s.cursor[s.tab]
  if (key === 'tab' || key === 'right') s.tab = cycle(TABS, s.tab)
  else if (key === 'shift-tab' || key === 'left') s.tab = TABS[(TABS.indexOf(s.tab) + TABS.length - 1) % TABS.length]
  else if (['1', '2', '3'].includes(key)) s.tab = TABS[Number(key) - 1]
  else if (key === 'up' || key === 'k') move(here - 1)
  else if (key === 'down' || key === 'j') move(here + 1)
  else if (key === 'pgup') move(here - page)
  else if (key === 'pgdn') move(here + page)
  else if (key === 'f' && s.tab === 'findings') {
    s.sev = cycle(SEV_FILTERS, s.sev)
    s.cursor.findings = 0
  } else if (key === 's' && s.tab === 'checks') {
    s.status = cycle(STATUS_FILTERS, s.status)
    s.cursor.checks = 0
  } else if (key === 'enter') {
    const sel = selectedOf(s, data)
    if (sel) s.detail = { kind: sel.kind, id: sel.id, scroll: 0 }
  } else if (key === 'c') return { state: s, action: { type: 'copyFolder' } }
  else if (key === 'l' || key === 'y') {
    const sel = selectedOf(s, data)
    if (sel) return { state: s, action: { type: key === 'l' ? 'log' : 'copyLog', id: sel.checkId } }
  } else if (key === 'o') return { state: s, action: { type: 'report' } }
  else if (key === 'd') return { state: s, action: { type: 'changes' } }
  else if (key === 'r') return { state: s, action: { type: 'again' } }
  else if (key === 'm') return { state: s, action: { type: 'menu' } }
  else if (key === 'q' || key === 'escape') return { state: s, action: { type: 'done' } }
  else if (key === '?') s.help = true
  s.cursor[s.tab] = Math.max(0, Math.min(Math.max(0, listLength(s, data) - 1), s.cursor[s.tab]))
  return { state: s, action: null }
}

// ---------- what stays in the scrollback ----------

// The lines a run leaves behind in a terminal: one summary and the findings folder. Everything else is on the results screen and in the saved files.
export function compactSummary({ label, results, ms, findings = null, dir = null }) {
  const done = results.filter(Boolean)
  const n = (s) => done.filter((r) => r.status === s).length
  const sev = findings?.bySeverity ?? {}
  const parts = SEVERITY_ORDER.filter((s) => sev[s]).map((s) => `${sev[s]} ${s}`)
  const lines = [`MEERKAT ${label}  ${done.length} checks: ${n('PASS')} passed, ${n('FAIL')} failed, ${n('NOT RUN')} not run in ${durText(ms)}${findings ? `   findings: ${parts.join(', ') || 'none'}${findings.new ? ` (${findings.new} new)` : ''}` : ''}`]
  if (dir) lines.push(`Findings folder created: ${dir}`)
  return lines
}

export { textWidth }
