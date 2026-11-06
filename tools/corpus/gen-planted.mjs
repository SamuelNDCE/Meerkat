#!/usr/bin/env node
// Planted-defect corpus generator. For every rule of the data-driven checks (code-patterns, client-frameworks, electron-plus, rust-plus) it
// writes N variants of the rule's known-bad sample and the matching known-good twin, plus a manifest. Deterministic from --seed.
//
//   node tools/corpus/gen-planted.mjs [--out corpus/planted] [--seed 20261106] [--per-rule 4]
//
// Layout: <out>/<defect-id>/bad/<file> and <out>/<defect-id>/good/<file>, and <out>/manifest.json (one entry per defect:
// id, check, script, family, rule, file, line, description, ops, base, twin). `base` names the complete clean project (tools/corpus/base-project.mjs)
// the measurement writes the file into; the corpus folder itself holds only the planted file and its clean twin.
// Variants are built from the rule's own bad/good samples with changes that keep the defect a defect: harmless surrounding code,
// indentation, line endings and renamed local variables. Variant 0 is the sample unchanged (it is what the check's selfTest already proves),
// so the measurement reports it apart from the varied ones.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { baseFor } from './base-project.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const OUT = resolve(arg('out', join(REPO, 'corpus', 'planted')))
const SEED = Number(arg('seed', '20261106'))
const PER_RULE = Number(arg('per-rule', '4'))

// The scripts and tables the corpus covers: [family, script in thorough/, rules module].
const SOURCES = [
  ['code-patterns', 'code-patterns.mjs', 'rules-code-patterns.mjs'],
  ['client-frameworks', 'client-frameworks.mjs', 'rules-client-frameworks.mjs'],
  ['electron-plus', 'electron-plus.mjs', 'rules-electron-plus.mjs'],
  ['rust-plus', 'rust-plus.mjs', 'rules-rust-plus.mjs'],
]

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)
const pick = (r, list) => list[Math.floor(r() * list.length)]

// Harmless filler per extension: line comment prefix. Unknown types get no filler (json has no comments).
const COMMENT = { py: '#', rb: '#', toml: '#', yml: '#', yaml: '#', sh: '#', js: '//', jsx: '//', ts: '//', tsx: '//', mjs: '//', cjs: '//', go: '//', rs: '//', java: '//', cs: '//', php: '//', gradle: '//', kt: '//', swift: '//' }
const NOTES = ['keep this in step with the handler below', 'reviewed by the platform team', 'tracked in the backlog', 'used by the nightly job', 'do not reorder these', 'legacy path, kept for older clients', 'see the design note for why', 'limits are set in the config']
const DECLS = {
  py: (n) => `LIMIT_${n} = ${10 + n}`,
  rb: (n) => `LIMIT_${n} = ${10 + n}`,
  js: (n) => `const LIMIT_${n} = ${10 + n}`,
  ts: (n) => `const LIMIT_${n}: number = ${10 + n}`,
  go: (n) => `const limit${n} = ${10 + n}`,
  rs: (n) => `const LIMIT_${n}: u32 = ${10 + n};`,
  php: (n) => `$limit${n} = ${10 + n};`,
}
const FAMILY_OF = { jsx: 'js', mjs: 'js', cjs: 'js', tsx: 'ts' }
const SENSITIVE_FIRST = /^(package\s|<\?php|#!|<!doctype|<\?xml|---|\[|\{|using\s|namespace\s|import\s|use\s|"use strict"|'use strict')/i
const INDENTABLE = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'go', 'rs', 'java', 'cs', 'php', 'rb'])
const NAME_POOL = {
  user: ['account', 'member', 'visitor', 'caller'],
  userInput: ['rawInput', 'untrusted', 'formValue', 'clientText'],
  input: ['payload', 'incoming', 'rawValue', 'param'],
  cmd: ['command', 'job', 'action', 'step'],
  name: ['label', 'title', 'handle', 'entry'],
  data: ['content', 'blob', 'records', 'bytes'],
  path: ['target', 'location', 'dest', 'where'],
  query: ['search', 'term', 'filter', 'lookup'],
  body: ['message', 'text', 'doc', 'request_body'],
  value: ['amount', 'item', 'setting', 'field'],
  token: ['ticket', 'grant', 'credential_id', 'session_id'],
  url: ['endpoint', 'address', 'link', 'target_url'],
  host: ['server', 'machine', 'node', 'peer'],
  file: ['document', 'upload', 'attachment', 'asset'],
  filename: ['docname', 'upname', 'outname', 'leaf'],
  payload: ['packet', 'envelope', 'frame', 'chunk'],
  arg: ['option', 'flag', 'operand', 'parameter'],
  args: ['options', 'flags', 'operands', 'params'],
  req: ['request', 'incoming_req', 'httpreq', 'call'],
  res: ['response', 'reply', 'outgoing', 'result'],
  x: ['item', 'val', 'elem', 'cell'],
  s: ['text', 'str', 'line', 'chunk'],
}

function applyRenames(r, rule, bad, good) {
  const guard = `${rule.re?.source ?? ''} ${rule.test?.toString() ?? ''} ${rule.unless?.toString() ?? ''} ${rule.skipLine?.source ?? ''}`
  const map = {}
  for (const [from, to] of Object.entries(NAME_POOL)) {
    if (!new RegExp(`\\b${from}\\b`).test(bad) || new RegExp(`\\b${from}\\b`).test(guard)) continue
    // Only rename a name the sample uses as its own variable: assigned at the start of a statement, and not a property, call or keyword argument.
    if (new RegExp(`[.:]${from}\\b|\\b${from}\\s*\\(|['"\`]\\w*${from}\\w*['"\`]|[(,]\\s*${from}\\s*=[^=]`).test(bad + good)) continue
    if (!new RegExp(`^\\s*(?:(?:const|let|var|final|mut|auto|my|val)\\s+|[A-Za-z_][\\w<>\\[\\]]*\\s+)?\\$?${from}\\s*(?::=|=[^=])`, 'm').test(bad)) continue
    map[from] = pick(r, to)
  }
  const sub = (t) => Object.entries(map).reduce((acc, [f, t2]) => acc.replace(new RegExp(`\\b${f}\\b`, 'g'), t2), t)
  return { bad: sub(bad), good: sub(good), map }
}

function filler(ext, r, count, which) {
  const kind = FAMILY_OF[ext] ?? ext
  const c = COMMENT[ext]
  if (!c) return []
  const lines = []
  for (let i = 0; i < count; i++) {
    const n = Math.floor(r() * 90)
    if (DECLS[kind] && r() < 0.5) lines.push(DECLS[kind](n + i))
    else lines.push(`${c} ${pick(r, NOTES)} (${which}${n})`)
  }
  return lines
}

function build(ext, text, ops, r, noIndent = false) {
  let lines = text.split('\n')
  let trailingNl = false
  if (lines[lines.length - 1] === '') {
    lines.pop()
    trailingNl = true
  }
  if (ops.indent && INDENTABLE.has(ext) && !noIndent) {
    const pad = ops.indent === 'tab' ? '\t' : ' '.repeat(ops.indent)
    lines = lines.map((l) => (l ? pad + l : l))
  }
  let offset = 0
  if (ops.prefix) {
    const f = filler(ext, r, ops.prefix, 'p')
    if (f.length) {
      const keepFirst = lines.length && SENSITIVE_FIRST.test(lines[0].trim()) ? 1 : 0
      lines = [...lines.slice(0, keepFirst), ...f, ...lines.slice(keepFirst)]
      offset = f.length
    }
  }
  if (ops.suffix) lines = [...lines, ...filler(ext, r, ops.suffix, 's')]
  let out = lines.join('\n') + (trailingNl ? '\n' : '')
  if (ops.crlf) out = out.replace(/\n/g, '\r\n')
  return { text: out, offset }
}

const VARIANTS = [
  () => ({}),
  () => ({ prefix: 2, rename: true }),
  () => ({ suffix: 3, crlf: true }),
  () => ({ indent: 2, prefix: 1, suffix: 1 }),
  () => ({ rename: true, indent: 4, prefix: 3 }),
  () => ({ indent: 'tab', suffix: 2, rename: true }),
  () => ({ prefix: 4, suffix: 4, crlf: true, rename: true }),
]
const BASENAMES = ['app', 'server', 'index', 'handler', 'util', 'service', 'main', 'worker', 'client', 'routes', 'loader', 'tasks']
const DIRS = ['', 'src/', 'lib/', 'src/core/', 'app/', 'pkg/']

// Files a rule needs beside its sample (the rule's own `needs` test is about the whole project): path -> content.
const COMPANIONS = { 'rcargo-no-lockfile-binary': { 'src/main.rs': 'fn main() {}\n' } }

const defaultPath = (rule) => {
  if (rule.sample) return { path: rule.sample, fixed: true }
  if (rule.files) return { path: 'src/lib.rs', fixed: true }
  return { path: `sample.${(rule.ext ?? ['txt'])[0]}`, fixed: false }
}

const manifest = []
let duplicates = 0
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
let skipped = 0
for (const [family, script, mod] of SOURCES) {
  const m = await import(pathToFileURL(join(REPO, 'thorough', mod)).href)
  for (const [check, table] of Object.entries(m.CHECK_TABLES)) {
    for (const rule of table) {
      if (typeof rule.bad !== 'string' || typeof rule.good !== 'string') {
        skipped++
        continue
      }
      const seen = new Set() // a variant that changes nothing (a json file takes no filler) would only repeat variant 0
      const base = defaultPath(rule)
      const ext = (base.path.split('.').pop() ?? '').toLowerCase()
      for (let v = 0; v < Math.min(PER_RULE, VARIANTS.length); v++) {
        const r = rng(SEED ^ hash(`${check}/${rule.id}/${v}`))
        const ops = VARIANTS[v]()
        const renamed = ops.rename ? applyRenames(r, rule, rule.bad, rule.good) : { bad: rule.bad, good: rule.good, map: {} }
        // A rule anchored at column 0 (^ not followed by \s) cannot see an indented line, so that variant is not indented.
        const noIndent = /^\^(?!\\s)/.test(rule.re?.source ?? '')
        const bad = build(ext, renamed.bad, ops, rng(SEED ^ hash(`f/${check}/${rule.id}/${v}`)), noIndent)
        const good = build(ext, renamed.good, ops, rng(SEED ^ hash(`f/${check}/${rule.id}/${v}`)), noIndent)
        let file = base.path
        if (!base.fixed && v > 0) file = `${pick(r, DIRS)}${pick(r, BASENAMES)}.${ext}`
        const sig = `${file}\0${bad.text}\0${good.text}`
        if (seen.has(sig)) {
          duplicates++
          continue
        }
        seen.add(sig)
        const id = `${check}.${rule.id}.v${v}`
        const dir = join(OUT, id)
        const companions = COMPANIONS[rule.id] ?? {}
        for (const [side, t] of [['bad', bad.text], ['good', good.text]]) {
          for (const [cp, ct] of [[file, t], ...Object.entries(companions)]) {
            const p = join(dir, side, ...cp.split('/'))
            mkdirSync(dirname(p), { recursive: true })
            writeFileSync(p, ct)
          }
        }
        const opNames = Object.entries(ops).filter(([, x]) => x).map(([k, x]) => (x === true ? k : `${k}=${x}`))
        const renames = Object.entries(renamed.map).map(([a, b]) => `${a}->${b}`)
        manifest.push({
          id,
          check,
          script,
          family,
          rule: rule.id,
          file,
          line: bad.offset + 1,
          description: `${String(rule.title).replace(/\.$/, '')} (variant ${v}${opNames.length ? ': ' + opNames.join(', ') : ': sample as written'}${renames.length ? '; renamed ' + renames.join(', ') : ''}).`,
          ops: opNames,
          canonical: v === 0,
          severity: rule.severity ?? null,
          base: baseFor(family, file),
          ...(Object.keys(companions).length ? { companions: Object.keys(companions) } : {}),
          defect: `${id}/bad/${file}`,
          twin: `${id}/good/${file}`,
        })
      }
    }
  }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ seed: SEED, perRule: PER_RULE, defects: manifest }, null, 1) + '\n')
const byFam = {}
for (const d of manifest) byFam[d.family] = (byFam[d.family] ?? 0) + 1
console.log(`wrote ${manifest.length} defects (${skipped} rules without a bad/good pair skipped, ${duplicates} variants dropped as identical to an earlier one)`, byFam)
