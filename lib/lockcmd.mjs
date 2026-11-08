// `meerkat lock status`: who holds the machine-wide cargo lock (lib/lock.mjs) and who waits for it, with each waiter's command, pid and wait so far.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lockStatus } from './lock.mjs'

export const lockDirOf = (env = process.env) => env.MEERKAT_CARGO_LOCK_DIR || join(tmpdir(), 'meerkat-cargo.lock')

const span = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

export function lockStatusText(st, now = Date.now()) {
  if (!st.holder && !st.waiters.length) return `The cargo lock is free (${st.dir}). Nobody holds it and nobody waits.`
  const lines = []
  if (st.holder) lines.push(`holder: pid ${st.holder.pid}, running ${span(now - Date.parse(st.holder.since))}: ${st.holder.cmd || 'unknown job'}`)
  else lines.push('holder: none (the lock is being taken or was just let go)')
  lines.push(st.waiters.length ? `waiting (${st.waiters.length}), longest first:` : 'waiting: nobody')
  for (const w of st.waiters) lines.push(`  pid ${w.pid}  waited ${span(now - Date.parse(w.since))}  ${w.cmd || 'unknown job'}`)
  return lines.join('\n')
}

export function runLock(argv, { env = process.env, out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const [sub, ...rest] = argv
  if (sub !== 'status') {
    err('usage: meerkat lock status [--json]')
    return 2
  }
  const st = lockStatus(lockDirOf(env))
  out(rest.includes('--json') ? JSON.stringify(st, null, 2) : lockStatusText(st))
  return 0
}
