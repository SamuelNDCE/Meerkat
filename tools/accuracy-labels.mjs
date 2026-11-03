// Two-layer labels for every planted defect: impact (how bad if real) and difficulty (how hard to find).
// Fragments live in tools/accuracy-tier-fragments/*.txt, tab separated, one key per line, in either layout:
//   key <TAB> impact <TAB> difficulty
//   key <TAB> (empty) <TAB> impact <TAB> difficulty
// Blank lines and lines starting with # are ignored. Any bad value, duplicate key or missing label throws.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const IMPACTS = ['critical', 'high', 'medium', 'low']
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme']
export const FRAGMENT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'accuracy-tier-fragments')

// Parse fragment text. `name` is used in error messages. Adds to `into` (a Map) and throws on a duplicate key.
export function parseFragment(text, name, into = new Map()) {
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const cols = raw.replace(/\r$/, '').split('\t').map((c) => c.trim())
    let key, impact, difficulty
    if (cols.length === 3) [key, impact, difficulty] = cols
    else if (cols.length === 4 && cols[1] === '') [key, , impact, difficulty] = cols
    else throw new Error(`${name}:${i + 1}: expected "key, impact, difficulty" or "key, <empty>, impact, difficulty", got ${cols.length} columns`)
    if (!key) throw new Error(`${name}:${i + 1}: empty key`)
    if (!IMPACTS.includes(impact)) throw new Error(`${name}:${i + 1}: unknown impact "${impact}" for ${key} (allowed: ${IMPACTS.join(', ')})`)
    if (!DIFFICULTIES.includes(difficulty)) throw new Error(`${name}:${i + 1}: unknown difficulty "${difficulty}" for ${key} (allowed: ${DIFFICULTIES.join(', ')})`)
    if (into.has(key)) throw new Error(`${name}:${i + 1}: key ${key} is listed twice (first in ${into.get(key).source})`)
    into.set(key, { impact, difficulty, source: name })
  })
  return into
}

// Read every *.txt fragment in `dir` (sorted by name). Returns Map key -> { impact, difficulty }.
export function loadLabels(dir = FRAGMENT_DIR) {
  const out = new Map()
  if (!existsSync(dir)) throw new Error(`label fragment folder not found: ${dir}`)
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.txt')).sort()) parseFragment(readFileSync(join(dir, f), 'utf8'), f, out)
  return new Map([...out].map(([k, v]) => [k, { impact: v.impact, difficulty: v.difficulty }]))
}

// Keys in `planted` ([{key}]) that have no label. Throws when `strict`, otherwise returns the list.
export function missingLabels(planted, labels, strict = false) {
  const missing = [...new Set(planted.filter((p) => !labels.has(p.key)).map((p) => p.key))]
  if (strict && missing.length) throw new Error(`planted keys with no label: ${missing.join(', ')}`)
  return missing
}

// Recall by impact, by difficulty, and the impact x difficulty cross-tab. Unlabelled keys are counted under UNLABELLED.
// `planted` rows need { key, detected }.
export function labelStats(planted, labels, plantedOnly = false) {
  const mk = () => ({ planted: 0, detected: 0 })
  const byImpact = {}
  const byDifficulty = {}
  const cross = {}
  for (const i of [...IMPACTS, 'UNLABELLED']) {
    byImpact[i] = mk()
    cross[i] = {}
    for (const d of [...DIFFICULTIES, 'UNLABELLED']) cross[i][d] = mk()
  }
  for (const d of [...DIFFICULTIES, 'UNLABELLED']) byDifficulty[d] = mk()
  let unlabelled = 0
  for (const p of planted) {
    const l = labels.get(p.key)
    const i = l ? l.impact : 'UNLABELLED'
    const d = l ? l.difficulty : 'UNLABELLED'
    if (!l) unlabelled++
    for (const c of [byImpact[i], byDifficulty[d], cross[i][d]]) {
      c.planted++
      if (p.detected) c.detected++
    }
  }
  return { byImpact, byDifficulty, cross, unlabelled, total: planted.length, plantedOnly }
}

const cell = (s, c) => (s.plantedOnly ? `${c.planted}` : `${c.detected}/${c.planted}`)
const pct = (c) => (c.planted ? `${((c.detected / c.planted) * 100).toFixed(1)}%` : '-')

export function impactTable(s) {
  const lines = ['| Impact | Planted | Detected | Recall |', '| --- | ---: | ---: | ---: |']
  for (const [k, c] of Object.entries(s.byImpact)) if (k !== 'UNLABELLED' || c.planted) lines.push(`| ${k} | ${c.planted} | ${s.plantedOnly ? '-' : c.detected} | ${s.plantedOnly ? '-' : pct(c)} |`)
  return lines.join('\n')
}

export function difficultyTable(s) {
  const lines = ['| Difficulty | Planted | Detected | Recall |', '| --- | ---: | ---: | ---: |']
  for (const [k, c] of Object.entries(s.byDifficulty)) if (k !== 'UNLABELLED' || c.planted) lines.push(`| ${k} | ${c.planted} | ${s.plantedOnly ? '-' : c.detected} | ${s.plantedOnly ? '-' : pct(c)} |`)
  return lines.join('\n')
}

// Cells read "detected/planted". Rows are impact, columns are difficulty.
export function crossTab(s) {
  const cols = [...DIFFICULTIES, ...(s.unlabelled ? ['UNLABELLED'] : [])]
  const rows = [...IMPACTS, ...(s.unlabelled ? ['UNLABELLED'] : [])]
  const lines = [`| Impact / Difficulty | ${cols.join(' | ')} | all |`, `| --- | ${cols.map(() => '---:').join(' | ')} | ---: |`]
  for (const r of rows) lines.push(`| ${r} | ${cols.map((c) => `${cell(s, s.cross[r][c])}`).join(' | ')} | ${cell(s, s.byImpact[r])} |`)
  lines.push(`| **all** | ${cols.map((c) => `${cell(s, s.byDifficulty[c])}`).join(' | ')} | ${s.plantedOnly ? s.total : `${Object.values(s.byImpact).reduce((a, c) => a + c.detected, 0)}/${s.total}`} |`)
  return lines.join('\n')
}

export function labelReport(planted, labels, plantedOnly = false) {
  const s = labelStats(planted, labels, plantedOnly)
  const out = [`\nRecall by impact\n\n${impactTable(s)}`, `\nRecall by difficulty\n\n${difficultyTable(s)}`, `\nImpact by difficulty (${plantedOnly ? 'planted only, no run' : 'detected/planted'})\n\n${crossTab(s)}`]
  out.push(`\nUNLABELLED ${s.unlabelled}`)
  for (const k of missingLabels(planted, labels)) out.push(`UNLABELLED ${k}`)
  return out.join('\n')
}
