// `meerkat finding`, `dismiss` and `undismiss` read the newest run that HAS a findings.json. A `map` run saves no findings.json, so running
// `map` after `verify` must not hide the verify run: the commands use it and say which run they used.
import { spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { CLI, makeSandbox, runCli } from './smoke-helpers.mjs'

let sb: ReturnType<typeof makeSandbox>
let id = ''
let verifyRun = ''
beforeAll(() => {
  sb = makeSandbox({ label: 'finding-after-map' })
  runCli(sb, ['verify', '--plain'], { timeout: 140000 })
  const f = JSON.parse(spawnSync(process.execPath, [CLI, 'findings', '--json', '--limit', '1'], { cwd: sb.app, env: sb.env, encoding: 'utf8' }).stdout || '{}')
  id = String(f.findings?.[0]?.id ?? '')
  verifyRun = String(f.runFolder ?? '').split('/').pop() ?? ''
  runCli(sb, ['map'], { timeout: 140000 })
}, 300000)
afterAll(() => sb?.cleanup())

describe('finding commands after a map run', () => {
  test('the fixture has a finding and a verify run to come back to', () => {
    expect(id).not.toBe('')
    expect(verifyRun).not.toBe('')
  })
  test('finding still finds the verify run and names it', () => {
    const r = runCli(sb, ['finding', id])
    expect(r.code, r.all.slice(0, 400)).toBe(0)
    expect(r.stdout).toContain(`using run ${verifyRun}`)
  })
  test('findings still finds it too', () => {
    const r = runCli(sb, ['findings', '--limit', '3'])
    expect(r.code, r.all.slice(0, 400)).toBe(0)
    expect(r.stdout).toContain(`using run ${verifyRun}`)
  })
  test('dismiss and undismiss use it and name it', () => {
    const d = runCli(sb, ['dismiss', id, '--reason', 'test: not a problem'])
    expect(d.code, d.all.slice(0, 400)).toBe(0)
    expect(d.stdout).toContain(`using run ${verifyRun}`)
    const u = runCli(sb, ['undismiss', id])
    expect(u.code, u.all.slice(0, 400)).toBe(0)
    expect(u.stdout).toContain(`using run ${verifyRun}`)
  })
})
