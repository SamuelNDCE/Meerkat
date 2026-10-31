// The refactor pack: is the code itself in good shape? Duplicated code, dead code, files too long. Thorough tier, and kept apart from
// "does the app work". Turn it on with { "packs": ["refactor"] }, run it alone with --preset refactor. Limits: "refactor" in
// .meerkat-budgets.json (see thorough/refactor.mjs).
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/refactor.mjs`
const mk = (id, title, estSeconds) => ({
  id,
  group: 'refactor',
  tier: 'thorough',
  lane: 'free',
  title,
  estSeconds,
  needs: ['node'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  mk('duplicate-code', 'Duplicated code: blocks copied between files', 15),
  mk('dead-code', 'Dead code: exported names nothing else uses (JS and TS)', 10),
  mk('file-length', 'Files too long to read in one sitting', 3),
]
