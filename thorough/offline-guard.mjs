#!/usr/bin/env node
// Run a command that needs the network and turn "could not reach the service" into NOT RUN instead of a failure.
//   node thorough/offline-guard.mjs --offline REGEX -- cargo audit
// A tool that cannot fetch its advisory database has checked nothing: that is not a finding and not a pass.
// Exit: the command's own code, except 75 (NOT RUN) when it failed and its output matches the regex.
import { spawnSync } from 'node:child_process'
import { findBinary } from '../lib/which.mjs'

const argv = process.argv.slice(2)
const dash = argv.indexOf('--')
const oi = argv.indexOf('--offline')
if (dash < 0 || oi < 0 || !argv[oi + 1] || dash === argv.length - 1) {
  console.log('usage: node offline-guard.mjs --offline <regex> -- <command> [args]')
  process.exit(2)
}
const pattern = new RegExp(argv[oi + 1], 'i')
const [cmd, ...args] = argv.slice(dash + 1)
const real = findBinary(cmd) ?? cmd
const r = spawnSync(real, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(real) })
const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
process.stdout.write(out)
if (r.error) {
  console.log(`NOT RUN: ${cmd} could not start (${r.error.code ?? r.error.message})`)
  process.exit(75)
}
if (r.status !== 0 && pattern.test(out)) {
  console.log(`NOT RUN: ${cmd} could not reach the service it needs (offline, blocked or busy); nothing was checked`)
  process.exit(75)
}
process.exit(r.status ?? 1)
