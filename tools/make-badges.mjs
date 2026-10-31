// Draws the small labelled badges at the top of the README as plain SVG files (docs/images/badges/), so the repository has its own and
// they never depend on another site:   node tools/make-badges.mjs
// The check count is read from the checks themselves.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadChecks } from '../lib/load-checks.mjs'
import { MEERKAT_DIR } from '../lib/paths.mjs'

const PACKS = ['security', 'hygiene', 'rust', 'ui', 'node', 'python', 'go', 'java', 'dotnet', 'php', 'ruby', 'swift', 'dart', 'web', 'docs', 'infra', 'terraform', 'kubernetes', 'performance', 'refactor', 'ai']
let checks = 0
for (const p of PACKS) checks += (await loadChecks(join(MEERKAT_DIR, 'packs', p))).length

// label, value, colour of the value half
const BADGES = [
  ['licence', 'PCL 1.0', '#8a5cf5'],
  ['telemetry', 'none', '#2ea44f'],
  ['dependencies', 'zero', '#2ea44f'],
  ['node', '20+', '#3c873a'],
  ['checks', String(checks), '#1f6feb'],
  ['tested on', 'Windows 11', '#555e6b'],
]

const width = (text) => Math.round(text.length * 6.6 + 14)
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

mkdirSync(join(MEERKAT_DIR, 'docs', 'images', 'badges'), { recursive: true })
for (const [label, value, colour] of BADGES) {
  const a = width(label)
  const b = width(value)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${a + b}" height="22" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <title>${esc(label)}: ${esc(value)}</title>
  <clipPath id="r"><rect width="${a + b}" height="22" rx="4"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${a}" height="22" fill="#30363d"/>
    <rect x="${a}" width="${b}" height="22" fill="${colour}"/>
  </g>
  <g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${a / 2}" y="15">${esc(label)}</text>
    <text x="${a + b / 2}" y="15" font-weight="bold">${esc(value)}</text>
  </g>
</svg>
`
  writeFileSync(join(MEERKAT_DIR, 'docs', 'images', 'badges', `${label.replace(/\s+/g, '-')}.svg`), svg)
}
console.log(`${BADGES.length} badges written (${checks} checks)`)
