// A frontend run where every step is skipped checked nothing: exit 75 and an explicit not-a-pass line, never 0 (NeuralVault's false pass).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const made: string[] = []
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })
const MK = resolve(__dirname, '..', 'bin', 'meerkat.mjs')

describe('frontend with no commands defined', () => {
  test('every step skipped: exit 75 and says it is not a pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'meerkat-fe-')); made.push(root)
    writeFileSync(join(root, 'package.json'), '{"name":"x","version":"1.0.0","private":true}')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'a.tsx'), 'export const a = 1\n')
    writeFileSync(join(root, 'meerkat.config.json'), '{"packs":[],"discover":false}')
    execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'])
    execFileSync('git', ['-C', root, 'add', '-A'])
    execFileSync('git', ['-C', root, '-c', 'user.email=a@b', '-c', 'user.name=t', 'commit', '-qm', 'base'])
    const r = spawnSync(process.execPath, [MK, 'frontend', '--app', root, '--files', 'src/a.tsx'], { encoding: 'utf8', env: { ...process.env, MEERKAT_LOG_DIR: join(root, 'logs') } })
    expect(r.status).toBe(75)
    expect(r.stdout + r.stderr).toMatch(/NOT a pass: every step was skipped/)
    expect(r.stdout).toMatch(/NOT RUN|skipped/)
  }, 60000)
})
