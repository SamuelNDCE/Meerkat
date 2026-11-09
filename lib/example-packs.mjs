// Example packs are folders under examples/ that describe themselves in a pack.json. Meerkat's own code never names one: it reads the manifests here.
//   pack          the name used in the config "packs" list
//   detectFile    a file whose presence in the project makes `meerkat --init` switch the pack on
//   detectKind    the project kind --init reports for that file
//   detectWhy     the sentence --init prints for it
//   needsAppFile  a file the app folder must hold for the pack to run (the pack drives the app through it)
//   memoryAdapter a file in the folder exporting exportMemory and summaryLine (see lib/memory.mjs); the adapter is named by the pack
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEERKAT_DIR } from './paths.mjs'

export function examplePacks(root = MEERKAT_DIR) {
  const base = join(root, 'examples')
  let dirs = []
  try {
    dirs = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  } catch {
    return []
  }
  const found = []
  for (const dir of dirs) {
    const file = join(base, dir, 'pack.json')
    if (!existsSync(file)) continue
    try {
      const m = JSON.parse(readFileSync(file, 'utf8'))
      if (m && typeof m.pack === 'string') found.push({ ...m, dir })
    } catch {
      /* a manifest that does not parse is ignored */
    }
  }
  return found
}
