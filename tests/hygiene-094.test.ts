// Items 1 and 2 of 0.9.4 hygiene: the child registry, tree kill on stop, and `meerkat ps`.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isAlive, listChildren, psCommand } from '../lib/childreg.mjs'

const here = (f: string) => join(__dirname, f)
const homes: string[] = []
const newHome = () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-hyg-'))
  homes.push(d)
  return d
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await sleep(100)
  }
  return fn()
}
afterEach(() => {
  for (const h of homes.splice(0)) {
    for (const r of listChildren({ env: { MEERKAT_HOME: h } as any })) spawnSync('taskkill', ['/PID', String(r.pid), '/T', '/F'], { windowsHide: true })
    rmSync(h, { recursive: true, force: true })
  }
})

describe('child registry', () => {
  for (const how of ['signal', 'error']) {
    it(`a stop by ${how} kills the child tree and leaves no registry entry`, async () => {
      const home = newHome()
      const p = spawn(process.execPath, [here('hygiene-094.helper-parent.mjs'), how], { env: { ...process.env, MEERKAT_HOME: home }, stdio: 'ignore', windowsHide: true })
      const env = { MEERKAT_HOME: home } as any
      expect(await until(() => listChildren({ env }).length === 1, 4000)).toBe(true)
      const pid = listChildren({ env })[0].pid
      expect(isAlive(pid)).toBe(true)
      await new Promise((r) => p.on('exit', r)) // the parent stops itself after 2 s
      expect(await until(() => !isAlive(pid), 5000)).toBe(true)
      expect(readdirSync(join(home, 'children')).length).toBe(0)
    }, 20000)
  }
})

describe('meerkat ps', () => {
  it('lists an orphan after its parent is killed without cleanup, and --kill removes it', async () => {
    const home = newHome()
    const env = { MEERKAT_HOME: home } as any
    const r = spawnSync(process.execPath, [here('hygiene-094.helper-orphan.mjs')], { env: { ...process.env, MEERKAT_HOME: home }, encoding: 'utf8', windowsHide: true, timeout: 15000 })
    const pid = Number(String(r.stdout).trim().split(/\s+/)[0])
    expect(pid).toBeGreaterThan(0)
    expect(isAlive(pid)).toBe(true)
    const listed = psCommand([], { env })
    expect(listed.text).toContain(String(pid))
    expect(listed.text).toContain('sleeping-orphan')
    const killed = psCommand(['--kill'], { env })
    expect(killed.text).toContain(`killed ${pid}`)
    expect(await until(() => !isAlive(pid), 5000)).toBe(true)
    expect(existsSync(join(home, 'children', `${pid}.json`))).toBe(false)
  }, 30000)

  it('never kills a process that is not in the registry, or one whose parent is alive', async () => {
    const home = newHome()
    const env = { MEERKAT_HOME: home } as any
    const stranger = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true })
    try {
      const out = psCommand(['--kill'], { env })
      expect(out.text).toContain('No Meerkat-started processes')
      expect(isAlive(stranger.pid!)).toBe(true)
    } finally {
      stranger.kill()
    }
  })
})
