// examples/neuralvault/scripts/click-shards.mjs (and so `meerkat doctor`) imports importFromApp from lib/paths.mjs. 0.3.13 and 0.3.14 defined it without
// exporting it, so both died with "does not provide an export named importFromApp". Every named import the NeuralVault example scripts take from lib/ must exist.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPTS = join(ROOT, 'examples', 'neuralvault', 'scripts')

describe('the example scripts import only names that lib/ exports', () => {
  for (const file of readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'))) {
    const text = readFileSync(join(SCRIPTS, file), 'utf8')
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.\.?\/[^']*lib\/[^']+\.mjs)'/g)) {
      test(`${file} imports ${m[2]}`, async () => {
        const mod = await import(pathToFileURL(resolve(dirname(join(SCRIPTS, file)), m[2])).href)
        for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) expect(typeof mod[name], name).not.toBe('undefined')
      })
    }
  }
  test('importFromApp loads a script that belongs to the app', async () => {
    // @ts-ignore plain .mjs module has no type declarations
    const { importFromApp } = await import('../lib/paths.mjs')
    const mod = await importFromApp(ROOT, 'lib/version.mjs')
    expect(typeof mod.compareVersions).toBe('function')
  })
})
