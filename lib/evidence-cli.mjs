// The command-line side of dismissal evidence (lib/evidence.mjs): what `dismiss --evidence` stores and what `dismissals` prints.
import { acceptedFile, allDismissals, dismissalDoc, readDismissals, saveAccepted } from './accepted.mjs'
import { buildEvidence, checkEvidence, LEGACY_LABEL, reverifyTests } from './evidence.mjs'
import { withFileLock } from './lockfile.mjs'

// { ok, evidence, line } for `dismiss`. No --evidence still dismisses (older callers, the MCP tool), but as an implicit UNVERIFIED note, said out loud.
export function evidenceForDismiss(spec, { projectPath, env }) {
  if (spec === undefined) {
    return { ok: true, evidence: { kind: 'note', text: '', implicit: true, at: new Date().toISOString() }, line: 'note (unverified, no evidence was given). Add --evidence line:<file>:<line> or --evidence test:<name> so Meerkat can check it, or --evidence note:<text> to record why.' }
  }
  try {
    const evidence = buildEvidence(spec, { projectPath, env })
    const line = evidence.kind === 'note' ? `UNVERIFIED note:${evidence.text} (free text is never checked)` : evidence.kind === 'line' ? `VERIFIED line:${evidence.file}:${evidence.line} (it goes STALE, and the finding returns, if that line changes)` : `VERIFIED test:${evidence.name} (it goes STALE, and the finding returns, if the test is removed or fails)`
    return { ok: true, evidence, line }
  } catch (e) {
    return { ok: false, text: `meerkat dismiss: ${String(e.message ?? e)}. Nothing was dismissed.` }
  }
}

const pre = (d, ev) => (d.expired ? 'EXPIRED' : ev.state === 'STALE' ? 'STALE  ' : 'ACTIVE ')
const evidenceCell = (ev) => `evidence: ${ev.state} ${ev.label}${ev.state === 'STALE' ? ` (${ev.detail})` : ''}`

// `meerkat dismissals [folder] [--show <id>] [--verify]`. Returns { ok, text, code? }.
export function dismissalsText(rest, { env, folder, flag }) {
  if (rest.includes('--verify')) {
    const mine = readDismissals(env, folder)
    const before = mine.filter((d) => d.evidence?.kind === 'test').length
    if (before) withFileLock(acceptedFile('dismissed', env, folder), () => saveAccepted('dismissed', env, folder, dismissalDoc(reverifyTests(readDismissals(env, folder), folder, { env }))))
    const lines = [`Re-ran ${before} test evidence(s) with the repo's own test command.`]
    for (const d of allDismissals(env, folder)) if (d.evidence?.kind === 'test') lines.push(`${d.id}  ${checkEvidence(d, folder).state}  test:${d.evidence.name}`)
    return { ok: true, text: lines.join('\n') }
  }
  const items = allDismissals(env, folder)
  const show = flag(rest, '--show')
  if (rest.includes('--show')) {
    if (!show || show.startsWith('--')) return { ok: false, code: 2, text: 'usage: meerkat dismissals --show <id>' }
    const hits = items.filter((d) => d.id === show || (show.length >= 4 && d.id.startsWith(show)))
    if (hits.length !== 1) return { ok: false, text: hits.length ? `"${show}" matches ${hits.length} dismissals: use more characters.` : `Nothing is dismissed under ${show} for ${folder} (meerkat dismissals lists them).` }
    const d = hits[0]
    const ev = checkEvidence(d, folder)
    const l = [`${d.id}  ${d.check}${d.rule ? `/${d.rule}` : ''}  ${d.file ?? ''}`, `  status:   ${d.expired ? 'EXPIRED' : ev.state === 'STALE' ? 'STALE (no longer suppresses the finding)' : 'ACTIVE (suppresses the finding)'}`, `  reason:   ${d.reason}`, `  set:      ${d.at.slice(0, 10)}   ${d.expires ? `expires ${d.expires}` : 'no expiry'}   [${d.source}]`, `  evidence: ${ev.state} ${ev.label}`, `  detail:   ${ev.detail}`]
    if (ev.state === 'UNVERIFIED') l.push('  UNVERIFIED: Meerkat cannot check this. Re-dismiss with --evidence line:<file>:<line> or --evidence test:<name> to make it checkable.')
    return { ok: true, text: l.join('\n') }
  }
  const row = (d) => {
    const ev = checkEvidence(d, folder)
    return `${pre(d, ev)}  ${d.id}  ${d.check}${d.rule ? `/${d.rule}` : ''}  ${d.file ?? ''}  "${d.reason}"  set ${d.at.slice(0, 10)}  ${d.expires ? (d.expired ? `expired on ${d.expires}` : `expires ${d.expires}`) : 'no expiry'}  [${d.source}]  ${evidenceCell(ev)}`
  }
  return { ok: true, text: items.length ? items.map(row).join('\n') : `No dismissals for ${folder}.` }
}

export { LEGACY_LABEL }
