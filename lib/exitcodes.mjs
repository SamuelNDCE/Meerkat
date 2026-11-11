// The verdict's exit codes, in one place. Every answer that `meerkat verdict` and `meerkat batch` print carries one of these,
// and the JSON carries `exitCode` and `exitName`, so a script never has to read the text.
//   0   PASS        nothing new blocks in the changed files
//   1   FAIL        a finding the branch added, in a file it changed
//   2   USAGE       a bad flag or value; nothing was run
//   3   NO_RESULT   nothing could be judged: no base, a bad ref, nothing changed, no check ran on the changed files
//   4   STALE       the branch is too far behind its base; refused unless --allow-stale
//   75  INCOMPLETE  the run stopped early (time limit, cargo lock wait, interruption); not a pass
// The numbers follow the usual developer conventions (2 = usage, 75 = temporary failure, as sysexits(3) and coreutils use them).
export const VERDICT_EXIT = Object.freeze({ pass: 0, fail: 1, usage: 2, noResult: 3, stale: 4, incomplete: 75 })

// Codes the gate adds (lib/gate.mjs): 70 Meerkat itself threw (sysexits EX_SOFTWARE), 124 the time limit (the timeout(1) convention), 130 interrupted.
export const GATE_EXIT = Object.freeze({ ...VERDICT_EXIT, internal: 70, timeout: 124, interrupted: 130 })

const NAMES = Object.freeze({ 0: 'PASS', 1: 'FAIL', 2: 'USAGE', 3: 'NO_RESULT', 4: 'STALE', 70: 'SOFTWARE', 75: 'INCOMPLETE', 124: 'TIMEOUT', 130: 'INTERRUPTED' })

export const exitName = (code) => NAMES[code] ?? `UNKNOWN_${code}`

// The verdict word that goes with each exit code, so the text and the JSON can never disagree.
export const verdictWord = (code) => ({ 0: 'PASS', 1: 'FAIL', 2: 'NO-RESULT', 3: 'NO-RESULT', 4: 'STALE', 75: 'INCOMPLETE' })[code] ?? 'NO-RESULT'

// The table as help and the docs print it.
export const VERDICT_EXIT_TABLE = [
  { code: 0, name: 'PASS', meaning: 'nothing new blocks in the changed files' },
  { code: 1, name: 'FAIL', meaning: 'a finding the branch added, in a file it changed' },
  { code: 2, name: 'USAGE', meaning: 'a bad flag or value; nothing was run' },
  { code: 3, name: 'NO_RESULT', meaning: 'nothing could be judged (no base, a bad ref, nothing changed, no check ran on the changed files)' },
  { code: 4, name: 'STALE', meaning: 'the branch is more than 20 commits behind its base; refused unless --allow-stale' },
  { code: 75, name: 'INCOMPLETE', meaning: 'the run stopped early (time limit, cargo lock wait, interruption); not a pass' },
]

// An HTTP-style status next to the exit code, for readers (scripts, queues, dashboards) that think in 2xx/4xx/5xx. It is an extra field,
// never a replacement: the process exit codes above do not change. The JSON carries `status` and `statusText`; the first line of the text
// answer ends with `[status]`.
//   200 PASS        422 FAIL (new blocking finding)     400 USAGE        404 NO_RESULT, ref/folder/config not found
//   204 NO_RESULT, anything else (nothing changed, no check ran on the changed files)             409 STALE
//   423 lock held   408 time limit   499 interrupted    503 required tool missing or failed to start
//   500 Meerkat itself failed       206 PARTIAL: every check that ran passed, some did not run or did not finish (exit 75, never a pass)
export const STATUS = Object.freeze({
  ok: 200,
  noContent: 204,
  partial: 206,
  badRequest: 400,
  notFound: 404,
  timeout: 408,
  conflict: 409,
  unprocessable: 422,
  locked: 423,
  clientClosed: 499,
  internal: 500,
  unavailable: 503,
})

const STATUS_TEXT = Object.freeze({
  200: 'OK',
  204: 'No Content',
  206: 'Partial Content',
  400: 'Bad Request',
  404: 'Not Found',
  408: 'Request Timeout',
  409: 'Conflict',
  422: 'Unprocessable',
  423: 'Locked',
  499: 'Client Closed',
  500: 'Internal Error',
  503: 'Service Unavailable',
})

export const statusText = (status) => STATUS_TEXT[status] ?? 'Unknown'

// Why an INCOMPLETE run stopped, with the sentence that goes with each reason.
export const INCOMPLETE_REASONS = Object.freeze({
  'lock-held': 'the cargo lock was held by another job for longer than the wait limit',
  timeout: 'the overall time limit was reached',
  interrupted: 'the run was interrupted',
  'tool-missing': 'a required tool was missing or failed to start',
  'check-unfinished': 'some checks did not run or did not finish; every check that ran passed',
  'tool-problem': 'a check crashed or its tool failed; that is a tool problem, not a finding in the code',
})

const REASON_STATUS = Object.freeze({
  'lock-held': STATUS.locked,
  timeout: STATUS.timeout,
  interrupted: STATUS.clientClosed,
  'tool-missing': STATUS.unavailable,
  'check-unfinished': STATUS.partial,
  'tool-problem': STATUS.unavailable,
})

// answer: { exitCode, verdict?, incompleteReason?, notFound?, internal?, partial? }. Returns the status number.
//   internal: Meerkat itself failed (an exception in Meerkat code, not in a check)       -> 500
//   partial: every check that ran passed but some did not run or did not finish          -> 206
//   incompleteReason: why the run stopped early (see INCOMPLETE_REASONS)                 -> 423, 408, 499, 503 or 206
//   notFound: the ref, folder or config was not found                                    -> 404 (NO_RESULT)
// An unrecognised reason on an incomplete run is 206, a result with a reason, never a pass.
export function statusOf(answer = {}) {
  if (answer.internal) return STATUS.internal
  if (answer.partial) return STATUS.partial
  if (answer.incompleteReason && answer.incompleteReason !== 'unknown' && REASON_STATUS[answer.incompleteReason]) return REASON_STATUS[answer.incompleteReason]
  const code = answer.exitCode
  switch (code) {
    case VERDICT_EXIT.pass:
      return STATUS.ok
    case VERDICT_EXIT.fail:
      return answer.verdict === 'NO-RESULT' ? (answer.notFound ? STATUS.notFound : STATUS.noContent) : STATUS.unprocessable
    case VERDICT_EXIT.usage:
      return answer.notFound ? STATUS.notFound : STATUS.badRequest
    case VERDICT_EXIT.noResult:
      return answer.notFound ? STATUS.notFound : STATUS.noContent
    case VERDICT_EXIT.stale:
      return STATUS.conflict
    case VERDICT_EXIT.incomplete:
      return STATUS.partial
    case 124:
      return STATUS.timeout
    case 130:
      return STATUS.clientClosed
    default:
      return STATUS.internal
  }
}

// { status, statusText } for the JSON.
export const statusFields = (answer) => {
  const status = statusOf(answer)
  return { status, statusText: statusText(status) }
}

// The codes only `meerkat gate` adds, with the status each one carries. 75 stays for a cargo lock wait (423) and for a run that stopped before its record was saved (500).
export const GATE_EXIT_TABLE = [
  { code: 70, name: 'SOFTWARE', status: STATUS.internal, meaning: 'Meerkat itself threw an unexpected error; one stdout line, the stack only in the run log' },
  { code: 124, name: 'TIMEOUT', status: STATUS.timeout, meaning: 'the time limit was reached' },
  { code: 130, name: 'INTERRUPTED', status: STATUS.clientClosed, meaning: 'the run was interrupted' },
]
