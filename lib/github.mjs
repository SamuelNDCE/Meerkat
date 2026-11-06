// GitHub integration. Nothing here runs a check, and nothing needs the gh CLI: the only network call is a plain fetch with GITHUB_TOKEN.
import { appendFileSync } from 'node:fs'

// Escaping rules copied from GitHub's own toolkit, which implements the workflow-commands syntax:
//   https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts  (escapeData, escapeProperty)
//   https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands  (::error file=,line=,title=::message)
// The docs page itself does not list the codes; the toolkit source does. Data (the message) escapes % CR LF.
// Properties (file, title) also escape : and ,. % goes first so later codes are not escaped twice.
export const escapeData = (s) => String(s ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
export const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

export const levelOf = (sev) => (sev === 'critical' || sev === 'high' ? 'error' : sev === 'medium' ? 'warning' : 'notice')

// One annotation line. props is an object of plain values; empty ones are left out.
export function annotation(level, props, message) {
  const p = Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${escapeProperty(v)}`)
  return `::${level}${p.length ? ' ' + p.join(',') : ''}::${escapeData(message)}`
}

// Annotations for the rows of a `meerkat gate` result. Rows carry a check id and a detail, not a file and line.
export function gateAnnotations(out) {
  const lines = []
  for (const r of out?.rows ?? []) {
    if (r.kind === 'pass') continue
    const level = r.kind === 'notrun' ? 'warning' : 'error'
    const label = { fail: 'failed', crash: 'tool crashed', hang: 'hung', notrun: 'did not run' }[r.kind] ?? r.kind
    const first = r.detail ? `: ${String(r.detail).split('\n')[0].slice(0, 500)}` : ''
    lines.push(annotation(level, { title: `Meerkat ${r.id}` }, `${r.id} ${label}${first}`))
  }
  return lines
}

export function gateSummary(kind, out, desc) {
  const rows = out?.rows ?? []
  const n = (k) => rows.filter((r) => r.kind === k).length
  const failing = n('fail') + n('crash') + n('hang') > 0
  const md = [
    `## Meerkat ${kind}: ${failing ? 'failing' : 'passing'}`,
    '',
    `${desc}, ${(out?.files ?? []).length} file(s) changed. ${n('pass')} passed, ${n('fail')} failed, ${n('crash') + n('hang')} tool failure(s), ${n('notrun')} not run.`,
    '',
  ]
  for (const r of rows.filter((x) => x.kind !== 'pass')) {
    const d = r.detail ? `: ${String(r.detail).split('\n')[0].slice(0, 200).replace(/\|/g, '\\|')}` : ''
    md.push(`- **${r.kind}** \`${r.id}\`${d}`)
  }
  return md.join('\n') + '\n'
}

// Appends to the file GITHUB_STEP_SUMMARY names. Does nothing outside GitHub Actions.
export function appendStepSummary(markdown, env = process.env) {
  const f = env.GITHUB_STEP_SUMMARY
  if (!f) return false
  try {
    appendFileSync(f, markdown)
    return true
  } catch {
    return false
  }
}

// ---------- the pull request comment ----------

// A hidden marker: the comment that carries it is the one Meerkat updates, so a pull request never gets more than one.
export const COMMENT_MARKER = '<!-- meerkat-pr-comment -->'
const SEV = ['critical', 'high', 'medium', 'low', 'info']
const live = (doc) => (doc?.findings ?? []).filter((f) => f.status !== 'accepted')
const isBlocking = (f) => f.severity === 'critical' || f.severity === 'high'
const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

// A file:line link in the form the GitHub UI renders: /blob/<sha>/<path>#L<line>. Without a repo and sha it is plain code text.
export function fileLink(f, { repo = null, sha = null, server = 'https://github.com' } = {}) {
  const where = `${f.file}${f.line ? `:${f.line}` : ''}`
  if (!repo || !sha || !f.file) return `\`${where}\``
  const path = String(f.file).replace(/\\/g, '/').replace(/^\.?\//, '').split('/').map(encodeURIComponent).join('/')
  return `[${where}](${server}/${repo}/blob/${sha}/${path}${f.line ? `#L${f.line}` : ''})`
}

const row = (f, opts, n) => `- **${f.severity}** ${f.file ? fileLink(f, opts) : '(whole check)'}: ${oneLine(f.message ?? f.title, n)}${f.rule ? ` (${f.rule})` : ''}`

export function buildComment(doc, { runUrl = null, repo = null, sha = null, top = 5 } = {}) {
  const fs = live(doc)
  if (!fs.length) return `${COMMENT_MARKER}\nMeerkat found nothing new in this change.\n`
  const blocking = fs.filter(isBlocking)
  const by = {}
  for (const f of fs) by[f.severity] = (by[f.severity] ?? 0) + 1
  const counts = SEV.map((s) => `${by[s] ?? 0} ${s}`).join(', ')
  const rank = (f) => (SEV.includes(f.severity) ? SEV.indexOf(f.severity) : 99)
  const sorted = fs
    .map((f, i) => [f, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map((x) => x[0])
  const o = { repo, sha }
  const lines = [COMMENT_MARKER, `## Meerkat: ${blocking.length} blocking, ${fs.length} finding(s) in total`, '', `Top ${Math.min(top, sorted.length)} by severity:`, '']
  for (const f of sorted.slice(0, top)) lines.push(row(f, o, 300))
  const rest = sorted.slice(top, 50)
  if (rest.length) {
    lines.push('', `<details><summary>${fs.length - top} more</summary>`, '')
    for (const f of rest) lines.push(row(f, o, 200))
    if (fs.length > 50) lines.push(`- ${fs.length - 50} more not shown.`)
    lines.push('', '</details>')
  }
  lines.push('', `Counts: ${counts}`)
  if (runUrl) lines.push('', `Full run: ${runUrl}`)
  return lines.join('\n') + '\n'
}

// Given the comments already on a pull request, decide whether to update one or create one. Pure, so it is tested without a network.
export function upsertPlan(comments) {
  const mine = (comments ?? []).filter((c) => typeof c?.body === 'string' && c.body.includes(COMMENT_MARKER))
  return mine.length ? { action: 'update', id: mine[mine.length - 1].id } : { action: 'create' }
}

// Posts or updates the comment. Needs GITHUB_TOKEN with pull-requests: write; uses the REST API through fetch (no gh, no dependencies).
export async function postComment({ body, repo, pr, token, api = 'https://api.github.com', fetchImpl = globalThis.fetch }) {
  if (!token) return { ok: false, detail: 'no GITHUB_TOKEN, so nothing was posted' }
  if (!repo || !pr) return { ok: false, detail: 'no repository or pull request number, so nothing was posted' }
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
    'user-agent': 'meerkat',
  }
  const call = async (method, path, payload) => {
    const r = await fetchImpl(`${api}${path}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000) })
    if (!r.ok) throw new Error(`${method} ${path} answered ${r.status}`)
    return r.json()
  }
  try {
    const all = []
    for (let page = 1; page <= 10; page++) {
      const batch = await call('GET', `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`)
      all.push(...batch)
      if (batch.length < 100) break
    }
    const plan = upsertPlan(all)
    if (plan.action === 'update') await call('PATCH', `/repos/${repo}/issues/comments/${plan.id}`, { body })
    else await call('POST', `/repos/${repo}/issues/${pr}/comments`, { body })
    return { ok: true, detail: plan.action === 'update' ? 'updated the existing comment' : 'posted a new comment' }
  } catch (e) {
    return { ok: false, detail: String(e?.message ?? e) }
  }
}
