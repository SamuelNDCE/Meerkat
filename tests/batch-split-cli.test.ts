// Regression (29an): `meerkat batch --split` from the CLI passed no gate and failed with "gate is not a function".
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

test('batch --split without an injected gate reaches the real gate, not a TypeError', () => {
  const root = mkdtempSync(join(tmpdir(), 'meerkat-split-cli-'))
  try {
    const r = spawnSync(process.execPath, ['bin/meerkat.mjs', 'batch', '--base', 'HEAD', '--app', root, '--split', 'no-such-branch'], {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') },
    })
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/gate is not a function/)
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}, 150000)
