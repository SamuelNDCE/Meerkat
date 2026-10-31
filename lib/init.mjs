// `node run.mjs --init`: look at the project in the current folder and write a starting meerkat.config.json for it, so a new project
// is one command away from its first run. It never overwrites a config that is already there.
//   always            "security" (secret scan, full npm audit) and "hygiene" (license, large files, lockfiles, links and more): no tools needed
//   Cargo.toml        also "rust"
//   scripts/electron-run.mjs   also "neuralvault", the example set for an Electron app with a window harness
// Packs that need a tool installed (node, python, go, web, supply-chain, docs, infra) are not switched on for you: a tool that is not
// installed is a NOT RUN, and a first run should not start red. The message names them so you can add the ones you have.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_NAME } from './config.mjs'

export function detect(dir, exists = existsSync) {
  const has = (f) => exists(join(dir, f))
  const packs = []
  const why = []
  if (has('Cargo.toml')) (packs.push('rust'), why.push('a Cargo project (Cargo.toml)'))
  if (has('scripts/electron-run.mjs')) (packs.push('neuralvault'), why.push('an Electron app with a window harness (scripts/electron-run.mjs)'))
  packs.push('security', 'hygiene')
  const kind = has('Cargo.toml') ? 'rust' : has('scripts/electron-run.mjs') ? 'electron' : has('package.json') ? 'node' : 'unknown'
  if (!why.length) why.push(has('package.json') ? 'a Node project (package.json)' : 'no Cargo.toml or package.json here')
  return { kind, config: { packs }, why: why.join(' and ') }
}

export function initConfig(dir, { exists = existsSync, write = writeFileSync } = {}) {
  const file = join(dir, CONFIG_NAME)
  if (exists(file)) return { written: false, file, message: `${file} already exists; left as it is` }
  const found = detect(dir, exists)
  write(file, `${JSON.stringify(found.config, null, 2)}\n`)
  return {
    written: true,
    file,
    kind: found.kind,
    message: `wrote ${file} for ${found.why}: ${JSON.stringify(found.config)}\nAlso available (they need their tools installed, so add the ones you have to "packs"): node, python, go, web, supply-chain, docs, infra, performance, refactor, ai`,
  }
}
