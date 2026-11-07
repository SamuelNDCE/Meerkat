// A thorough/*.mjs check run in a worker thread (lib/inproc.mjs) must give the same result as the process it replaces.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { runCommand } from './exec.mjs'
import { closeInprocPool, inprocPlan, scriptIsInproc } from './inproc.mjs'
import { MEERKAT_DIR } from './paths.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-inproc-'))
afterAll(() => {
  closeInprocPool()
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
const put = (file: string, body: string) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), body)
}
const git = (...args: string[]) => spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
git('init', '-q', '-b', 'main')
put('a.js', '// FIXME: broken\nexport const a = 1\n')
put('b.json', '{ not json')
put('c.js', "import './missing.js'\n")
git('add', '-A')

const run = async (script: string, id: string, inproc: boolean) => {
  if (inproc) delete process.env.MEERKAT_NO_INPROC
  else process.env.MEERKAT_NO_INPROC = '1'
  try {
    return await runCommand({ cmd: 'node', args: [`${MEERKAT_DIR}/thorough/${script}`, id], cwd: root, timeoutMs: 60_000, idleMs: 60_000 })
  } finally {
    delete process.env.MEERKAT_NO_INPROC
  }
}

describe('in-process checks match their process', () => {
  test('the checks used here are eligible for a worker', () => {
    expect(scriptIsInproc(`${MEERKAT_DIR}/thorough/hygiene.mjs`)).toBe(true)
    expect(inprocPlan('node', [`${MEERKAT_DIR}/thorough/hygiene.mjs`, 'markers'], root)).not.toBeNull()
    process.env.MEERKAT_NO_INPROC = '1'
    expect(inprocPlan('node', [`${MEERKAT_DIR}/thorough/hygiene.mjs`, 'markers'], root)).toBeNull()
    delete process.env.MEERKAT_NO_INPROC
  })

  test.each([
    ['hygiene.mjs', 'markers'],
    ['hygiene.mjs', 'json-valid'],
    ['static.mjs', 'broken-imports'],
    ['hygiene.mjs', 'license'],
  ])('%s %s: same exit code, output and findings', async (script, id) => {
    const proc = await run(script, id, false)
    const inproc = await run(script, id, true)
    expect(inproc.code).toBe(proc.code)
    expect(inproc.output).toBe(proc.output)
    expect(inproc.findings).toEqual(proc.findings)
    expect(inproc.subs).toEqual(proc.subs)
  })

  test('a check that finds something reports it, and a clean one does not', async () => {
    expect((await run('hygiene.mjs', 'markers', true)).code).toBe(1)
    expect((await run('hygiene.mjs', 'conflict-markers', true)).code).toBe(0)
  })

  test('text read in one run is never served after the file changed', async () => {
    const before = await run('hygiene.mjs', 'markers', true)
    expect(before.code).toBe(1)
    put('a.js', 'export const a = 1\n') // the note is gone, and the size changed
    const after = await run('hygiene.mjs', 'markers', true)
    expect(after.code).toBe(0)
    put('a.js', '// FIXME: back again\nexport const a = 1\n')
    expect((await run('hygiene.mjs', 'markers', true)).code).toBe(1)
  })

  test('an unknown check id behaves like the process (exit 2)', async () => {
    const proc = await run('hygiene.mjs', 'no-such-check', false)
    const inproc = await run('hygiene.mjs', 'no-such-check', true)
    expect(inproc.code).toBe(2)
    expect(inproc.code).toBe(proc.code)
    expect(inproc.output).toBe(proc.output)
  })

  test('a timeout is reported as a timeout, and the worker is replaced', async () => {
    delete process.env.MEERKAT_NO_INPROC
    closeInprocPool() // a cold worker needs longer than the 1 ms limit
    const r = await runCommand({ cmd: 'node', args: [`${MEERKAT_DIR}/thorough/hygiene.mjs`, 'license'], cwd: root, timeoutMs: 1, idleMs: 60_000 })
    expect(r.timedOut).toBe(true)
    expect((await run('hygiene.mjs', 'markers', true)).code).toBe(1)
  })
})
