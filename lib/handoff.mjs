// `meerkat handoff [folder] [--base <ref>] [--out <file>]` writes one short markdown file a session can resume from;
// `meerkat handoff --read <file>` prints its header and the next command.
// The verdict is the same gate result `meerkat verdict` uses (gatherGate): nothing here starts a check of its own, and no existing command calls this module.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { topRows, verdictCounts, verdictLine } from './branchcmds.mjs'
import { gatherGate } from './gate.mjs'
import { latestRunDir, logRoot, pathHash } from './runlog.mjs'

const MAX_LINES = 60
const git = (dir, args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
const one = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
const quote = (p) => (/[\s"']/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p)

// The pieces of a handoff file, as lines. Kept under MAX_LINES by construction (five findings at most).
export function handoffLines({ verdict, branch, commit, base, folder, open, places, command, when }) {
  const lines = [
    '# Meerkat handoff',
    '',
    `- verdict: ${verdict}`,
    `- branch: ${branch}`,
    `- commit: ${commit}`,
    `- base: ${base}`,
    `- project: ${folder}`,
    `- written: ${when}`,
    '',
    `## Open findings in changed files: ${open}`,
    '',
  ]
  if (!places.length) lines.push('None.')
  else for (const p of places.slice(0, 5)) lines.push(`- ${p.file}${p.line ? `:${p.line}` : ''} ${p.check}: ${one(p.message).slice(0, 110)}`)
  if (open > 5) lines.push(`- ... and ${open - 5} more (meerkat top --base ${base} lists all)`)
  lines.push('', '## Next command', '', '```', command, '```', '', 'Re-run it after any change; it prints the verdict again. Meerkat reads code and cannot see whether tests passed.')
  return lines.slice(0, MAX_LINES)
}

// `--read`: the header (up to the first blank line after the bullets) and the next command.
export function readHandoff(file, out, err) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    err(`meerkat handoff: cannot read ${file} (${e?.code === 'ENOENT' ? 'it does not exist' : String(e?.code ?? e)}). next: meerkat handoff --out ${file}`)
    return 2
  }
  const lines = text.split(/\r?\n/)
  if (lines[0] !== '# Meerkat handoff') {
    err(`meerkat handoff: ${file} is not a Meerkat handoff file (its first line is not "# Meerkat handoff")`)
    return 2
  }
  const at = lines.indexOf('## Next command')
  const fence = at >= 0 ? lines.indexOf('```', at) : -1
  const cmd = fence >= 0 ? lines[fence + 1] : null
  if (!cmd) {
    err(`meerkat handoff: ${file} has no "Next command" section`)
    return 2
  }
  for (const l of lines.slice(0, 9)) if (l.startsWith('- ')) out(l.slice(2))
  out(`next command: ${cmd}`)
  return 0
}

export async function runHandoff(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  let base = null
  let outFile = null
  let readFile = null
  let folderArg = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') base = argv[++i] ?? ''
    else if (a === '--out') outFile = argv[++i] ?? ''
    else if (a === '--read') readFile = argv[++i] ?? ''
    else if (a.startsWith('-')) {
      err(`meerkat handoff: unknown option ${a}. usage: meerkat handoff [folder] [--base <ref>] [--out <file>] | --read <file>`)
      return 2
    } else folderArg ??= a
  }
  if (readFile !== null) return readHandoff(resolve(cwd, readFile || '.'), out, err)
  if (base === '' || outFile === '') {
    err(`meerkat handoff: ${base === '' ? '--base' : '--out'} needs a value`)
    return 2
  }
  const folder = resolve(cwd, folderArg ?? '.')
  err('meerkat handoff: running the gate for the verdict (the same one meerkat verdict uses) ...')
  let g
  const t0 = Date.now()
  try {
    g = await gatherGate([folder, ...(base ? ['--base', base] : [])], { env, cwd, err, progress: err, maxSeconds: Number(env.MEERKAT_VERDICT_TIMEOUT_S) > 0 ? Number(env.MEERKAT_VERDICT_TIMEOUT_S) : 300 })
  } catch (e) {
    err(`meerkat handoff: the gate failed to run (${one(e?.message).slice(0, 120)}). next: meerkat gate --no-input shows the full error`)
    return 1
  }
  if (g.error) {
    err(`meerkat handoff: ${g.error.slice(0, 200)}. next: pass a base that exists, for example --base origin/main`)
    return 2
  }
  if (g.out?.stoppedEarly) {
    err('meerkat handoff: the gate stopped early, so there is no complete verdict to hand over. next: meerkat verdict')
    return 1
  }
  const gateMs = Date.now() - t0
  const t1 = Date.now()
  const root = g.repoRoot ?? folder
  const verdict = verdictLine(verdictCounts(g.out))
  const rows = topRows(g.out, g.checks)
  const ref = base ?? g.changed?.ref ?? 'main'
  const branch = one(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout) || '(unknown)'
  const commit = one(git(root, ['rev-parse', '--short=12', 'HEAD']).stdout) || '(none)'
  const command = `meerkat verdict ${quote(folder.split('\\').join('/'))} --base ${quote(ref)}`
  const lines = handoffLines({ verdict, branch, commit, base: ref, folder: folder.split('\\').join('/'), open: rows.length, places: rows, command, when: new Date().toISOString() })
  // Default: the newest run folder of this project, else a folder of its own under the log root. Never the repo.
  let target
  if (outFile) target = resolve(cwd, outFile)
  else {
    const dir = latestRunDir(env, folder) ?? join(logRoot(env), 'handoffs', `${folder.split(/[\\/]/).filter(Boolean).pop()}-${pathHash(folder)}`)
    mkdirSync(dir, { recursive: true })
    target = join(dir, 'meerkat-handoff.md')
  }
  writeFileSync(target, `${lines.join('\n')}\n`)
  err(`meerkat handoff: gate ${(gateMs / 1000).toFixed(1)}s (the same work as meerkat verdict), handoff file ${Date.now() - t1}ms on top`)
  out(`${verdict}`)
  out(`handoff: ${target.split('\\').join('/')} (${lines.length} lines). next: meerkat handoff --read ${quote(target.split('\\').join('/'))}`)
  return 0
}
