// The doc-drift pack: the README and docs/*.md are compared with the code, structurally, with no model call.
// Each finding names the doc file and line, the place in the code that was checked, and what differs.
// Turn it on with { "packs": ["doc-drift"] } in meerkat.config.json. A name that is documented on purpose but not defined here goes in .meerkat-docdrift-allow.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/doc-drift.mjs`
const make = (id, title, expectMatch) => ({
  id,
  group: 'functionality',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  paths: ['**/*.md'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true, expectMatch },
})

export default [
  make('doc-drift-flags', "Flags the docs show for the project's own commands are defined in the code", 'documents --ghost, but no source file defines it'),
  make('doc-drift-env', 'Environment variables the docs name appear in the code', 'environment variable DEMO_GHOST'),
  make('doc-drift-paths', "File paths the docs name under the project's folders exist", 'lib/missing-file\\.mjs, which does not exist'),
  make('doc-drift-counts', 'Counts the docs state about a list or a folder match it', 'says three options, but the list under it has 2 items'),
  make('doc-drift-commands', 'Command examples in the docs parse, and the npm scripts and node files they run exist', 'does not parse|which package\\.json does not define'),
]
