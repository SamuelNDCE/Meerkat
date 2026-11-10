// `meerkat guide [folder] [--base <ref>] [--json] [--explain <id>]`: the AI working guidelines checked against the current change.
// Advisory: it always exits 0 (2 for a usage error) and nothing else in Meerkat reads its result.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { GUIDELINES, byId, disabledIn, evaluate, gatherContext } from './guidelines.mjs'
import { gateFiles } from './gate.mjs'
import { logRoot, projectInfo } from './runlog.mjs'

const USAGE = 'usage: meerkat guide [folder] [--base <ref>] [--json] [--explain <id>]'

export function explainText(g) {
  return [`${g.id}`, `  rule: ${g.rule}`, `  why:  ${g.why}`, `  how:  ${g.how}`, `  fix:  ${g.fix}`].join('\n')
}

export function guideLines(results, { desc = '' } = {}) {
  const lines = []
  if (desc) lines.push(`Meerkat guide (advisory, ${desc}). Look up any rule: meerkat guide --explain <id>`)
  for (const r of results) {
    lines.push(`${r.status.padEnd(11)} ${r.id}  ${r.detail}`.trimEnd())
    if (r.status === 'ADVISORY') lines.push(`${'NEXT'.padEnd(11)} ${r.id}  ${r.fix}`)
  }
  const n = results.filter((r) => r.status === 'ADVISORY').length
  lines.push(`${n ? 'ADVISORY' : 'PASS'.padEnd(8)}    guide  ${n ? `${n} advisory finding${n === 1 ? '' : 's'} (exit code unchanged)` : 'no advisory findings'}`)
  return lines
}

export async function runGuide(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  let json = false, base = null, explain = null, folder = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--base' || a === '--explain') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) { err(`guide: ${a} needs a value. ${USAGE}`); return 2 }
      if (a === '--base') base = v
      else explain = v
    } else if (a.startsWith('-')) { err(`guide: unknown option ${a}. ${USAGE}`); return 2 }
    else if (folder === null) folder = a
    else { err(`guide: one folder at most. ${USAGE}`); return 2 }
  }
  if (explain !== null) {
    const g = byId(explain)
    if (!g) { err(`guide: no guideline called "${String(explain).slice(0, 60)}". Known: ${GUIDELINES.map((x) => x.id).join(', ')}`); return 2 }
    out(json ? JSON.stringify({ schema: 1, id: g.id, rule: g.rule, why: g.why, how: g.how, fix: g.fix }, null, 2) : explainText(g))
    return 0
  }
  const dir = resolve(cwd, folder ?? '.')
  const top = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const repo = top.status === 0 ? top.stdout.trim() : null
  let results, desc = ''
  const g = repo ? gateFiles(repo, { base }) : { error: `${dir} is not inside a git repository` }
  if (g.error) {
    results = GUIDELINES.map((x) => ({ id: x.id, status: 'NOT CHECKED', detail: g.error, fix: x.fix }))
  } else {
    desc = g.desc
    results = evaluate(gatherContext(repo, { files: g.files, base: g, env, folder: repo }), { disable: disabledIn(repo) })
  }
  const advisory = results.filter((r) => r.status === 'ADVISORY').length
  if (repo && !g.error) {
    try { // recorded beside the run logs (not in them, so it never counts as a run)
      const info = projectInfo(repo)
      const d = join(logRoot(env), 'guide')
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, `${info.id}.json`), JSON.stringify({ schema: 1, at: new Date().toISOString(), advisory, results }, null, 2))
    } catch { /* recording is best effort */ }
  }
  if (json) out(JSON.stringify({ schema: 1, advisory, comparing: desc || null, guidelines: results }, null, 2))
  else for (const l of guideLines(results, { desc })) out(l)
  return 0
}
