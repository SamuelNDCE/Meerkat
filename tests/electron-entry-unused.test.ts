// unused-files: a preload loaded by name from a file in the same folder (Electron) is used, and a real orphan still fails.
import { describe, expect, test } from 'vitest'
import { runCheck } from './fp057-run'

const unused = (files: Record<string, string>) => runCheck('thorough/refactor.mjs', 'unused-files', files, true)

describe('unused-files and Electron entries', () => {
  test('a preload named by basename in its folder is quiet', () => {
    const r = unused({
      'electron/main.js': "const path = require('path')\nnew BrowserWindow({ webPreferences: { preload: path.join(__dirname, 'preload.js') } })\n",
      'electron/preload.js': 'contextBridge.exposeInMainWorld("api", {})\n',
    })
    expect(r.out).not.toContain('electron/preload.js')
  })
  test('a file nothing names still fails', () => {
    const r = unused({
      'electron/main.js': "console.log('x')\n",
      'electron/orphan.js': 'export const o = 1\n',
    })
    expect(r.out).toContain('electron/orphan.js')
  })
})
