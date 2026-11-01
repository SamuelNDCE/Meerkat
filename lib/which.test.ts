import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { findBinary } from './which.mjs'

// On Windows a bare "npm" next to "npm.cmd" is Node's shell script, which cannot be started: the .cmd must win.
test('on Windows the .cmd is found before the bare name', () => {
  const d = mkdtempSync(join(tmpdir(), 'meerkat-which-'))
  try {
    writeFileSync(join(d, 'npm'), '')
    writeFileSync(join(d, 'npm.cmd'), '')
    expect(findBinary('npm', { PATH: d, PATHEXT: '.EXE;.CMD' }, 'win32')).toBe(join(d, 'npm.cmd'))
    expect(findBinary('npm', { PATH: d }, 'linux')).toBe(join(d, 'npm'))
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})
