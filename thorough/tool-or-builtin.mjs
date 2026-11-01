#!/usr/bin/env node
// Run the real tool when it is installed; when it is not, run Meerkat's small built-in fallback and say so ("built-in fallback").
//   node thorough/tool-or-builtin.mjs --bin typos --fallback typos [--match REGEX] [--force-fallback] -- [tool options]
// Exit: 0 clean, 1 findings, 75 NOT RUN (the fallback itself could not run, e.g. no shell).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// markdownlint-cli2's own defaults judge style (80 columns, bare URLs). A project that has not chosen markdownlint rules gets lenient ones:
// style-only rules are off, real mistakes (broken tables, bad link syntax, unclosed fences) stay on.
const MD_CONFIGS = ['.markdownlint.json', '.markdownlint.jsonc', '.markdownlint.yaml', '.markdownlint.yml', '.markdownlint.cjs', '.markdownlint.mjs',
  '.markdownlint-cli2.jsonc', '.markdownlint-cli2.yaml', '.markdownlint-cli2.cjs', '.markdownlint-cli2.mjs']
let cleanup = null
if (real && bin === 'markdownlint-cli2' && !toolArgs.includes('--config') && !MD_CONFIGS.some((n) => existsSync(join(root, n)))) {
  cleanup = mkdtempSync(join(tmpdir(), 'meerkat-mdl-'))
  const file = join(cleanup, '.markdownlint.json')
  const style = ['MD003', 'MD004', 'MD005', 'MD007', 'MD009', 'MD010', 'MD012', 'MD013', 'MD022', 'MD024', 'MD026', 'MD028', 'MD029', 'MD030', 'MD031', 'MD032', 'MD033', 'MD034', 'MD035', 'MD036', 'MD040', 'MD041', 'MD046', 'MD047', 'MD049', 'MD050', 'MD060']
  writeFileSync(file, JSON.stringify({ default: true, ...Object.fromEntries(style.map((r) => [r, false])) }))
  toolArgs.push('--config', file)
}

if (real) {
  const here = dirname(fileURLToPath(import.meta.url))
  const r = match
    ? spawnSync(process.execPath, [join(here, 'on-files.mjs'), '--match', match, '--root', root, '--', bin, ...toolArgs], { cwd: root, stdio: 'inherit' })
    : spawnSync(real, toolArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(real) })
  if (cleanup) rmSync(cleanup, { recursive: true, force: true })
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
