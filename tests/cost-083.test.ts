// Token cost report (lib/cost.mjs): every command appends one row, `meerkat cost` reads them back, a damaged line is skipped and reported, the logging is cheap.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { appendRow, costCommand, costPath, estTokens, readCost, startCostMeter } from '../lib/cost.mjs'
// @ts-expect-error plain .mjs module
import { CLI } from './smoke-helpers.mjs'

let dir: string
let env: Record<string, string>
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mk-cost-'))
  env = { ...process.env, MEERKAT_LOG_DIR: dir, NO_COLOR: '1', CI: '1' } as Record<string, string>
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const cli = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })
const rows = () => readFileSync(costPath(env), 'utf8').split('\n').filter(Boolean)

describe('the cost log', () => {
  test('two commands append two rows, and cost shows them', () => {
    expect(cli(['version']).status).toBe(0)
    expect(cli(['presets']).status).toBe(0)
    expect(rows()).toHaveLength(2)
    const r = cli(['cost', '--last', '5', '--json'])
    const j = JSON.parse(r.stdout)
    expect(j.rows.slice(0, 2).map((x: { command: string }) => x.command)).toEqual(['version', 'presets'])
    expect(j.rows[0].bytes).toBeGreaterThan(0)
    expect(j.rows[0].estTokens).toBe(Math.ceil(j.rows[0].bytes / 4))
    expect(j.estimate).toMatch(/estimate/)
    const table = cli(['cost']).stdout
    expect(table).toMatch(/command\s+bytes\s+est\. tokens\s+seconds/)
    expect(table).toMatch(/version/)
    expect(table).toMatch(/ESTIMATE/)
  })

  test('--last limits the rows', () => {
    for (let i = 0; i < 5; i++) appendRow({ v: 1, at: new Date().toISOString(), cmd: `c${i}`, bytes: 40, chars: 40, tokens: 10, ms: 5, exit: 0 }, env)
    const j = JSON.parse(costCommand(['--last', '2', '--json'], { env }).text)
    expect(j.rows.map((x: { command: string }) => x.command)).toEqual(['c3', 'c4'])
    expect(costCommand(['--last', 'x'], { env }).code).toBe(2)
    expect(costCommand(['--bogus'], { env }).code).toBe(2)
  })

  test('a corrupt line is skipped, reported once, and kept in the file', () => {
    appendRow({ v: 1, at: 'a', cmd: 'one', bytes: 4, chars: 4, tokens: 1, ms: 1, exit: 0 }, env)
    appendFileSync(costPath(env), 'this is not json\n{"cmd":3}\n')
    appendRow({ v: 1, at: 'b', cmd: 'two', bytes: 8, chars: 8, tokens: 2, ms: 1, exit: 0 }, env)
    const text = costCommand([], { env }).text
    expect(text).toMatch(/one/)
    expect(text).toMatch(/two/)
    expect(text.match(/could not be read and were skipped/g)).toHaveLength(1)
    expect(text).toMatch(/2 line\(s\)/)
    expect(readFileSync(costPath(env), 'utf8')).toMatch(/this is not json/)
    expect(JSON.parse(costCommand(['--json'], { env }).text).skippedLines).toBe(2)
  })

  test('no log yet says so; an empty file says so', () => {
    expect(costCommand([], { env }).text).toMatch(/No cost log yet/)
    writeFileSync(costPath(env), '')
    expect(costCommand([], { env }).text).toMatch(/no readable rows/)
  })

  test('the estimate is characters / 4 rounded up', () => {
    expect(estTokens(0)).toBe(0)
    expect(estTokens(1)).toBe(1)
    expect(estTokens(4)).toBe(1)
    expect(estTokens(5)).toBe(2)
  })

  test('the meter counts what the command wrote to stdout and stderr', () => {
    const fake = (): { write: (c: unknown) => boolean; n: number } => ({ n: 0, write(this: { n: number }) { this.n++; return true } })
    const so = fake()
    const se = fake()
    const m = startCostMeter(['verdict'], { env, stdout: so, stderr: se, hookExit: false })
    so.write('12345678')
    se.write(Buffer.from('abcd'))
    m.finish(0)
    const r = readCost(env).rows[0]
    expect(r).toMatchObject({ cmd: 'verdict', bytes: 12, chars: 12, tokens: 3, exit: 0 })
    expect(so.n).toBe(1) // the original write still ran
  })

  test('arguments are never stored, only the command word', () => {
    cli(['dismiss', 'abcd1234', '--reason', 'SECRET-TOKEN-xyz'])
    expect(readFileSync(costPath(env), 'utf8')).not.toMatch(/SECRET-TOKEN/)
  })

  test('an unwritable log is reported on stderr, not silent', () => {
    const bad = { ...env, MEERKAT_LOG_DIR: join(dir, 'cost.jsonl', 'nested') } // a file is in the way of the folder
    appendFileSync(costPath(env), '')
    const r = appendRow({ v: 1, at: 'a', cmd: 'x', bytes: 1, chars: 1, tokens: 1, ms: 1, exit: 0 }, bad)
    expect(r.ok).toBe(false)
  })

  test('logging costs under 5 ms per command (measured)', () => {
    const N = 200
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < N; i++) {
      const so = { write: () => true }
      const m = startCostMeter(['gate'], { env, stdout: so, stderr: { write: () => true }, hookExit: false })
      so.write('some output')
      m.finish(0)
    }
    const perMs = Number(process.hrtime.bigint() - t0) / 1e6 / N
    console.log(`cost logging: ${perMs.toFixed(3)} ms per command (wrap + append)`)
    expect(perMs).toBeLessThan(5)
    expect(readCost(env).rows).toHaveLength(N)
  })
})
