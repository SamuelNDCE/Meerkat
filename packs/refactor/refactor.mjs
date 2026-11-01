// The refactor pack: is the code itself in good shape? Duplicated code, dead code, files too long, functions too long or too complex,
// deep nesting, commented-out code, long parameter lists and unused files. The three quick checks run in the fast tier so refactoring
// shows up in everyday runs; the rest are thorough. Kept apart from "does the app work". Turn it on with { "packs": ["refactor"] }, run it
// alone with --preset refactor. Limits: "refactor" in .meerkat-budgets.json (see thorough/refactor.mjs).
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/refactor.mjs`
// Measured 2026-11-01 on five real projects (50 to 1500 files): every one of these ran in 0.2 to 0.6 s, so the old 3 to 15 s guesses made the
// first-run bar over-promise by 10x. The written time is for a mid-size project; scale: 'files' grows it for big ones.
const mk = (id, title, estSeconds, tier = 'thorough', weight = 'tiny') => ({
  id,
  group: 'refactor',
  tier,
  lane: 'free',
  weight,
  title,
  estSeconds,
  scale: 'files',
  needs: ['node'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  mk('duplicate-code', 'Duplicated code: blocks copied between files', 3, 'fast', 'light'),
  mk('dead-code', 'Dead code: exported names nothing else uses (JS and TS)', 2, 'fast', 'light'),
  mk('file-length', 'Files too long to read in one sitting', 1, 'fast', 'light'),
  mk('long-functions', 'Functions too long to read in one sitting', 2, 'fast', 'light'),
  mk('deep-nesting', 'Code nested too many levels deep', 1, 'fast'),
  mk('commented-out-code', 'Commented-out code left in the files', 1, 'fast'),
  mk('many-parameters', 'Functions with too many parameters', 1, 'fast'),
  mk('unused-files', 'JavaScript and TypeScript files nothing imports', 2, 'fast', 'light'),
  mk('cyclomatic-complexity', 'Functions with too many branches to test', 1, 'fast'),
]
