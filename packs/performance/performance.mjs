// The performance pack: budgets for size, start-up, build time, response time, load and dependency weight. Turn it on with
// { "packs": ["performance"] } and put the budgets in .meerkat-budgets.json under "perf" (the format is at the top of thorough/perf.mjs).
// A check whose budget is missing is NOT RUN with the exact lines to add, so an unset budget is never mistaken for a pass.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/perf.mjs`
const mk = (id, title, tier, estSeconds, extra = {}) => ({
  id: `perf-${id}`,
  group: 'performance',
  tier,
  lane: 'free',
  title,
  estSeconds,
  needs: ['node'],
  paths: ['.meerkat-budgets.json'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true },
  ...extra,
})

export default [
  mk('sizes', 'Size budgets: bundles and binaries stay under their limits', 'fast', 2),
  mk('deps', 'Dependency weight: direct count and installed size', 'fast', 3),
  mk('startup', 'Start-up time: how fast the app is ready (median of several starts)', 'fast', 15, { timeoutSeconds: 300 }),
  mk('endpoints', 'Response time: p95 of each configured endpoint', 'thorough', 20, { timeoutSeconds: 600 }),
  mk('load', 'Load burst: concurrent requests to a local server, error rate and p95', 'thorough', 30, { timeoutSeconds: 900, cost: { cpu: 4, memGB: 1 } }),
  mk('build', 'Build time: the build stays inside its time budget', 'thorough', 120, { timeoutSeconds: 3600, cost: { cpu: 8, memGB: 3 }, alone: true }),
]
