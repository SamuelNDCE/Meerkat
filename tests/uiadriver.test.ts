// Windows UI Automation reference driver (examples/drivers/windows-uia-driver.ps1).
// The protocol-only test needs no window. The Notepad test runs a real window and only runs when RUN_UIA_TESTS=1 (Windows only).
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DRIVER = join(ROOT, 'examples', 'drivers', 'windows-uia-driver.ps1')
const isWindows = process.platform === 'win32'
const runReal = isWindows && process.env.RUN_UIA_TESTS === '1'

class Driver {
  proc: ChildProcessWithoutNullStreams
  private buf = ''
  private waiters: Array<(o: any) => void> = []
  private queue: any[] = []
  stderr = ''
  constructor(env: Record<string, string>) {
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', DRIVER], { env: { ...process.env, ...env } })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stderr.setEncoding('utf8')
    this.proc.stderr.on('data', (d) => (this.stderr += d))
    this.proc.stdout.on('data', (d: string) => {
      this.buf += d
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        const obj = JSON.parse(line)
        const w = this.waiters.shift()
        if (w) w(obj)
        else this.queue.push(obj)
      }
    })
  }
  send(o: object) {
    this.proc.stdin.write(JSON.stringify(o) + '\n')
  }
  next(ms: number): Promise<any> {
    if (this.queue.length) return Promise.resolve(this.queue.shift())
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no reply within ' + ms + ' ms; driver stderr: ' + this.stderr)), ms)
      this.waiters.push((o) => {
        clearTimeout(t)
        res(o)
      })
    })
  }
  async step(id: number, step: object, timeoutMs = 3000) {
    this.send({ id, type: 'step', step, index: id, total: 99, timeoutMs })
    return this.next(timeoutMs + 15000)
  }
  kill() {
    try {
      this.proc.kill()
    } catch {}
  }
}

const drivers: Driver[] = []
afterAll(() => drivers.forEach((d) => d.kill()))

describe.skipIf(!isWindows)('windows UIA driver protocol', () => {
  test('hello with no window replies ok false with the detail text, within 25 seconds', async () => {
    const d = new Driver({ UIA_WINDOW_TITLE: 'meerkat-no-such-window-8c1f2e' })
    drivers.push(d)
    const t = Date.now()
    d.send({ type: 'hello', protocol: 2 })
    const r = await d.next(25_000)
    expect(Date.now() - t).toBeLessThan(25_000)
    expect(r.type).toBe('ready')
    expect(r.ok).toBe(false)
    expect(r.detail).toBe('no window titled meerkat-no-such-window-8c1f2e within 20 s')
    d.send({ type: 'stop' })
    expect((await d.next(10_000)).type).toBe('stopped')
    const code = await new Promise((res) => (d.proc.exitCode !== null ? res(d.proc.exitCode) : d.proc.on('exit', (c) => res(c))))
    expect(code).toBe(0)
  }, 40_000)
})

const pids = () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process notepad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ","'], { encoding: 'utf8' })
  return new Set(r.stdout.trim().split(',').filter(Boolean))
}

describe.skipIf(!runReal)('windows UIA driver against Notepad', () => {
  test('types text, asserts it, and fails an assert on a missing name listing the window names', async () => {
    const before = pids()
    const np = spawn('notepad.exe', [], { stdio: 'ignore', detached: false })
    const out = mkdtempSync(join(tmpdir(), 'mk-uia-'))
    const d = new Driver({ UIA_WINDOW_TITLE: 'Notepad' })
    drivers.push(d)
    try {
      d.send({ type: 'hello', protocol: 2 })
      const ready = await d.next(30_000)
      expect(ready.ok).toBe(true)
      expect(ready.capabilities).toEqual(['open', 'click', 'type', 'wait-for', 'assert', 'screenshot'])

      const typed = await d.step(1, { type: 'type', selector: 'edit', value: 'meerkat uia hello 42' }, 10_000)
      expect(typed.ok).toBe(true)
      const good = await d.step(2, { type: 'assert', text: 'meerkat uia hello 42' })
      expect(good.ok).toBe(true)
      const waited = await d.step(3, { type: 'wait-for', text: 'hello 42' })
      expect(waited.ok).toBe(true)

      const shot = join(out, 'win.png')
      const s = await d.step(4, { type: 'screenshot', path: shot })
      expect(s.ok).toBe(true)
      expect(existsSync(shot)).toBe(true)

      const bad = await d.step(5, { type: 'assert', text: 'No Such Name Anywhere' })
      expect(bad.ok).toBe(false)
      expect(bad.expected).toBe('element named No Such Name Anywhere')
      expect(bad.actual).toMatch(/^not found; window has: "/)
      expect(bad.actual.split('", "').length).toBeLessThanOrEqual(10)

      const click = await d.step(6, { type: 'click', text: 'No Such Button' }, 600)
      expect(click.ok).toBe(false)
      expect(click.actual).toContain('window has:')

      d.send({ type: 'stop' })
      expect((await d.next(10_000)).type).toBe('stopped')
    } finally {
      d.kill()
      np.kill()
      for (const p of pids()) if (!before.has(p)) spawnSync('taskkill', ['/PID', p, '/F'])
      rmSync(out, { recursive: true, force: true })
    }
  }, 120_000)
})

if (!runReal) {
  test('Notepad UIA test skipped: set RUN_UIA_TESTS=1 on Windows to run it', () => {
    console.log('windows UIA driver Notepad test skipped: RUN_UIA_TESTS=1 is not set (or not Windows)')
    expect(true).toBe(true)
  })
}
