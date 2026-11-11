import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// `meerkat test-run` runs the repo's commands.test, so it must refuse until the commands block is trusted,
// the same as frontend, evidence and the other commands that run project commands.
const CLI = join(__dirname, '..', 'bin', 'meerkat.mjs')

describe('test-run trust gate', () => {
  test('refuses to run an untrusted commands block and says how to trust it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mk-trust-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'meerkat.config.json'), JSON.stringify({ commands: { test: 'node -e "process.exit(0)"' } }))
    writeFileSync(join(dir, 'src', 'a.test.js'), 'x')
    const env = { ...process.env, MEERKAT_TRUST_PROJECT: '' }
    const res = spawnSync(process.execPath, [CLI, 'test-run', 'src/a.test.js', '--folder', dir], { encoding: 'utf8', env })
    expect(res.status).toBe(1)
    expect(`${res.stdout}${res.stderr}`).toMatch(/meerkat trust/)
    expect(`${res.stdout}${res.stderr}`).toMatch(/NOT run/)
  })
})
