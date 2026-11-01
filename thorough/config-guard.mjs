#!/usr/bin/env node
// Run a style tool only when the project has chosen its rules. Without a configuration the tool's own defaults would judge a project that
// never asked for them (eslint has no rules at all, prettier and stylelint report taste), so the check is NOT RUN, not a finding.
//   node thorough/config-guard.mjs --bin eslint [--root DIR] -- [tool options]
// Exit: whatever the tool exits with; 75 NOT RUN when the project has no configuration for it.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findBinary } from '../lib/which.mjs'

const argv = process.argv.slice(2)
const dash = argv.indexOf('--')
const opts = dash < 0 ? argv : argv.slice(0, dash)
const toolArgs = dash < 0 ? [] : argv.slice(dash + 1)
const get = (name) => (opts.includes(name) ? opts[opts.indexOf(name) + 1] : null)
const bin = get('--bin')
const root = get('--root') ?? process.cwd()

const exts = (base, list) => list.map((e) => `${base}${e}`)
const CONFIGS = {
  eslint: { files: [...exts('eslint.config', ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']), ...exts('.eslintrc', ['', '.js', '.cjs', '.json', '.yaml', '.yml'])], pkg: 'eslintConfig' },
  prettier: { files: [...exts('.prettierrc', ['', '.json', '.yaml', '.yml', '.json5', '.js', '.cjs', '.mjs', '.toml']), ...exts('prettier.config', ['.js', '.cjs', '.mjs'])], pkg: 'prettier' },
  stylelint: { files: [...exts('.stylelintrc', ['', '.json', '.yaml', '.yml', '.js', '.cjs', '.mjs']), ...exts('stylelint.config', ['.js', '.cjs', '.mjs'])], pkg: 'stylelint' },
}
const spec = CONFIGS[bin]
if (!spec) {
  console.log(`usage: node config-guard.mjs --bin <${Object.keys(CONFIGS).join('|')}> [--root <dir>] -- [tool options]`)
  process.exit(2)
}

const real = findBinary(bin)
if (!real) {
  console.log(`NOT RUN: ${bin} is not installed (meerkat tools)`)
  process.exit(75)
}
let configured = spec.files.some((f) => existsSync(join(root, f)))
if (!configured) {
  try { configured = spec.pkg in JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch { /* no package.json */ }
}
// An option that names a configuration (or switches the lookup off) means the caller chose the rules.
if (toolArgs.some((a) => /^(--no-config-lookup|--config|-c|--rule)$/.test(a))) configured = true
if (!configured) {
  console.log(`NOT RUN: this project has no ${bin} configuration, so ${bin} has no rules of the project's to apply`)
  process.exit(75)
}
const r = spawnSync(real, toolArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(real) })
process.exit(r.status ?? 1)
