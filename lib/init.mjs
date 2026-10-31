// `node run.mjs --init`: look at the project in the current folder and write a starting meerkat.config.json for it, so a new project
// is one command away from its first run. It never overwrites a config that is already there.
//   a Cargo project                the "rust" and "security" packs, and not the NeuralVault-shaped built-in checks
//   an Electron app like the one Meerkat was first written for (scripts/electron-run.mjs)  the built-in checks
//   anything else with a package.json  the "security" pack
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_NAME } from './config.mjs'

export function detect(dir, exists = existsSync) {
  const has = (f) => exists(join(dir, f))
  if (has('scripts/electron-run.mjs')) return { kind: 'electron', config: { builtin: true }, why: 'an Electron app with the window harness (scripts/electron-run.mjs)' }
  if (has('Cargo.toml')) return { kind: 'rust', config: { builtin: false, packs: ['rust', 'security'] }, why: 'a Cargo project (Cargo.toml)' }
  if (has('package.json')) return { kind: 'node', config: { builtin: false, packs: ['security'] }, why: 'a Node project (package.json)' }
  return { kind: 'unknown', config: { builtin: false, packs: ['security'] }, why: 'no Cargo.toml or package.json here, so only the general security checks' }
}

export function initConfig(dir, { exists = existsSync, write = writeFileSync } = {}) {
  const file = join(dir, CONFIG_NAME)
  if (exists(file)) return { written: false, file, message: `${file} already exists; left as it is` }
  const found = detect(dir, exists)
  write(file, `${JSON.stringify(found.config, null, 2)}\n`)
  return { written: true, file, kind: found.kind, message: `wrote ${file} for ${found.why}: ${JSON.stringify(found.config)}` }
}
