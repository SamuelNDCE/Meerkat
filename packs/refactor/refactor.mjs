// The refactor pack: is the code itself in good shape? Duplicated code, dead code, files too long, functions too long or too complex,
// deep nesting, commented-out code, long parameter lists and unused files. The three quick checks run in the fast tier so refactoring
// shows up in everyday runs; the rest are thorough. Kept apart from "does the app work". Turn it on with { "packs": ["refactor"] }, run it
// alone with --preset refactor. Limits: "refactor" in .meerkat-budgets.json (see thorough/refactor.mjs).
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/refactor.mjs`
const mk = (id, title, estSeconds, tier = 'thorough', weight = 'tiny') => ({
  id,
  group: 'refactor',
  tier,
  lane: 'free',
  weight,
  title,
  estSeconds,
  needs: ['node'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  mk('duplicate-code', 'Duplicated code: blocks copied between files', 15, 'fast', 'light'),
  mk('dead-code', 'Dead code: exported names nothing else uses (JS and TS)', 10, 'fast', 'light'),
  mk('file-length', 'Files too long to read in one sitting', 3, 'fast', 'light'),
  mk('long-functions', 'Functions too long to read in one sitting', 10, 'thorough', 'light'),
  mk('deep-nesting', 'Code nested too many levels deep', 5),
  mk('commented-out-code', 'Commented-out code left in the files', 5),
  mk('many-parameters', 'Functions with too many parameters', 5),
  mk('unused-files', 'JavaScript and TypeScript files nothing imports', 10, 'thorough', 'light'),
  mk('cyclomatic-complexity', 'Functions with too many branches to test', 5),
]
