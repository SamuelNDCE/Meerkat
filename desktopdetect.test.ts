import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The desktop checks must notice an Electron app however it imports electron, and must not be fooled by text that only mentions an import.
const run = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-detect-'))
  try {
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(d, name, '..'), { recursive: true })
      writeFileSync(join(d, name), body)
    }
    execFileSync('git', ['-C', d, 'init', '-q'])
    execFileSync('git', ['-C', d, 'add', '-A'])
    try {
      return execFileSync('node', [join(__dirname, 'thorough', 'desktop.mjs'), 'electron-node-integration', '--root', d], { encoding: 'utf8' })
    } catch (e) {
      // exit 1 means the check found the deliberate problem: its output is what we read
      return String((e as { stdout?: string }).stdout ?? '')
    }
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

describe('electron detection', () => {
  it('sees a multi-line import', () => {
    const out = run({ 'main.js': "import {\n  app,\n  BrowserWindow,\n} from 'electron'\nnew BrowserWindow({ webPreferences: { nodeIntegration: true } })\n" })
    expect(out).toMatch(/found|nodeIntegration|Node/i)
    expect(out).not.toMatch(/not an Electron app/i)
  })
  it('sees a destructured require', () => {
    const out = run({ 'main.js': "const {\n  app,\n} = require('electron')\n" })
    expect(out).not.toMatch(/not an Electron app/i)
  })
  it('sees a dependency in peerDependencies', () => {
    const out = run({ 'package.json': '{"name":"x","peerDependencies":{"electron":"^30.0.0"}}', 'a.js': 'module.exports = 1\n' })
    expect(out).not.toMatch(/not an Electron app/i)
  })
  it('is not fooled by a string that mentions an electron import', () => {
    const out = run({ 'tool.js': "const sample = \"const x = require('electron')\"\nmodule.exports = sample\n" })
    expect(out).toMatch(/not an Electron app/i)
  })
})
