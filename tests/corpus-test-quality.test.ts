// The corpus's own tests must not trip test-quality-static: a clean twin whose smoke test checks a private copy of the code is not clean.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = (dir: string) => spawnSync(process.execPath, [join(root, 'thorough', 'mutation.mjs'), 'test-quality-static', '--root', dir], { encoding: 'utf8' })

describe('corpus tests pass test-quality-static', () => {
  test('every project the corpus writes, planted and clean, has tests that import the code and assert something', { timeout: 600000 }, () => {
    const out = mkdtempSync(join(tmpdir(), 'meerkat-tqcorpus-'))
    execFileSync(process.execPath, [join(root, 'tools', 'accuracy-corpus.mjs'), '--out', out], { cwd: root, stdio: 'pipe' })
    const dirty: string[] = []
    for (const p of readdirSync(out).filter((n) => statSync(join(out, n)).isDirectory())) {
      const r = check(join(out, p))
      if (r.status !== 0) dirty.push(`${p}: ${r.stdout.split('\n').filter((l) => l.startsWith('  ')).join(' | ')}`)
    }
    expect(dirty).toEqual([])
  })

  test('the other side: a test that checks a private copy of the code is still reported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-tqbad-'))
    mkdirSync(join(dir, 'tests'))
    writeFileSync(join(dir, 'tests', 'smoke.test.js'), "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n\nconst sum = (a, b) => a + b\n\ntest('sum', () => {\n  assert.equal(sum(2, 3), 5)\n})\n")
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['add', '-A'], { cwd: dir })
    const r = check(dir)
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain('never-imports-source')
  })
})
