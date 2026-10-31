// The hygiene pack: cheap, tool-free checks that fit any repository. Turn it on with { "packs": ["hygiene"] } in meerkat.config.json.
// Every check reads only the files git tracks, runs in a second or two, and proves itself with a deliberately broken folder.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/hygiene.mjs`
const mk = (id, group, title, tier = 'fast') => ({
  id,
  group,
  tier,
  lane: 'free',
  title,
  estSeconds: 2,
  needs: ['node'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  mk('license', 'security', 'A license is declared, and no copyleft dependency slipped in'),
  mk('sensitive-files', 'security', 'No environment files, private keys or tokens are tracked'),
  mk('unsafe-rust', 'security', 'Every Rust unsafe block says why it is sound'),
  mk('large-files', 'functionality', 'No oversized file or committed binary'),
  mk('lockfiles', 'functionality', 'Every manifest has its lockfile'),
  mk('json-valid', 'functionality', 'Every tracked JSON file parses'),
  mk('conflict-markers', 'functionality', 'No leftover merge-conflict markers'),
  mk('scripts-resolve', 'functionality', 'Every file an npm script runs exists'),
  mk('markers', 'functionality', 'No FIXME or XXX notes left in the code'),
  mk('links', 'functionality', 'Every relative link in the documents resolves'),
  mk('ui-static', 'ui', 'Pages have alt text, a language, a title and a viewport; no empty buttons'),
]
