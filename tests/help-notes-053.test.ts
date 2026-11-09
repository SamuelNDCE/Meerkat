import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const BIN = resolve(__dirname, '..', 'bin', 'meerkat.mjs')
const run = (args: string[], cwd: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 90000, env: { ...process.env, CI: '', MEERKAT_NO_TIP: '', ...env } })

describe('help notes', () => {
  test('verdict help shows the known-file format', () => {
    const r = run(['verdict', '--help'], __dirname)
    const t = r.stdout + r.stderr
    expect(t).toContain('[{"check":"rp-errors","file":"apps/x/src/a.rs","line":12}]')
    expect(t).toContain('line')
    expect(t).toContain('exit 2')
  })
  test('resume help says a timed out check runs again', () => {
    const r = run(['verdict', '--help'], __dirname)
    expect(r.stdout + r.stderr).toContain('timed out')
    expect(r.stdout + r.stderr).toContain('MEERKAT_VERDICT_TIMEOUT_S')
  })
  test('first-run note shows once per machine', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mk-fr-'))
    const logs = mkdtempSync(join(tmpdir(), 'mk-frlog-'))
    writeFileSync(join(dir, 'package.json'), '{}\n')
    spawnSync('git', ['init', '-q'], { cwd: dir })
    const first = run(['quick'], dir, { MEERKAT_LOG_DIR: logs })
    expect(first.stdout + first.stderr).toContain('First run in this project')
    expect(readdirSync(join(logs, 'first-run')).length).toBe(1)
    const second = run(['quick'], dir, { MEERKAT_LOG_DIR: logs })
    expect(second.stdout + second.stderr).not.toContain('First run in this project')
  }, 100000)
})
