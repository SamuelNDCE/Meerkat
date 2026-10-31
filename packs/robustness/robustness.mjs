// The robustness pack: runtime checks most scanners never do. They run the project's own tests, build, command-line tools or exported
// functions in a temp copy of the git-tracked files with a scrubbed environment, so they are opt-in: --include runtime, or name one with
// `meerkat check <id>`. See docs/robustness.md and thorough/sandbox.mjs.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/robustness.mjs`
const make = (id, title, { estSeconds, timeoutSeconds, weight = 'heavy', subs }) => ({
  id,
  group: 'functionality',
  tier: 'thorough',
  lane: 'free',
  weight,
  optIn: 'runtime',
  suite: 'test-hygiene',
  title,
  estSeconds,
  timeoutSeconds,
  ...(subs ? { subs } : {}),
  needs: ['node'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('tz-locale-matrix', 'The tests pass in other time zones and locales too (UTC, Los Angeles, Kolkata, Kiritimati; Turkish, German)', { estSeconds: 120, timeoutSeconds: 3600, weight: 'alone', subs: 7 }),
  make('test-order-independence', 'The tests still pass when run in a different order (no hidden coupling between tests)', { estSeconds: 120, timeoutSeconds: 2400, weight: 'alone', subs: 3 }),
  make('parallel-safety', 'The tests give the same result one at a time and in parallel (no shared-state races)', { estSeconds: 120, timeoutSeconds: 2400, weight: 'alone', subs: 3 }),
  make('reproducible-build', 'Two clean builds of the same source give identical files (no timestamps, paths or random ids)', { estSeconds: 120, timeoutSeconds: 2400, weight: 'alone', subs: 1 }),
  make('crash-fuzz', 'Exported functions survive nasty inputs: no hang, crash, stack overflow or prototype pollution', { estSeconds: 90, timeoutSeconds: 2400, subs: 10 }),
  make('idempotent-cli', 'Command-line tools answer --help and --version identically, reject bad flags cleanly and never hang', { estSeconds: 30, timeoutSeconds: 600, weight: 'medium', subs: 5 }),
  make('unused-dependency-proof', 'Production dependencies that are not imported can be removed without breaking tests or build', { estSeconds: 240, timeoutSeconds: 3600, weight: 'alone', subs: 12 }),
  make('slow-test-regression', 'No test got more than 3x slower than its recent median (and the five slowest tests are listed)', { estSeconds: 120, timeoutSeconds: 1800, subs: 1 }),
]
