// Distinctness of the planted defects: each one should be its own bug, not a copy of another.
//   node tools/accuracy-distinct.mjs [--out <dir>]
// Prints one line per problem and a summary line `DISTINCT-TOTAL <n> duplicates, <m> near duplicates`. Always exits 0; the caller decides.
// Problems: DUPLICATE (same normalised planted line text as another defect), NEAR-DUPLICATE (same text once identifiers and numbers are
// removed, and the same check id), KEY-NOT-UNIQUE (two defects share the same id, which is project:key).
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateCorpus } from './accuracy-corpus.mjs'

const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'return', 'function', 'const', 'let', 'var', 'new', 'await', 'async', 'try', 'catch', 'def', 'import', 'from', 'class', 'throw', 'eval', 'exec', 'true', 'false', 'null', 'none', 'unsafe', 'fn', 'use'])

// Lowercase, collapse whitespace; the key (when it appears in the text) is dropped.
export function normalise(text, key = '') {
  let t = String(text ?? '').toLowerCase()
  // Only a whole key (a long dashed id such as js-eval), never a short fragment that happens to sit inside a word.
  if (key && String(key).length > 3) t = t.split(String(key).toLowerCase()).join(' ')
  return t.replace(/\s+/g, ' ').trim()
}

// The shape of a line: identifiers and numbers removed, so two lines that differ only by a name or a value look the same.
export function shape(text) {
  return normalise(text)
    .replace(/\b\d+(?:\.\d+)?\b/g, '')
    .replace(/[a-z_$][\w$]*/g, (w) => (KEYWORDS.has(w) ? w : ''))
    .replace(/\s+/g, ' ')
    .trim()
}

// planted: [{ id, key, project, check, file, line }]; textOf(p) returns the text of the planted line, or '' when unknown.
export function analyse(planted, textOf) {
  const lines = []
  let duplicates = 0
  let near = 0
  const rows = planted.map((p) => ({ p, text: normalise(textOf(p), p.key) }))
  const seenId = new Set()
  for (const { p } of rows) {
    const id = p.id ?? `${p.project}:${p.key}`
    if (seenId.has(id)) lines.push(`KEY-NOT-UNIQUE ${id}`)
    seenId.add(id)
  }
  const name = (r) => `${r.p.project}:${r.p.key}`
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]
      const b = rows[j]
      if (!a.text || !b.text) continue
      if (a.text === b.text) {
        duplicates++
        lines.push(`DUPLICATE ${name(a)} ${name(b)} "${a.text.slice(0, 80)}"`)
      } else if (a.p.check && a.p.check === b.p.check && shape(a.text) && shape(a.text) === shape(b.text)) {
        near++
        lines.push(`NEAR-DUPLICATE ${name(a)} ${name(b)} check=${a.p.check}`)
      }
    }
  }
  return { lines, duplicates, near }
}

// The text of the planted line, read from the written project. A defect with no line (history, file level) has no text.
export function lineReader(projects) {
  const cache = new Map()
  return (p) => {
    if (!(p.line > 0) || !p.file || !projects[p.project]) return ''
    const path = join(projects[p.project], p.file)
    if (!cache.has(path)) {
      try {
        cache.set(path, readFileSync(path, 'utf8').split('\n'))
      } catch {
        cache.set(path, [])
      }
    }
    return cache.get(path)[p.line - 1] ?? ''
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--out')
  const out = resolve(i >= 0 ? argv[i + 1] : mkdtempSync(join(tmpdir(), 'meerkat-distinct-')))
  const corpus = generateCorpus(out)
  const r = analyse(corpus.planted, lineReader(corpus.projects))
  for (const l of r.lines) console.log(l)
  console.log(`DISTINCT-TOTAL ${r.duplicates} duplicates, ${r.near} near duplicates`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
