// Why a run has no readable findings.json, said accurately. The old message was always "an older Meerkat, or the run did not finish", which
// hid the two cases that need different action: a file cut off in the middle (a crash or a full disk), and a file an older Meerkat wrote.
// lib/findingscmd.mjs still builds its own message at two places; the one-line change there is to use missingFindingsText(dir) from here.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCHEMA_VERSION } from './findingsdoc.mjs'

// { state: 'ok' | 'missing' | 'truncated' | 'older' | 'newer' | 'invalid' }
export function classifyFindings(dir) {
  const file = join(String(dir ?? ''), 'findings.json')
  if (!existsSync(file)) return { state: 'missing', file }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { state: 'invalid', file }
  }
  let doc
  try {
    doc = JSON.parse(text)
  } catch {
    return { state: 'truncated', file }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { state: 'invalid', file }
  if (typeof doc.schemaVersion === 'number' && doc.schemaVersion < SCHEMA_VERSION) return { state: 'older', file }
  if (typeof doc.schemaVersion === 'number' && doc.schemaVersion > SCHEMA_VERSION) return { state: 'newer', file }
  if (doc.schemaVersion !== SCHEMA_VERSION || !Array.isArray(doc.findings)) return { state: 'invalid', file }
  return { state: 'ok', file }
}

const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ')

// The sentence for a run folder whose findings could not be read.
export function missingFindingsText(dir) {
  const d = clean(dir)
  switch (classifyFindings(dir).state) {
    case 'truncated':
      return `The run ${d} has a findings file that is truncated (findings file is truncated, not a version mismatch): the run was stopped or the disk filled up while it was written. Run it again.`
    case 'older':
      return `The run ${d} has a findings.json in an older schema: older Meerkat wrote this run. Run it again with this version.`
    case 'newer':
      return `The run ${d} has a findings.json from a newer Meerkat than this one. Update Meerkat to read it.`
    case 'invalid':
      return `The run ${d} has a findings.json that is not in the findings format (it is valid JSON but has no findings list). Run it again.`
    default:
      return `The run ${d} has no findings.json: the run did not finish, or it has not written its findings yet.`
  }
}
