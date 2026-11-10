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

const NAMES = Object.freeze({ 0: 'PASS', 1: 'FAIL', 2: 'USAGE', 3: 'NO_RESULT', 4: 'STALE', 75: 'INCOMPLETE' })

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
