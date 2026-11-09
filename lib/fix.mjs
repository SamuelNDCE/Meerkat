// `meerkat fix [<finding-id>] [--dry-run] [--apply] [--run <dir>] [--app <dir>]`: a patch for the findings a check can fix safely.
//   - Only a finding whose check has a rule in lib/fixrules.mjs (or whose finding carries a `fix` object { from, to }) gets a patch.
//   - Everything else prints "no automatic fix: <reason>" and the command exits 2. Nothing is guessed.
//   - --dry-run (the default) prints the unified diff and changes nothing.
//   - --apply writes it, but only when the line the finding was made from is unchanged (sha256 of the saved evidence against the file now).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { FIX_RULES } from './fixrules.mjs'
import { readFindings } from './findingsdoc.mjs'
import { missingFindingsText } from './findingsread.mjs'
import { latestRunDir, usedRunLine } from './runlog.mjs'

const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const flagValue = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const VALUE_FLAGS = ['--run', '--app']

// The file of a finding on disk: the project folder the run was made in, then each folder above it up to the git root.
function locate(doc, folder, file) {
  const roots = [doc?.run?.project?.path, folder].filter(Boolean)
  for (const r of roots) {
    let dir = resolve(r)
    for (let i = 0; i < 6; i++) {
      const cand = isAbsolute(file) ? file : join(dir, file)
      if (existsSync(cand)) return cand
      if (isAbsolute(file) || existsSync(join(dir, '.git'))) break
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return null
}

// Splits a file into lines keeping each line's own ending, so a rewrite never changes line endings elsewhere.
const splitKeep = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

// A unified diff for a set of single-line replacements in one file. changes: [{ line (1-based), to }].
export function unifiedDiff(rel, text, changes, context = 2) {
  const lines = splitKeep(text)
  const body = (l) => l.replace(/\r?\n$/, '')
  const sorted = [...changes].sort((a, b) => a.line - b.line)
  const hunks = []
  for (const c of sorted) {
    const lo = Math.max(1, c.line - context)
    const hi = Math.min(lines.length, c.line + context)
    const last = hunks[hunks.length - 1]
    if (last && lo <= last.hi + 1) {
      last.hi = Math.max(last.hi, hi)
      last.changes.push(c)
    } else hunks.push({ lo, hi, changes: [c] })
  }
  const out = [`--- a/${rel}`, `+++ b/${rel}`]
  for (const h of hunks) {
    out.push(`@@ -${h.lo},${h.hi - h.lo + 1} +${h.lo},${h.hi - h.lo + 1} @@`)
    for (let n = h.lo; n <= h.hi; n++) {
      const c = h.changes.find((x) => x.line === n)
      if (c) out.push(`-${body(lines[n - 1])}`, `+${c.to}`)
      else out.push(` ${body(lines[n - 1])}`)
    }
  }
  return out.join('\n')
}

// Proposes the patch for one finding. Returns { ok:true, file, rel, line, from, to, text, abs, abort? } or { ok:false, reason }.
export function proposeFix(f, doc, folder) {
  if (!f.file || !f.line) return { ok: false, reason: 'the finding has no file and line to change' }
  const abs = locate(doc, folder, f.file)
  if (!abs) return { ok: false, reason: `the file ${f.file} is not on disk where the run was made` }
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch (e) {
    return { ok: false, reason: `the file ${f.file} could not be read (${String(e?.code ?? e)})` }
  }
  const lines = splitKeep(text)
  const current = (lines[f.line - 1] ?? '').replace(/\r?\n$/, '')
  // The hash check: the line must still be exactly what the finding was made from. A finding with no saved evidence cannot be checked, so it is not fixed.
  if (!f.evidence) return { ok: false, reason: 'the run saved no source line for this finding, so the file cannot be checked against it' }
  if (sha(current.trim()) !== sha(String(f.evidence).trim())) return { ok: false, stale: true, reason: `${f.file}:${f.line} changed since the run (hash of the line differs from the finding's evidence); run meerkat again first` }
  let to
  if (f.fix && typeof f.fix === 'object') {
    if (typeof f.fix.from !== 'string' || typeof f.fix.to !== 'string' || !f.fix.from) return { ok: false, reason: 'the finding carries a fix object without exact from/to text' }
    if (current.split(f.fix.from).length !== 2) return { ok: false, reason: 'the fix text does not occur exactly once on that line' }
    to = current.replace(f.fix.from, () => f.fix.to)
  } else {
    const rule = FIX_RULES[f.check]
    if (!rule) return { ok: false, reason: `the check ${f.check} has no safe fix rule` }
    const r = rule({ line: current, text, file: f.file })
    if (!r.to) return { ok: false, reason: r.reason ?? 'the rule could not make a safe change' }
    to = r.to
  }
  if (to === current) return { ok: false, reason: 'the change would leave the line as it is' }
  return { ok: true, abs, rel: String(f.file).replace(/\\/g, '/'), line: f.line, from: current, to, text }
}

export function runFix(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const apply = argv.includes('--apply')
  if (apply && argv.includes('--dry-run')) {
    err('meerkat fix: --apply and --dry-run contradict each other; pick one')
    return 2
  }
  const bad = argv.find((a, i) => a.startsWith('--') && !['--apply', '--dry-run', ...VALUE_FLAGS].includes(a) && !VALUE_FLAGS.includes(argv[i - 1]))
  if (bad) {
    err(`meerkat fix: unknown option ${bad}. usage: meerkat fix [<finding-id>] [--dry-run] [--apply] [--run <dir>] [--app <dir>]`)
    return 2
  }
  const id = argv.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]))
  const folder = resolve(cwd, flagValue(argv, '--app') ?? '.')
  const runDir = flagValue(argv, '--run') ? resolve(cwd, flagValue(argv, '--run')) : latestRunDir(env, folder)
  if (!runDir) {
    err(`meerkat fix: there is no run for ${folder} yet. next: run meerkat verify there first`)
    return 2
  }
  const doc = readFindings(runDir)
  if (!doc) {
    err(`meerkat fix: ${missingFindingsText(runDir)}`)
    return 2
  }
  out(usedRunLine(runDir))
  let list = doc.findings ?? []
  if (id) {
    list = list.filter((f) => f.id === id || (id.length >= 4 && f.id.startsWith(id)))
    if (list.length !== 1) {
      err(list.length ? `meerkat fix: "${id}" matches ${list.length} findings; use more characters` : `meerkat fix: no finding with id ${id} in this run (meerkat findings lists them)`)
      return 2
    }
  }
  list = list.filter((f) => f.file)
  if (!list.length) {
    out('no findings with a file to fix in this run')
    return 0
  }
  out(`checking ${list.length} finding(s) for a safe automatic fix ...`)
  const planned = []
  let refused = 0
  for (const f of list) {
    const p = proposeFix(f, doc, folder)
    const short = String(f.id).slice(0, 8)
    if (p.ok) planned.push({ f, p })
    else {
      refused++
      out(p.stale ? `${short} refused: ${p.reason}` : `${short} ${f.file}:${f.line ?? '-'} no automatic fix: ${p.reason}`)
    }
  }
  if (!planned.length) return 2
  // Several changes in one file are applied together; every one has already passed its own hash check against the same text.
  const byFile = new Map()
  for (const x of planned) {
    const g = byFile.get(x.p.abs) ?? { text: x.p.text, rel: x.p.rel, changes: [], ids: [] }
    g.changes.push({ line: x.p.line, to: x.p.to })
    g.ids.push(String(x.f.id).slice(0, 8))
    byFile.set(x.p.abs, g)
  }
  for (const [abs, g] of byFile) {
    out(unifiedDiff(g.rel, g.text, g.changes))
    if (!apply) continue
    // Read again right before writing: a change since the check above stops the write.
    let now
    try {
      now = readFileSync(abs, 'utf8')
    } catch (e) {
      err(`${g.rel}: refused, could not read it again (${String(e?.code ?? e)})`)
      return 2
    }
    if (sha(now) !== sha(g.text)) {
      err(`${g.rel}: refused, the file changed while the fix was prepared`)
      return 2
    }
    const lines = splitKeep(now)
    for (const c of g.changes) {
      const eol = (lines[c.line - 1] ?? '').match(/\r?\n$/)?.[0] ?? ''
      lines[c.line - 1] = c.to + eol
    }
    writeFileSync(abs, lines.join(''))
    out(`applied ${g.changes.length} change(s) to ${g.rel} (${g.ids.join(', ')}). next: meerkat verify to confirm the finding is gone`)
  }
  if (!apply) out(`dry run: nothing was changed. next: meerkat fix${id ? ` ${id}` : ''} --apply`)
  return refused && id ? 2 : 0
}
