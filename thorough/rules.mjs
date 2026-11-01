// A small engine for DATA-DRIVEN sub-checks: a check script is a table of rules, and every rule is one sub-check.
//
//   const RULES = [
//     { id: 'no-debugger', title: 'a debugger statement is left in', ext: ['js', 'ts'], re: /\bdebugger\b/, bad: 'debugger', good: 'debug(x)' },
//     { id: 'merge-marker', title: 'a merge marker is left in', files: /\.(md|txt)$/, re: /^<{7} /, multiline: false, bad: '<<<<<<< HEAD', good: 'ok' },
//   ]
//   process.exitCode = scanRules('my-check', root, RULES, { allowFile: '.meerkat-my-allow' })
//
// Rule fields:
//   id        kebab-case, unique inside the table (becomes <suite>/<check>/<id>)
//   title     one plain sentence: what is wrong
//   ext       file extensions the rule reads (without the dot), or  files: a RegExp on the path. A rule with neither reads every text file.
//   re        a RegExp tested against each line (or against the whole file when `whole: true`)
//   test      alternative to re: (line, ctx) => boolean, ctx = { file, lines, index, text }
//   skipLine  optional RegExp: lines that match are skipped (comments, for example)
//   notIn     optional RegExp on the path: files to skip (tests, vendored code)
//   bad, good the proof: `bad` MUST be found by the rule and `good` MUST NOT (selfProve() checks every rule; a test calls it)
//   severity  optional: critical | high | medium | low | info; default is MEERKAT_DEFAULT_SEVERITY (set by the runner from the check, its kind and its suite), else medium
//   needs     optional (files: string[]) => boolean: the rule is NA (not applicable) when it returns false (default: NA when no file matched the rule's ext/files)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RULE_SEVERITY } from '../lib/findings.mjs'
import { configPath, finding, isTestFile, isText, readText, trackedFiles } from './kit.mjs'

const VENDORED = /(^|\/)(node_modules|vendor|dist|build|target|\.git|coverage|out|release)\//i
const MINIFIED = /\.min\.(js|css)$/i

const wants = (rule, file) => {
  if (rule.ext) return rule.ext.includes((file.split('.').pop() ?? '').toLowerCase())
  if (rule.files) return rule.files.test(file)
  return isText(file)
}

export function readAllow(root, allowFile) {
  const set = new Set()
  if (!allowFile) return set
  try {
    for (const l of readFileSync(configPath(root, allowFile), 'utf8').split(/\r?\n/)) {
      const t = l.trim()
      if (t && !t.startsWith('#')) set.add(t)
    }
  } catch {
    /* no allow file */
  }
  return set
}

function matches(rule, text, file, project) {
  const out = []
  if (rule.whole && rule.re) {
    if (rule.re.test(text)) out.push(1)
    return out
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (rule.skipLine && rule.skipLine.test(line)) continue
    const ctx = { file, lines, index: i, text, project }
    const hit = rule.test ? rule.test(line, ctx) : rule.re.test(line)
    // A rule may carry unless(line, ctx): the code around the hit already makes it safe (a QA-only block, a path checked just before).
    if (hit && !(rule.unless && rule.unless(line, ctx))) out.push(i + 1)
  }
  return out
}

// Runs every rule over the tracked files. Returns { found: [{rule, text}], na: [ids], files }.
export function evaluate(root, rules, { files = trackedFiles(root), allow = new Set(), read = (f) => readText(root, f) } = {}) {
  // Test code and QA probe scripts are not shipped; the rule tables are about what ships.
  const usable = files.filter((f) => !isTestFile(f) && !VENDORED.test(f) && !MINIFIED.test(f))
  const found = []
  const hits = [] // the same hits with file, line and severity, for the finding lines
  const na = []
  // Other files of the project, for a guard that must look beyond the file with the hit (read on demand).
  const project = { files: usable, read }
  for (const rule of rules) {
    const mine = usable.filter((f) => wants(rule, f) && !(rule.notIn && rule.notIn.test(f)))
    if (rule.needs ? !rule.needs(usable) : mine.length === 0) {
      na.push(rule.id)
      continue
    }
    for (const f of mine) {
      if (allow.has(`${rule.id} ${f}`) || allow.has(`${rule.id} *`)) continue
      const text = read(f)
      if (typeof text !== 'string') continue
      for (const n of matches(rule, text, f, project)) {
        found.push({ rule: rule.id, text: `${f}:${n} ${rule.title}` })
        hits.push({ rule: rule.id, file: f, line: n, title: rule.title, severity: rule.severity })
      }
    }
  }
  return { found, na, files: usable.length, hits }
}

// Prints one MEERKAT-SUB line per rule, then the findings; returns the exit code (0 pass, 1 findings).
export function scanRules(name, root, rules, { allowFile, okNote = 'nothing found' } = {}) {
  const { found, na, hits: located } = evaluate(root, rules, { allow: readAllow(root, allowFile) })
  const hit = new Map()
  for (const f of found) hit.set(f.rule, (hit.get(f.rule) ?? 0) + 1)
  for (const r of rules) {
    const reason = String(r.title ?? '').replace(/[\r\n]+/g, ' ').slice(0, 120)
    if (na.includes(r.id)) console.log(`MEERKAT-SUB NA ${r.id} ${reason}`)
    else if (hit.has(r.id)) console.log(`MEERKAT-SUB FAIL ${r.id} ${hit.get(r.id)} found: ${reason}`)
    else console.log(`MEERKAT-SUB PASS ${r.id} ${reason}`)
  }
  const fallback = ['critical', 'high', 'medium', 'low', 'info'].includes(process.env.MEERKAT_DEFAULT_SEVERITY) ? process.env.MEERKAT_DEFAULT_SEVERITY : 'medium'
  // One finding line per hit (lib/findings.mjs), alongside the usual output below.
  for (const f of located) finding(f.severity ?? RULE_SEVERITY[f.rule] ?? fallback, f.rule, f.file, f.line, f.title)
  if (!found.length) {
    console.log(`${name}: ${okNote}`)
    return 0
  }
  console.log(`${name}: found ${found.length}`)
  for (const f of found.slice(0, 25)) console.log(`  ${f.text}`)
  if (found.length > 25) console.log(`  ... and ${found.length - 25} more`)
  return 1
}

// The proof every rule carries: its `bad` sample is found, its `good` sample is not. Returns a list of problems (empty = every rule proven).
export function selfProve(rules) {
  const problems = []
  const seen = new Set()
  for (const r of rules) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(r.id ?? '')) problems.push(`bad id "${r.id}"`)
    if (seen.has(r.id)) problems.push(`duplicate id "${r.id}"`)
    seen.add(r.id)
    if (!r.title || r.title.length < 8) problems.push(`${r.id}: missing title`)
    if (typeof r.bad !== 'string' || typeof r.good !== 'string') {
      problems.push(`${r.id}: needs bad and good samples`)
      continue
    }
    const file = r.sample ?? `sample.${r.ext?.[0] ?? 'txt'}`
    if (matches(r, r.bad, file).length === 0) problems.push(`${r.id}: its bad sample is not found`)
    if (matches(r, r.good, file).length !== 0) problems.push(`${r.id}: its good sample is found (false positive)`)
  }
  return problems
}
