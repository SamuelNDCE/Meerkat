// The functionality-run pack: checks that RUN the project in a temp copy of its git-tracked files and prove it works (build, frozen install,
// README commands, flaky tests, boot with .env.example). They execute project code, so they are opt-in: --include runtime, or name one with
// `meerkat check <id>`. See docs/functionality-run.md and thorough/sandbox.mjs.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/functionality-run.mjs`
const make = (id, title, { estSeconds, timeoutSeconds, weight = 'heavy', suite = 'test-hygiene', selfTest = true }) => ({
  id,
  group: 'functionality',
  tier: 'thorough',
  lane: 'free',
  weight,
  optIn: 'runtime',
  suite,
  title,
  estSeconds,
  timeoutSeconds,
  needs: ['node'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  ...(selfTest ? { selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true } } : {}),
})

export default [
  make('clean-copy-builds', 'A clean copy of the tracked files installs, builds and passes its tests', { estSeconds: 180, timeoutSeconds: 2400, weight: 'alone' }),
  make('install-reproducible', 'The frozen install works and the lockfile matches the manifest', { estSeconds: 60, timeoutSeconds: 900, suite: 'dependencies', selfTest: false }),
  make('readme-commands-work', 'The shell commands the README tells people to run work (allowlisted commands only)', { estSeconds: 90, timeoutSeconds: 1800 }),
  make('flaky-tests', 'The tests give the same result every time they run', { estSeconds: 180, timeoutSeconds: 3600, weight: 'alone' }),
  make('env-example-boot', 'The app starts with the variables .env.example lists (no undocumented variable)', { estSeconds: 60, timeoutSeconds: 1500 }),
]
