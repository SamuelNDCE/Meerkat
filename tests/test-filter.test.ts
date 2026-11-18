// A test-name filter: the argument built for each runner follows that runner's own matching rule, and a run that
// matched no tests for a filter is reported as "no tests matched", never as a plain pass.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { buildTestCommand, runTestRun } from '../lib/testrun.mjs'

const dir = mkdtempSync(join(tmpdir(), 'meerkat-testfilter-'))
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const cargoOut = (n: number) => `running ${n} tests\ntest result: ok. ${n} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n`
const cargoNone = 'running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out\n'
// A fake runner: prints the file named by its last-but-one argument group; the text is chosen by the first filter word.
writeFileSync(join(dir, 'fake.mjs'), `const a = process.argv.slice(2)\nconst f = a[a.length - 1]\nconst none = ${JSON.stringify(cargoNone)}\nconst some = ${JSON.stringify(cargoOut(3))}\nprocess.stdout.write(f === 'health' || f === 'ghost' ? (f === 'ghost' ? none : some) : none)\n`)
const run = async (command: string, target: string) => {
  writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ commands: { test: command } }))
  const lines: string[] = []
  const code = await runTestRun([target, '--timeout', '30', '--folder', dir], { env: { ...process.env, MEERKAT_LOG_DIR: join(dir, 'logs') } as NodeJS.ProcessEnv, cwd: dir, out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) })
  return { code, text: lines.join('\n') }
}

describe('the argument built for a name filter', () => {
  test('cargo: a plain word is passed as is (cargo matches it as a substring), and the path form is kept as typed', () => {
    expect(buildTestCommand('cargo test', 'health', { isFile: false }).command).toBe('cargo test health')
    expect(buildTestCommand('cargo test', 'health::', { isFile: false }).command).toBe('cargo test health::')
  })
  test('vitest and jest use -t, pytest uses -k', () => {
    expect(buildTestCommand('npx vitest run', 'health', { isFile: false }).command).toBe('npx vitest run -t health')
    expect(buildTestCommand('npx jest', 'health', { isFile: false }).command).toBe('npx jest -t health')
    expect(buildTestCommand('python -m pytest', 'health', { isFile: false }).command).toBe('python -m pytest -k health')
  })
})

describe('a run that matched no tests', () => {
  test('a filter with 0 tests run is not a silent pass: it says the filter matched no tests, with the pattern and the command', async () => {
    const r = await run('node fake.mjs cargo test', 'ghost')
    expect(r.text).toMatch(/NO TESTS MATCHED/)
    expect(r.text).toContain('"ghost"')
    expect(r.text).not.toMatch(/^PASS:/m)
    expect(r.code).not.toBe(0)
  }, 60_000)
  test('a filter that matched tests is still a pass', async () => {
    const r = await run('node fake.mjs cargo test', 'health')
    expect(r.text).toMatch(/^PASS: 3 passed/m)
    expect(r.code).toBe(0)
  }, 60_000)
})
