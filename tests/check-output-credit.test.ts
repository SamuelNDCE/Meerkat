import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (f: string) => import(pathToFileURL(join(root, 'tools', f)).href)

function runDirWith(output: string) {
  const dir = mkdtempSync(join(tmpdir(), 'mk-out-'))
  writeFileSync(join(dir, 'risky-code.log'), `result: FAIL\n--- output ---\n${output}\n`)
  return dir
}

describe('seenInCheckOutput', () => {
  test('a file-only line does not credit a defect that has a line number', async () => {
    const { seenInCheckOutput } = await load('accuracy-corpus.mjs')
    const dir = runDirWith('problem in src/a.js')
    try {
      expect(seenInCheckOutput({ check: 'risky-code', alt: [], file: 'src/a.js', line: 12 }, dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a file-only line still credits a defect with no line number', async () => {
    const { seenInCheckOutput } = await load('accuracy-corpus.mjs')
    const dir = runDirWith('problem in src/a.js')
    try {
      expect(seenInCheckOutput({ check: 'risky-code', alt: [], file: 'src/a.js', line: 0 }, dir)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a defect with a line is credited when the line is within 3', async () => {
    const { seenInCheckOutput } = await load('accuracy-corpus.mjs')
    const dir = runDirWith('src/a.js:14 eval used')
    try {
      expect(seenInCheckOutput({ check: 'risky-code', alt: [], file: 'src/a.js', line: 12 }, dir)).toBe(true)
      expect(seenInCheckOutput({ check: 'risky-code', alt: [], file: 'src/a.js', line: 30 }, dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
