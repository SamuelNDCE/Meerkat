// A finding dropped by an inline `// meerkat-ignore <check> <reason>` is counted, and the gate summary line says how many.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { compactGateText, gateMain } from '../lib/gate.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-suppressed-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const repo = (name: string, changed: string) => {
  const d = join(root, name)
  mkdirSync(join(d, 'src'), { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  writeFileSync(join(d, 'src/a.js'), 'export const a = 1\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'clean')
  writeFileSync(join(d, 'src/a.js'), changed)
  return d
}
const run = async (cwd: string) => {
  const out: string[] = []
  const logs = mkdtempSync(join(root, 'logs-'))
  const code = await gateMain([], { cwd, log: (l: string) => out.push(l), err: () => {}, env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: logs } })
  return { code, first: out.join('\n').split('\n')[0] }
}

describe('suppressed by meerkat-ignore', () => {
  test('compactGateText appends the count only when it is above zero', () => {
    const base = { rows: [], files: ['a.js'], exitCode: 0 }
    expect(compactGateText({ ...base, suppressed: 2 }).split('\n')[0]).toMatch(/, 2 suppressed by meerkat-ignore/)
    expect(compactGateText({ ...base, suppressed: 0 }).split('\n')[0]).not.toMatch(/suppressed/)
    expect(compactGateText(base).split('\n')[0]).not.toMatch(/suppressed/)
  })
  test('a gate on a fixture with one ignored finding says "1 suppressed by meerkat-ignore" on line 1', async () => {
    const d = repo('one', 'export const a = 1\n// meerkat-ignore risky-code the argument is a fixed string in this test\neval(process.argv[2])\n')
    const r = await run(d)
    expect(r.first).toMatch(/, 1 suppressed by meerkat-ignore/)
  }, 120000)
  test('a gate with nothing suppressed says nothing about it', async () => {
    const d = repo('none', 'export const a = 2\n')
    const r = await run(d)
    expect(r.first).not.toMatch(/suppressed/)
  }, 120000)
})
