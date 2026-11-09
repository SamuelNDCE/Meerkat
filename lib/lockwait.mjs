// A check that waited for the machine-wide cargo lock and gave up (lib/lock.mjs exit 75) did not fail and did not produce a result. gate, verdict
// and top say so with one WAITING line instead of a NO-RESULT or a failure: "WAITING: cargo lock held by pid N (<command>), waited Ns, limit Ms; not a result".
const WAITED = /waited (\d+) s(?: for the lock)?/
// Two wordings exist: "held by process 123 running <cmd>; lock at ..." (lib/lock.mjs final message) and "held by process 123 (<cmd>) for 40 s, you have waited" (the queue line).
const HELD = /held by process (\S+) (?:running (.*?)(?:; lock at |; another job|$)|\((.*?)\)(?: for \d+ s)?(?:, you have waited|$))/

// The first not-run row whose detail says it gave up waiting for the lock, as { pid, cmd, waited }, or null.
export function lockWaitOf(rows = []) {
  for (const r of rows) {
    if (r?.kind !== 'notrun' && r?.status !== 'NOT RUN') continue
    const d = String(r.detail ?? '')
    const w = d.match(WAITED)
    if (!w) continue
    const h = d.match(HELD)
    return { pid: h?.[1] ?? '?', cmd: (h?.[2] ?? h?.[3] ?? 'unknown job').trim(), waited: Number(w[1]), id: r.id }
  }
  return null
}

export const lockLimitSeconds = (env = process.env) => (Number(env.MEERKAT_LOCK_MAX_WAIT ?? env.CARGO_LOCK_MAX_WAIT) > 0 ? Number(env.MEERKAT_LOCK_MAX_WAIT ?? env.CARGO_LOCK_MAX_WAIT) : 900)

export function waitingLine(w, env = process.env) {
  const cmd = w.cmd.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 120)
  return `WAITING: cargo lock held by pid ${w.pid} (${cmd}), waited ${w.waited}s, limit ${lockLimitSeconds(env)}s; not a result`
}
