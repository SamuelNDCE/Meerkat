// The quality pack: static checks on whitespace, debug leftovers, tests, versions, shell scripts and Makefiles, with no tool to install. Turn it on with { "packs": ["quality"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const QS = `${MK}/thorough/quality.mjs`
const make = (id, title) => ({
  id,
  group: 'functionality',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  run: { cmd: 'node', args: [QS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [QS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('trailing-whitespace', 'No line ends with stray spaces or tabs'),
  make('final-newline', 'Every text file ends with exactly one newline'),
  make('indent-consistency', 'No file mixes tab and space indentation'),
  make('line-length', 'No source line is over the length limit (default 200 characters)'),
  make('debug-leftovers', 'No debugger statements, console.log, debug prints, dbg! or todo! left in'),
  make('skipped-tests', 'No test is skipped or disabled'),
  make('focused-tests', 'No test is left focused, which silently skips the rest'),
  make('empty-catch', 'No error handler is empty and swallows the error'),
  make('test-presence', 'The source has tests, and large folders of source have a test file'),
  make('duplicate-test-names', 'No two tests in one file share the same name'),
  make('semver-valid', 'Package, Rust and Python versions are valid version numbers'),
  make('shell-hygiene', 'Shell scripts have a shebang, stop on errors and use LF line endings'),
  make('makefile-tabs', 'Makefile recipes start with a tab and the common targets are .PHONY'),
  make('todo-hygiene', 'TODO, FIXME, HACK and XXX comments name an owner or an issue (when enforced)'),
]
