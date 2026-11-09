// `meerkat verdict --explain <finding-id-or-prefix>`: one short block for one finding of the newest run of this project. It looks the finding up the way
// `meerkat dismiss` does (the same id or 4-character prefix lookup) and runs no check.
import { resolve } from 'node:path'

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

export function explainBlock(f) {
  const where = f.file ? `${flat(f.file)}${f.line ? `:${f.line}` : ''}` : '(no file)'
  const why = flat(f.explanation) || flat(f.detectedBy?.checkTitle) || flat(f.title) || '(the check gave no description)'
  const evidence = f.file && f.line ? `line:${flat(f.file)}:${f.line}` : 'note:<what you checked>'
  return [
    `finding ${flat(f.id)} [${flat(f.severity)}]`,
    `check:   ${flat(f.check)}${f.rule ? ` (rule ${flat(f.rule)})` : ''}`,
    `where:   ${where}`,
    `what:    ${flat(f.message)}`,
    `why:     ${why}`,
    `fix:     ${f.fix ? flat(f.fix) : '(this rule has no fix hint)'}`,
    `dismiss: meerkat dismiss ${flat(f.id)} --reason "<why this is not a problem>" --evidence ${evidence}`,
  ]
}

// Returns the exit code: 0 found, 1 no run or no such finding, 2 no id given.
export async function runExplain(id, { folder = null, env, cwd, out, err }) {
  if (!id || id.startsWith('-')) {
    err('NO-RESULT: --explain needs a finding id (or the first 4 or more characters of one). next: meerkat findings lists the ids')
    return 2
  }
  const { loadRunFindings } = await import('./findingscmd.mjs')
  const { findById } = await import('./extras-cli.mjs')
  const r = loadRunFindings(env, undefined, { folder: resolve(cwd, folder ?? '.') })
  if (!r.ok) {
    err(`NO-RESULT: ${r.text}`)
    return 1
  }
  const found = findById(r.doc, id)
  if (!found.ok) {
    err(`NO-RESULT: ${found.text}`)
    return 1
  }
  for (const l of explainBlock(found.f)) out(l)
  return 0
}
