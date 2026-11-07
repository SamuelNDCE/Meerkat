#!/usr/bin/env node
// Run a style tool only when the project has chosen its rules. Without a configuration the tool's own defaults would judge a project that
// never asked for them (eslint has no rules at all, prettier and stylelint report taste), so the check is SKIPPED, not a finding and not a failure.
//   node thorough/config-guard.mjs --bin eslint [--root DIR] -- [tool options]
// Exit: whatever the tool exits with; 74 SKIPPED when the project has no configuration for it (nothing was asked of the tool, so nothing is wrong);
// 75 NOT RUN when the project is configured but the tool is not installed.
import { spawnSync } from 'node:child_process'
import { findBinary } from '../lib/which.mjs'
import { TOOL_CONFIGS, noConfigText, toolConfigured } from '../lib/toolconfig.mjs'

const argv = process.argv.slice(2)
const dash = argv.indexOf('--')
const opts = dash < 0 ? argv : argv.slice(0, dash)
const toolArgs = dash < 0 ? [] : argv.slice(dash + 1)
const get = (name) => (opts.includes(name) ? opts[opts.indexOf(name) + 1] : null)
const bin = get('--bin')
const root = get('--root') ?? process.cwd()

const spec = TOOL_CONFIGS[bin]
if (!spec) {
  console.log(`usage: node config-guard.mjs --bin <${Object.keys(TOOL_CONFIGS).join('|')}> [--root <dir>] -- [tool options]`)
  process.exit(2)
}

// No configuration is checked first: a project that never chose rules is SKIPPED whether or not the tool is installed.
if (!toolConfigured(bin, root, toolArgs)) {
  console.log(`SKIPPED: ${noConfigText(bin)}`)
  process.exit(74)
}
const real = findBinary(bin)
if (!real) {
  console.log(`NOT RUN: ${bin} is not installed (meerkat tools)`)
  process.exit(75)
}
const r = spawnSync(real, toolArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(real) })
process.exit(r.status ?? 1)
