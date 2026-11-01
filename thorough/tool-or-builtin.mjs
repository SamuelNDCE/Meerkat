#!/usr/bin/env node
// Run the real tool when it is installed; when it is not, run Meerkat's small built-in fallback and say so ("built-in fallback").
//   node thorough/tool-or-builtin.mjs --bin typos --fallback typos [--match REGEX] [--force-fallback] -- [tool options]
// Exit: 0 clean, 1 findings, 75 NOT RUN (the fallback itself could not run, e.g. no shell).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { trackedFiles } from './kit.mjs'
import { findBinary } from '../lib/which.mjs'
import { FALLBACKS } from '../lib/builtin.mjs'

const argv = process.argv.slice(2)
const dash = argv.indexOf('--')
const opts = dash < 0 ? argv : argv.slice(0, dash)
const toolArgs = dash < 0 ? [] : argv.slice(dash + 1)
const get = (name) => (opts.includes(name) ? opts[opts.indexOf(name) + 1] : null)
const bin = get('--bin')
const name = get('--fallback')
const match = get('--match')
const root = get('--root') ?? process.cwd()
const froot = get('--builtin-root') ?? root
if (!bin || !FALLBACKS[name]) {
  console.log('usage: node tool-or-builtin.mjs --bin <tool> --fallback <typos|yaml|markdown|links|shell> [--match <regex>] [--root <dir>] [--force-fallback] -- [tool options]')
  process.exit(2)
}

const real = opts.includes('--force-fallback') ? null : findBinary(bin)
if (real) {
  const here = dirname(fileURLToPath(import.meta.url))
  const r = match
    ? spawnSync(process.execPath, [join(here, 'on-files.mjs'), '--match', match, '--root', root, '--', bin, ...toolArgs], { cwd: root, stdio: 'inherit' })
    : spawnSync(real, toolArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(real) })
  process.exit(r.status ?? 1)
}

const files = trackedFiles(froot)
const r = FALLBACKS[name]({ root: froot, files })
const tag = `built-in fallback (${bin} is not installed; for the full check: meerkat tools)`
if (r.unavailable) {
  console.log(`NOT RUN: ${r.unavailable}; ${tag}`)
  process.exit(75)
}
for (const f of r.findings.slice(0, 200)) console.log(f)
const summary = r.findings.length ? `${tag}: ${r.findings.length} problem(s) in ${r.checked} file(s)` : `${tag}: no problems in ${r.checked} file(s)`
for (const line of [summary]) console.log(line)
process.exitCode = r.findings.length ? 1 : 0
