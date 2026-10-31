// The AI pack: a model reads your routes and your diff looking for bugs and security holes. Opt-in (--include ai), because it sends
// source code to a model and costs tokens. It prints exactly what it will send before it sends it, blanks secret-looking values first,
// and uses your own Claude Code login by default (or any command you set in MEERKAT_AI_CMD). See thorough/ai.mjs.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const S = `${MK}/thorough/ai.mjs`
const mk = (id, title, estSeconds) => ({
  id: `ai-${id}`,
  group: 'security',
  tier: 'thorough',
  lane: 'free',
  weight: 'light',
  optIn: 'ai',
  title,
  estSeconds,
  timeoutSeconds: 1800,
  needs: ['node'],
  run: { cmd: 'node', args: [S, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [S, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  mk('route-audit', 'AI audit of every route, handler and IPC channel', 300),
  mk('diff-review', 'AI security review of the changes against the base branch', 60),
]
