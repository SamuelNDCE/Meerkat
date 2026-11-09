// Issue #82: thorough/lib.mjs defined cargoCmd without exporting it, so guard-mutants and parser-fuzz died at load. tests/paths-exports.test.ts only
// follows imports from a lib/ folder, so it missed '../../../thorough/lib.mjs'. This one follows EVERY relative named import in examples/*/scripts/*.mjs.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXAMPLES = join(ROOT, 'examples')

describe('example scripts import only names that the modules they point at export', () => {
  for (const ex of readdirSync(EXAMPLES)) {
    const dir = join(EXAMPLES, ex, 'scripts')
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
      const text = readFileSync(join(dir, file), 'utf8')
      for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.\.?\/[^']+\.mjs)'/g)) {
        test(`${ex}/${file} imports ${m[2]}`, async () => {
          const mod = await import(pathToFileURL(resolve(dir, m[2])).href)
          for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) expect(typeof mod[name], name).not.toBe('undefined')
        })
      }
    }
  }
  test('thorough/lib.mjs exports cargoCmd', async () => {
    // @ts-ignore plain .mjs module has no type declarations
    const lib = await import('../thorough/lib.mjs')
    expect(typeof lib.cargoCmd).toBe('function')
    expect(lib.cargoCmd(['test']).args).toContain('test')
  })
})
