// Per-check progress for a whole-tree run (verify, test, quick) on stderr, so a long run never sits silent. Hooks for runAll (lib/runner.mjs):
// "[n/N] <id> running" when a check starts, "[done n/N] <id> <seconds>s <status>" when it ends. The answer stays on stdout (line 1 is not touched).
// Optional third argument { summary, dir, heartbeatMs }: the summary line (lib/runprogress.mjs) goes to `summary` after each of those lines and on a
// heartbeat, and <dir>/progress.json is kept current. Call stop() when the run ends: it ends the heartbeat and marks the file done.
import { trackProgress } from './runprogress.mjs'

export function verifyProgress(total, write = (l) => process.stderr.write(l + '\n'), { summary = null, dir = null, heartbeatMs = 0 } = {}) {
  let started = 0
  let finished = 0
  const track = summary || dir ? trackProgress({ total, say: summary, dir }) : null
  const timer = track && heartbeatMs > 0 ? setInterval(() => track.beat(), heartbeatMs) : null
  timer?.unref?.()
  return {
    start: (c) => (write(`[${++started}/${total}] ${c.id} running`), track?.start(c.id)),
    settle: (c, r, ms) => (write(`[done ${++finished}/${total}] ${c.id} ${(ms / 1000).toFixed(1)}s ${r?.status ?? ''}`.trimEnd()), track?.finish(c.id, ms)),
    stop: () => (clearInterval(timer), track?.end()),
  }
}
