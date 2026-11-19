// Reasons a batch gives when branches were not judged (exit 3) or when a limit stopped it early. Shared by the plain batch and `--split`.
import { nameList } from './batch.mjs'

// One line for exit 3: every branch that was not judged, with its reason. `rows` is [{ branch, reason }].
export function notJudgedLine(rows) {
  const list = rows.filter((r) => r && r.branch)
  if (!list.length) return 'exit 3: nothing was judged'
  return `exit 3: nothing was judged, ${list.length} branch(es) not judged: ${nameList(list.map((r) => `${r.branch} (${r.reason || 'no reason recorded'})`), 50)}`
}

// The reason a branch that failed to merge into the batch is excluded.
export function conflictReason(baseRef, detail) {
  return `CONFLICT with the base: merging it into ${baseRef ?? 'the base'} failed${detail ? ` (${detail})` : ''}`
}

// Why a batch stopped early, or null: { reason, branches } from the split rows that read NO-RESULT because of the gate run limit.
export function stoppedInfo(rows, maxRuns) {
  const branches = rows.filter((r) => r.verdict === 'NO-RESULT' && /run limit/.test(r.reason)).map((r) => r.branch)
  return branches.length ? { reason: `gate run limit reached (${maxRuns}, MEERKAT_BATCH_MAX_RUNS)`, branches } : null
}
