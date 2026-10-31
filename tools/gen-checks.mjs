// Writes the list of every check into docs/checks.md and into the README between their markers, from the checks themselves, so the
// documentation cannot drift from the code:   node tools/gen-checks.mjs
// One section per kind of check. Example packs (examples/) are not listed: they belong to one app.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadChecks } from '../lib/load-checks.mjs'
import { MEERKAT_DIR } from '../lib/paths.mjs'
import { isAlone } from '../lib/runner.mjs'

const PACKS = ['security', 'hygiene', 'rust', 'ui', 'node', 'python', 'go', 'java', 'dotnet', 'php', 'ruby', 'swift', 'dart', 'web', 'docs', 'infra', 'terraform', 'kubernetes', 'performance', 'refactor', 'repo', 'a11y', 'security-plus', 'quality', 'ai']
const KINDS = [
  ['security', 'Security', 'Secrets, known-vulnerable dependencies, unsafe code, risky scripts and AI review.'],
  ['functionality', 'Functionality', 'Does it build, type-check, lint and pass its tests; is the repository in order.'],
  ['ui', 'UI', 'Pages and styles: accessibility basics and valid markup.'],
  ['performance', 'Performance', 'Size, start-up, memory, response time, load and build time, against budgets you set.'],
  ['refactor', 'Refactor', 'Is the code itself in good shape: duplicated code, dead code, files too long, circular imports.'],
]

const weightOf = (c) => (isAlone(c) ? 'alone' : (c.weight ?? ({ cargo: 'heavy', electron: 'medium', free: 'light' }[c.lane] ?? 'light')))
const time = (s) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${(s / 60).toFixed(s < 600 ? 1 : 0)} min`)
const esc = (t) => String(t).replace(/\|/g, '\\|')

const rows = []
for (const pack of PACKS) for (const c of await loadChecks(join(MEERKAT_DIR, 'packs', pack))) rows.push({ c, pack })

const count = (f) => rows.filter(f).length
const slug = (label) => label.toLowerCase()
const summary = `**${rows.length} checks** across ${PACKS.length} packs: ${count((r) => r.c.tier === 'fast')} quick, ${count((r) => r.c.tier === 'thorough')} thorough, ${count((r) => r.c.optIn)} opt-in. ` + KINDS.map(([k, label]) => `[${label} ${count((r) => r.c.group === k)}](#${slug(label)}-checks)`).join(' · ')

const sections = KINDS.map(([kind, label, about]) => {
  const mine = rows.filter((r) => r.c.group === kind).sort((a, b) => (a.c.tier === b.c.tier ? a.c.id.localeCompare(b.c.id) : a.c.tier === 'fast' ? -1 : 1))
  const lines = mine.map(({ c, pack }) => `| \`${c.id}\` | ${c.tier} | ${weightOf(c)} | ${time(c.estSeconds ?? 5)} | ${esc(c.title)}${c.optIn ? ` *(opt-in: \`--include ${c.optIn}\`)*` : ''}${c.install ? ` *(needs: ${esc(c.needs?.[0] ?? '')})*` : ''} | ${pack} |`)
  return [`### ${label} checks`, '', `${about} ${mine.length} checks.`, '', '| Check | Tier | Weight | Time | What it does | Pack |', '|---|---|---|---|---|---|', ...lines].join('\n')
})

const block = `<!-- checks:start -->\n${summary}\n\n${sections.join('\n\n')}\n<!-- checks:end -->`

const patch = (file) => {
  const text = readFileSync(join(MEERKAT_DIR, file), 'utf8')
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const re = /<!-- checks:start -->[\s\S]*?<!-- checks:end -->/
  if (!re.test(text)) throw new Error(`${file} has no checks markers`)
  writeFileSync(join(MEERKAT_DIR, file), text.replace(re, () => block.replace(/\n/g, nl)))
}
patch('README.md')
patch('docs/checks.md')
console.log(summary.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'))
