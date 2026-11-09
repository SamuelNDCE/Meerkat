// Compact MCP output (0.7.0). The tools whose result can be large (run, gate, brief, findings, map) answer in a small fixed shape unless the
// caller passes `full: true`:
//   line 1: "<tool>: ok|error. blocking N, pre-existing N, passed N, failed N"
//   then at most 10 one-line items ("check file:line message"), then the log path.
// Plus meerkat_first_failure: exactly one line, the first blocking finding in the changed files.
import { basename } from 'node:path'

export const COMPACT_TOOLS = ['meerkat_run', 'meerkat_gate', 'meerkat_brief', 'meerkat_findings', 'meerkat_map']
export const MAX_ITEMS = 10
const MAX_LINE = 160

export const FULL_PROP = { type: 'boolean', description: 'Return the full output. Default false: a count line, at most 10 one-line items and the log path.' }

// Adds the `full` argument to the inputSchema of every compact tool that does not already have it.
export function withFullProp(tool) {
  if (!COMPACT_TOOLS.includes(tool.name) || tool.inputSchema?.properties?.full) return tool
  return { ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, full: FULL_PROP } } }
}

const clip = (s, n = MAX_LINE) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 3)}...` : t
}
const place = (f) => (f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '(no file)')
const itemOf = (f) => clip(`${f.check ?? f.rule ?? f.id ?? 'finding'} ${place(f)} ${f.message ?? ''}`)

function counts(name, sc) {
  const list = Array.isArray(sc.findings) ? sc.findings : null
  const fromList = (st) => (list ? list.filter((f) => f.status === st).length : null)
  const failedN = sc.counts?.failed ?? (Array.isArray(sc.failedChecks) ? sc.failedChecks.length : Array.isArray(sc.failed) ? sc.failed.length : null)
  const passedN = sc.counts?.passed ?? sc.passed ?? null
  const blocking = sc.blocking ?? (name === 'meerkat_run' ? failedN : fromList('new'))
  const preExisting = sc.preExisting ?? fromList('known')
  const parts = []
  if (blocking != null) parts.push(`blocking ${blocking}`)
  if (preExisting != null) parts.push(`pre-existing ${preExisting}`)
  if (passedN != null) parts.push(`passed ${passedN}`)
  if (failedN != null) parts.push(`failed ${failedN}`)
  return parts
}

// Finds one-line items. The gate does not carry findings, so its blocking ones are read from the run it saved.
function itemsOf(name, sc, bodyLines, ctx) {
  if (Array.isArray(sc.findings) && sc.findings.length) return sc.findings.map(itemOf)
  if (name === 'meerkat_gate' && typeof sc.runFolder === 'string' && typeof ctx?.latestFindings === 'function') {
    try {
      const r = ctx.latestFindings({ run: basename(sc.runFolder) })
      const all = r?.ok ? (r.doc.findings ?? []).filter((f) => f.status === 'new') : []
      if (all.length) return all.map(itemOf)
    } catch {
      /* fall through to the failed checks */
    }
  }
  if (Array.isArray(sc.failed) && sc.failed.length) return sc.failed.map((f) => clip(`${f.id} ${f.reason ?? ''}`))
  if (Array.isArray(sc.failedChecks) && sc.failedChecks.length) return sc.failedChecks.map((c) => clip(`${c.id} (${c.count ?? 1})`))
  return bodyLines.map((l) => clip(l))
}

// The structured result stays small: scalars stay, arrays keep their first 10 entries with long strings clipped, small objects stay, big ones go.
// (full: true returns everything.)
const trimValue = (v) => (typeof v === 'string' ? clip(v, 120) : v)
function trimEntry(e) {
  if (e === null || typeof e !== 'object') return trimValue(e)
  const o = {}
  for (const [k, v] of Object.entries(e)) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = trimValue(v)
  return o
}
function smallStructured(sc, total, shown) {
  const out = {}
  for (const [k, v] of Object.entries(sc)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? clip(v, 200) : v
    else if (Array.isArray(v)) out[k] = v.slice(0, MAX_ITEMS).map(trimEntry)
    else if (typeof v === 'object' && JSON.stringify(v).length <= 400) out[k] = v
  }
  if (total > shown) out.moreItems = total - shown
  out.compact = true
  return out
}

// res is what a handler returned. Returns the compact version (with _raw so finishResult adds no second status line), or res unchanged.
export function compactResult(name, args, res, ctx) {
  if (!COMPACT_TOOLS.includes(name) || args?.full === true || !res || typeof res !== 'object') return res
  const sc = res.structuredContent && typeof res.structuredContent === 'object' ? res.structuredContent : {}
  const body = String(res.content?.[0]?.text ?? '')
  const isError = res.isError === true
  const c = counts(name, sc)
  const bodyLines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  // An error or a result without findings keeps its own lines: the reason is the whole point of it.
  const items = isError && !c.length ? bodyLines.map((l) => clip(l, 300)) : itemsOf(name, sc, bodyLines, ctx)
  const shown = items.slice(0, MAX_ITEMS)
  const cx = res._context
  const where = cx ? `. project ${cx.project ?? 'unknown'}, run ${cx.run ?? 'unknown'}` : ''
  const lines = [`${name}: ${isError ? 'error' : 'ok'}${where}. ${c.length ? c.join(', ') : `${bodyLines.length} lines`}`, ...shown]
  if (items.length > shown.length) lines.push(`... ${items.length - shown.length} more (full: true shows all)`)
  const log = sc.runFolder ?? sc.export?.file ?? null
  lines.push(log ? `log: ${log}` : 'full: true for the whole output')
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: smallStructured(sc, items.length, shown.length), isError, _context: cx, _raw: true }
}

const BASE_RE = /^[A-Za-z0-9][A-Za-z0-9._/@^~-]{0,199}$/
export const FIRST_FAILURE_TOOL = {
  name: 'meerkat_first_failure',
  description: 'Returns ONE line: the first blocking finding in the changed files as "file:line check: message", or PASS, or the NO-RESULT or INCOMPLETE line.\nRuns the gate (the project\'s own commands); folder and base are optional.',
  inputSchema: {
    type: 'object',
    properties: {
      folder: { type: 'string', description: 'The project folder. Defaults to the start-up folder.' },
      base: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/@^~-]{0,199}$', description: 'A git ref to compare with, for example "origin/main".' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'First failure, one line', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}

export function makeFirstFailureTool({ safe, fail, pickFolder, checkNoExtra }) {
  return {
    async meerkat_first_failure(args, ctx) {
      const bad = checkNoExtra(args, ['folder', 'base'])
      if (bad) return fail(bad)
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      if (args.base !== undefined && (typeof args.base !== 'string' || !BASE_RE.test(args.base))) return fail('base must be a git ref such as "origin/main"')
      const argv = ['top', '--line', '--app', f.folder]
      if (args.base !== undefined) argv.push('--base', args.base)
      const r = await ctx.runCli(argv, { timeoutMs: 6 * 60 * 1000 })
      if (r.timedOut) return { content: [{ type: 'text', text: 'NO-RESULT: the gate did not finish in time. next: run meerkat gate in the background' }], structuredContent: { line: 'NO-RESULT', exitCode: null }, _raw: true }
      const first = String(r.stdout || r.stderr || '').split('\n').map((l) => l.trim()).find(Boolean)
      const line = clip(safe(first ?? `NO-RESULT: meerkat exited with code ${r.code} and printed nothing. next: run meerkat verdict`), 300)
      return { content: [{ type: 'text', text: line }], structuredContent: { line, exitCode: r.code }, _raw: true }
    },
  }
}
