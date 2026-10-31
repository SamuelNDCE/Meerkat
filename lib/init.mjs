// `node run.mjs --init`: look at the project in the current folder and write a starting meerkat.config.json for it, so a new project
// is one command away from its first run. It never overwrites a config that is already there.
//   always            "security" (secret scan, full npm audit) and "hygiene" (license, large files, lockfiles, links and more): no tools needed
//   Cargo.toml        also "rust"
//   scripts/electron-run.mjs   also "neuralvault", the example set for an Electron app with a window harness
// Packs that need a tool installed (node, python, go, web, supply-chain, docs, infra) are not switched on for you: a tool that is not
// installed is a NOT RUN, and a first run should not start red. The message names them so you can add the ones you have.
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_NAME } from './config.mjs'

// The names of the files directly in a folder, or [] if it cannot be read. Only the wildcard markers (*.csproj, *.tf) use it.
export function listNames(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

// Tool packs that init SUGGESTS when it finds their marker. They are never written into the config (a missing tool is a NOT RUN).
const SUGGESTIONS = [
  { pack: 'java', why: 'a Java project (pom.xml or build.gradle)', found: (has) => has('pom.xml') || has('build.gradle') || has('build.gradle.kts') },
  { pack: 'dotnet', why: 'a .NET project (.csproj or .sln)', found: (has, names) => names().some((n) => /\.(csproj|sln)$/i.test(n)) },
  { pack: 'php', why: 'a PHP project (composer.json)', found: (has) => has('composer.json') },
  { pack: 'ruby', why: 'a Ruby project (Gemfile)', found: (has) => has('Gemfile') },
  { pack: 'swift', why: 'a Swift package (Package.swift)', found: (has) => has('Package.swift') },
  { pack: 'dart', why: 'a Dart or Flutter project (pubspec.yaml)', found: (has) => has('pubspec.yaml') },
  { pack: 'terraform', why: 'Terraform files (*.tf)', found: (has, names) => names().some((n) => /\.tf$/i.test(n)) },
  { pack: 'kubernetes', why: 'a Kubernetes or Helm setup (Chart.yaml or a k8s folder)', found: (has) => has('Chart.yaml') || has('k8s') },
  { pack: 'python', why: 'a Python project (pyproject.toml, requirements.txt or setup.py)', found: (has) => has('pyproject.toml') || has('requirements.txt') || has('setup.py') },
  { pack: 'go', why: 'a Go module (go.mod)', found: (has) => has('go.mod') },
  { pack: 'node', why: 'a TypeScript Node project (package.json and tsconfig.json)', found: (has) => has('package.json') && has('tsconfig.json') },
  { pack: 'web', why: 'a web page (index.html)', found: (has) => has('index.html') },
  { pack: 'infra', why: 'Docker or GitHub Actions files (a Dockerfile or .github/workflows)', found: (has) => has('Dockerfile') || has('.github/workflows') },
]

export function detect(dir, exists = existsSync, list = listNames) {
  const has = (f) => exists(join(dir, f))
  let names
  const namesOf = () => (names ??= list(dir))
  const packs = []
  const why = []
  if (has('Cargo.toml')) (packs.push('rust'), why.push('a Cargo project (Cargo.toml)'))
  if (has('scripts/electron-run.mjs')) (packs.push('neuralvault'), why.push('an Electron app with a window harness (scripts/electron-run.mjs)'))
  packs.push('security', 'hygiene')
  const kind = has('Cargo.toml') ? 'rust' : has('scripts/electron-run.mjs') ? 'electron' : has('package.json') ? 'node' : 'unknown'
  if (!why.length) why.push(has('package.json') ? 'a Node project (package.json)' : 'no Cargo.toml or package.json here')
  const suggest = SUGGESTIONS.filter((s) => s.found(has, namesOf)).map((s) => ({ pack: s.pack, why: s.why }))
  return { kind, config: { packs }, why: why.join(' and '), suggest }
}

// The packs that fit any repo, whatever it is made of. Used by the full-tier presets (full, thorough, release).
export const GENERIC_PACKS = ['security', 'security-plus', 'quality', 'repo', 'content', 'config', 'hygiene', 'docs', 'refactor', 'a11y', 'web-plus', 'lang',
  // Tool-free packs whose checks say "not applicable" (a pass) when the folder is not of their kind, so loading them everywhere costs nothing and
  // stops an Electron, Rust or notebook project from silently missing its own rules (desktop, electron-plus, rust-plus, data-science, ...).
  'desktop', 'electron-plus', 'rust-plus', 'data-science', 'secrets-plus', 'code-patterns', 'web-hardening', 'ci-systems', 'infra-plus', 'api', 'privacy', 'packaging', 'engines', 'git', 'health', 'ui']

// Every pack that applies to a folder: the generic ones, what detect() switches on (rust, the Electron example) and the ecosystem packs
// `meerkat init` only suggests (node, python, go, web, java, ...). A pack whose tool is missing still loads: its checks show NOT RUN with the install hint.
export function applicablePacks(dir, exists = existsSync, list = listNames) {
  const found = detect(dir, exists, list)
  const eco = found.suggest.map((x) => x.pack)
  if (exists(join(dir, 'package.json')) && !eco.includes('node')) eco.push('node')
  return [...new Set([...GENERIC_PACKS, ...found.config.packs, ...eco])]
}

// The packs a preset loads for a folder: its own list, plus every applicable pack when the preset asks for allPacks.
export function presetPacks(preset, dir, exists = existsSync, list = listNames) {
  const own = preset?.packs ?? []
  return preset?.allPacks ? [...new Set([...own, ...applicablePacks(dir, exists, list)])] : own
}

export function initConfig(dir, { exists = existsSync, write = writeFileSync, list = listNames } = {}) {
  const file = join(dir, CONFIG_NAME)
  if (exists(file)) return { written: false, file, message: `${file} already exists; left as it is` }
  const found = detect(dir, exists, list)
  write(file, `${JSON.stringify(found.config, null, 2)}\n`)
  const hints = found.suggest.map((s) => `\nFound ${s.why} in this folder. When the tool is installed, add "${s.pack}" to packs.`).join('')
  return {
    written: true,
    file,
    kind: found.kind,
    suggest: found.suggest,
    message: `wrote ${file} for ${found.why}: ${JSON.stringify(found.config)}\nAlso available (they need their tools installed, so add the ones you have to "packs"): node, python, go, web, supply-chain, docs, infra, performance, refactor, ai${hints}`,
  }
}
