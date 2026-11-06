// CDP reference driver: protocol replies and step handling, driven through a fake CDP client (no browser, no socket).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
// @ts-ignore plain mjs modules
import { createHandler, CAPABILITIES } from '../examples/drivers/cdp-driver.mjs'
// @ts-ignore
import { fakeCdp } from '../fixtures/clickthrough/fake-cdp-server.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DRIVER = join(ROOT, 'examples', 'drivers', 'cdp-driver.mjs')

async function ready() {
  const cdp = fakeCdp()
  const handle = createHandler(async () => cdp)
  await handle({ type: 'hello' })
  return { cdp, handle }
}
const step = (handle: any, s: any, timeoutMs = 500) => handle({ id: 1, type: 'step', step: s, timeoutMs }).then((r: any) => r.reply)

describe('cdp driver protocol', () => {
  test('hello replies ready with capabilities', async () => {
    const handle = createHandler(async () => fakeCdp())
    const { reply } = await handle({ type: 'hello' })
    expect(reply).toEqual({ type: 'ready', ok: true, capabilities: CAPABILITIES })
  })

  test('hello replies ready false with a detail when it cannot connect', async () => {
    const handle = createHandler(async () => {
      throw new Error('ECONNREFUSED')
    })
    const { reply } = await handle({ type: 'hello' })
    expect(reply.ok).toBe(false)
    expect(reply.detail).toContain('ECONNREFUSED')
    expect(reply.detail).toContain('--remote-debugging-port')
  })

  test('stop replies stopped, closes the connection and asks to exit', async () => {
    const { cdp, handle } = await ready()
    const r = await handle({ type: 'stop' })
    expect(r.reply).toEqual({ type: 'stopped' })
    expect(r.exit).toBe(true)
    expect(cdp.closed).toBe(true)
  })

  test('a failing assert names expected and actual', async () => {
    const { handle } = await ready()
    const r = await step(handle, { type: 'assert', text: 'Nope' })
    expect(r.id).toBe(1)
    expect(r.ok).toBe(false)
    expect(r.expected).toBe('text "Nope" is present')
    expect(r.actual).toContain('page shows: Welcome Save')
  })

  test('click on a missing element says not found and shows the page', async () => {
    const { handle } = await ready()
    const r = await step(handle, { type: 'click', text: 'Delete' })
    expect(r.ok).toBe(false)
    expect(r.expected).toBe('element with text Delete')
    expect(r.actual).toMatch(/^not found, page shows: Welcome Save/)
  })

  test('click sends a real mouse press and release, then the assert passes', async () => {
    const { cdp, handle } = await ready()
    expect((await step(handle, { type: 'click', text: 'Save' })).ok).toBe(true)
    const types = cdp.calls.filter((c: any) => c.method === 'Input.dispatchMouseEvent').map((c: any) => c.params.type)
    expect(types).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased'])
    expect((await step(handle, { type: 'assert', text: 'Saved' })).ok).toBe(true)
  })

  test('open navigates, wait-for times out with expected and actual', async () => {
    const { cdp, handle } = await ready()
    const o = await step(handle, { type: 'open', url: 'http://x.test/a' })
    expect(o.ok).toBe(true)
    expect(cdp.calls.some((c: any) => c.method === 'Page.navigate' && c.params.url === 'http://x.test/a')).toBe(true)
    const w = await step(handle, { type: 'wait-for', text: 'Never' }, 300)
    expect(w.ok).toBe(false)
    expect(w.expected).toContain('Never')
  })

  test('screenshot writes the PNG to step.path', async () => {
    const { handle } = await ready()
    const dir = mkdtempSync(join(tmpdir(), 'mk-cdp-'))
    try {
      const p = join(dir, 's.png')
      expect((await step(handle, { type: 'screenshot', path: p })).ok).toBe(true)
      expect(existsSync(p)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the real process answers hello with ready false when nothing listens, and stop exits 0', () => {
    const r = spawnSync(process.execPath, [DRIVER], {
      input: JSON.stringify({ type: 'hello' }) + '\n' + JSON.stringify({ type: 'stop' }) + '\n',
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, CDP_PORT: '1' },
    })
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines[0].type).toBe('ready')
    expect(lines[0].ok).toBe(false)
    expect(lines[1]).toEqual({ type: 'stopped' })
  })
})
