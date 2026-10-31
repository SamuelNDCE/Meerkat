// The repo pack: checks on what git tracks (names, modes, build output) and on package.json with its lockfiles. Turn it on with { "packs": ["repo"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const ST = `${MK}/thorough/repo-files.mjs`
const make = (id, group, title) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 2,
  needs: ['node'],
  run: { cmd: 'node', args: [ST, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [ST, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('generated-files-tracked', 'functionality', 'No build or dependency output (node_modules, dist, build, target and similar) is committed to git'),
  make('case-conflicts', 'functionality', 'No two file names differ only by upper and lower case (they clash on Windows and macOS)'),
  make('long-paths', 'functionality', 'No tracked path is too long for Windows tools (default limit 200 characters)'),
  make('reserved-names', 'functionality', 'No file or folder uses a name Windows cannot use (CON, AUX, NUL, COM1, and similar)'),
  make('non-ascii-filenames', 'functionality', 'File names use plain ASCII characters only'),
  make('symlinks-tracked', 'security', 'No symbolic links are committed (they break on Windows checkouts)'),
  make('exec-bits', 'functionality', 'Executable bits match the files: scripts with a #! line are executable, and executables have one'),
  make('package-fields', 'functionality', 'package.json has its name, version, license and entry points that exist'),
  make('lockfile-sync', 'functionality', 'The lockfiles list every dependency that package.json and Cargo.toml declare'),
  make('deprecated-deps', 'security', 'No locked dependency is marked deprecated by its author'),
]
