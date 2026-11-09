import { describe, expect, test } from 'vitest'
import { lockWaitOf, waitingLine } from '../lib/lockwait.mjs'

// The WAITING line must name the lock holder. Before this, the queue wording printed pid "?" and cmd "unknown job".
describe('lock holder in the WAITING line', () => {
  test('the final-message wording names pid and command', () => {
    const w = lockWaitOf([{ kind: 'notrun', id: 'rust-test', detail: 'waited 900 s for the lock; held by process 360 running cargo test --workspace; lock at x; another job' }])
    expect(w).toMatchObject({ pid: '360', cmd: 'cargo test --workspace', waited: 900 })
  })

  test('the queue wording names pid and command', () => {
    const w = lockWaitOf([{ kind: 'notrun', id: 'rust-test', detail: 'position 2 of 3 in the queue, held by process 123 (cargo build) for 40 s, you have waited 900 s' }])
    expect(w).toMatchObject({ pid: '123', cmd: 'cargo build', waited: 900 })
  })

  test('the WAITING line carries the holder', () => {
    const line = waitingLine({ pid: '360', cmd: 'cargo test --workspace', waited: 900 }, {})
    expect(line).toBe('WAITING: cargo lock held by pid 360 (cargo test --workspace), waited 900s, limit 900s; not a result')
  })
})
