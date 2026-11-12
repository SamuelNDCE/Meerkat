// Per-check progress for a whole-tree run (verify, test, quick) on stderr, so a long run never sits silent. Hooks for runAll (lib/runner.mjs):
// "[n/N] <id> running" when a check starts, "[done n/N] <id> <seconds>s <status>" when it ends. The answer stays on stdout (line 1 is not touched).
export function verifyProgress(total, write = (l) => process.stderr.write(l + '\n')) {
  let started = 0
  let finished = 0
  return {
    start: (c) => write(`[${++started}/${total}] ${c.id} running`),
    settle: (c, r, ms) => write(`[done ${++finished}/${total}] ${c.id} ${(ms / 1000).toFixed(1)}s ${r?.status ?? ''}`.trimEnd()),
  }
}
