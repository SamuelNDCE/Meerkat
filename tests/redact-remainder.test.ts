import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { redact } from '../thorough/redact.mjs'

// A harmless value (an empty string, a short placeholder) must not stop the rest of the line from being scanned.
describe('redact keeps scanning after a harmless value', () => {
  test('an empty password does not hide a second, unclosed secret on the same line', () => {
    const r = redact('password="", api_key="sk_live_abcdef0123456789abcdef')
    expect(r.hard).toBeGreaterThan(0)
    expect(r.text).not.toContain('sk_live_abcdef')
  })
  test('a short placeholder does not hide a second secret either', () => {
    const r = redact("password='{}'; token='abcdefghijklmnopqrstuvwx")
    expect(r.hard).toBeGreaterThan(0)
    expect(r.text).not.toContain('abcdefghijklmnop')
  })
  test('a line with only harmless values is still left alone', () => {
    const r = redact('{"password":"","notes":""}')
    expect(r.hard).toBe(0)
    expect(r.text).toBe('{"password":"","notes":""}')
  })
})

// The preload exposure rule: the safe form inside an exposed function is fine, handing over a powerful module or process data is not.
const NL = String.fromCharCode(10)
const preload = (body: string) => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-preload-'))
  try {
    writeFileSync(join(d, 'package.json'), '{"name":"x","dependencies":{"electron":"30.0.0"}}')
    writeFileSync(join(d, 'main.js'), "const { app, BrowserWindow } = require('electron')" + NL)
    writeFileSync(join(d, 'preload.js'), body)
    execFileSync('git', ['-C', d, 'init', '-q'])
    execFileSync('git', ['-C', d, 'add', '-A'])
    try {
      return execFileSync('node', [join(__dirname, '..', 'thorough', 'desktop.mjs'), 'electron-preload-exposure', '--root', d], { encoding: 'utf8' })
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? '')
    }
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}
const expose = (inner: string) => "const { contextBridge } = require('electron')" + NL + "contextBridge.exposeInMainWorld('api', { " + inner + ' })' + NL
const flagged = (out: string) => /exposes ipcRenderer, require or process/.test(out)

describe('electron-preload-exposure keeps catching powerful exposure', () => {
  test('the safe form inside an exposed function is allowed', () => {
    expect(flagged(preload(expose("pathForFile: (f) => require('electron').webUtils.getPathForFile(f)")))).toBe(false)
  })
  test('a shell module called inside an exposed function is flagged', () => {
    expect(flagged(preload(expose("run: (c) => require('child_process').execSync(c)")))).toBe(true)
  })
  test('require with a computed name is flagged', () => {
    expect(flagged(preload(expose('load: (n) => require(n)')))).toBe(true)
  })
  test('process.env and process.exit are flagged', () => {
    expect(flagged(preload(expose('env: () => process.env')))).toBe(true)
    expect(flagged(preload(expose('quit: () => process.exit(0)')))).toBe(true)
  })
  test('a spread of process or require is flagged', () => {
    expect(flagged(preload(expose('...process')))).toBe(true)
  })
  test('handing over ipcRenderer is still flagged', () => {
    expect(flagged(preload(expose('ipc: ipcRenderer')))).toBe(true)
  })
})
