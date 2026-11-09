// Output shapes for `meerkat verdict` beyond the default one line: --format markdown (a pull request comment), --format github (GitHub Actions workflow
// commands), the --since range line, the --strict wording and the JSON schema number. Pure functions of the verdict's counts and places; the verdict itself
// (lib/branchcmds.mjs) decides the pass or fail and the exit code, and nothing here changes either.
import { spawnSync } from 'node:child_process'

export const VERDICT_JSON_SCHEMA = 1
export const FORMATS = ['text', 'markdown', 'github']
export const MARKDOWN_ROWS = 20

const failing = (r) => r.kind === 'fail' || r.kind === 'crash'
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

// Every new blocking place as { file, line, check, message }, minus the ones a --known entry accepts. A failing check with no place is one row with no file.
export function blockingPlaces(out, entries = null) {
  const accepted = (id, p) => (entries ?? []).some((e) => e.check === id && e.file === p.file && (e.line === undefined || e.line === p.line))
  const list = []
  for (const r of out.rows ?? []) {
    if (!failing(r)) continue
    if (r.kind === 'fail' && r.places?.length && out.baseState === 'unfinished') continue // unclassified: not blocking
    if (!r.places?.length) {
      list.push({ file: '(no file)', line: 0, check: r.id, message: flat(r.detail || r.findings?.[0]?.message || r.id) })
      continue
    }
    for (const p of r.places) if (!accepted(r.id, p)) list.push({ file: p.file || '(no file)', line: p.line || 0, check: r.id, message: flat(p.message || r.detail || r.id) })
  }
  return list
}

// "meerkat verdict <the arguments as given>", quoting what needs it, so a comment can be copied and run.
export function rerunCommand(argv) {
  const q = (a) => (/^[\w@%+=:,./\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)
  return ['meerkat verdict', ...argv.map(q)].join(' ')
}

// { ref, range: "<ref>..HEAD", commits: n|null }. A count git cannot give is null, never a made-up number.
export function rangeInfo(repoRoot, ref) {
  const r = spawnSync('git', ['-C', repoRoot, 'rev-list', '--count', `${ref}..HEAD`], { encoding: 'utf8' })
  const n = r.status === 0 ? Number.parseInt(r.stdout.trim(), 10) : NaN
  return { ref, range: `${ref}..HEAD`, commits: Number.isInteger(n) ? n : null }
}
export const rangeLine = (info) => `compared ${info.range}: ${info.commits === null ? 'commit count unavailable (git rev-list failed)' : `${info.commits} commit${info.commits === 1 ? '' : 's'}`}`

// A table cell is plain text: every character markdown or HTML could act on is backslash-escaped, and newlines are already flattened by flat().
export const cell = (s) => flat(s).slice(0, 200).replace(/[\\`*_[\]()!<>#|&~]/g, '\\$&')
// A fenced block whose fence is longer than any backtick run inside it (at least three), so the text cannot close it early.
export function fenced(text) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) ?? []).map((m) => m.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return [fence, String(text), fence]
}

// The pull request comment body: the verdict line, one table of new blocking findings (at most 20 rows, then "and N more"), the pre-existing count, the re-run command.
export function markdownBody({ line, places, pre, rerun, range = null, base = null }) {
  const out = [`**Meerkat verdict: ${line}**`]
  if (base) out.push('', base)
  if (range) out.push('', rangeLine(range))
  if (places.length) {
    out.push('', '| File | Line | Check | Message |', '| --- | --- | --- | --- |')
    for (const p of places.slice(0, MARKDOWN_ROWS)) out.push(`| ${cell(p.file)} | ${p.line || ''} | ${cell(p.check)} | ${cell(p.message)} |`)
    if (places.length > MARKDOWN_ROWS) out.push('', `and ${places.length - MARKDOWN_ROWS} more`)
  }
  out.push('', `Pre-existing findings (not in this diff, do not block): ${pre}`, '', 'Re-run:', '', ...fenced(rerun))
  return out
}

// GitHub Actions workflow commands. Message and property text are escaped the way the runner reads them.
const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
export function githubLines({ line, places, range = null, base = null }) {
  const out = places.map((p) => `::error file=${escProp(p.file)}${p.line ? `,line=${p.line}` : ''},title=${escProp(p.check)}::${escData(p.message)}`)
  out.push(`::notice::${escData(line)}`)
  if (base) out.push(`::notice::${escData(base)}`)
  if (range) out.push(`::notice::${escData(rangeLine(range))}`)
  return out
}

// --strict: pre-existing findings count as blocking. The verdict line names STRICT either way.
export function strictLine({ blocking, pre }) {
  const total = blocking + pre
  return total > 0 ? `FAIL STRICT ${total} blocking (${blocking} new in changed files, ${pre} pre-existing)` : 'PASS STRICT'
}
