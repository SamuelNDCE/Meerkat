// Writes the list of every check into docs/checks.md and into the README between its markers, from the checks themselves, so the
// documentation cannot drift from the code:   node tools/gen-checks.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadChecks } from '../lib/load-checks.mjs'
import { MEERKAT_DIR } from '../lib/paths.mjs'
import { WEIGHTS, isAlone } from '../lib/runner.mjs'

const SOURCES = [['checks', 'built in (NeuralVault app)'], ...['rust', 'security', 'hygiene', 'performance', 'refactor', 'ai'].map((p) => [`packs/${p}`, p])]
const KIND = { security: 'Security', functionality: 'Functionality', ui: 'UI', performance: 'Performance', refactor: 'Refactor' }
const ORDER = Object.keys(KIND)

const weightOf = (c) => (isAlone(c) ? 'alone' : (c.weight ?? ({ cargo: 'heavy', electron: 'medium', free: 'light' }[c.lane] ?? 'light')))
const time = (s) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : `${(s / 60).toFixed(s < 600 ? 1 : 0)} min`)

const rows = []
for (const [dir, pack] of SOURCES) for (const c of await loadChecks(join(MEERKAT_DIR, dir))) rows.push({ c, pack })
rows.sort((a, b) => ORDER.indexOf(a.c.group) - ORDER.indexOf(b.c.group) || (a.c.tier === b.c.tier ? 0 : a.c.tier === 'fast' ? -1 : 1) || a.c.id.localeCompare(b.c.id))

const esc = (t) => String(t).replace(/\|/g, '\\|')
const line = ({ c, pack }) => `| \`${c.id}\` | ${KIND[c.group]} | ${c.tier} | ${weightOf(c)} | ${time(c.estSeconds ?? 5)} | ${esc(c.title)}${c.optIn ? ` (opt-in: \`--include ${c.optIn}\`)` : ''} | ${pack} |`
const table = ['| Check | Kind | Tier | Weight | Typical time | What it does | Comes from |', '|---|---|---|---|---|---|---|', ...rows.map(line)].join('\n')

const count = (f) => rows.filter(f).length
const summary = `**${rows.length} checks** (${count((r) => r.c.tier === 'fast')} fast, ${count((r) => r.c.tier === 'thorough')} thorough, ${count((r) => r.c.optIn)} opt-in). ` + ORDER.map((k) => `${KIND[k]} ${count((r) => r.c.group === k)}`).join(', ') + '.'

const block = `<!-- checks:start -->\n${summary}\n\n${table}\n<!-- checks:end -->`

const patch = (file, make) => {
  const text = readFileSync(join(MEERKAT_DIR, file), 'utf8')
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const re = /<!-- checks:start -->[\s\S]*?<!-- checks:end -->/
  if (!re.test(text)) throw new Error(`${file} has no checks markers`)
  writeFileSync(join(MEERKAT_DIR, file), text.replace(re, () => make().replace(/\n/g, nl)))
}
patch('README.md', () => block)
patch('docs/checks.md', () => block)
console.log(summary)
