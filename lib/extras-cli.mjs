// The commands added with the accepted-findings, history, suggestion and CI features. bin/meerkat.mjs sends these words here before
// planCommand (lib/cli.mjs) sees them, so the older command parser stays as it was.
//   meerkat dismiss <id> --reason "..."     accept one finding as not a problem (kept with its reason, in the home folder)
//   meerkat undismiss <id>                  take a dismissal back
//   meerkat dismissals [--stats]            the dismissals of this project, or --stats: per rule, across every project
//   meerkat baseline [--clear]              accept the newest run's findings as they are; `meerkat run --ratchet` then fails only on new ones
//   meerkat trend [folder]                  one line per recent run: findings by severity, new and fixed
//   meerkat suggest [run-dir]               suggested commands for the newest run's findings (never run for you)
//   meerkat pr-comment [run-dir]            markdown for a pull request comment (print it, or pipe it to gh pr comment)
//   meerkat hook install|remove [folder]    a git pre-push hook that runs the quick preset with --ratchet
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { acceptedFile, baselineDoc, dismissalDoc, readDismissals, saveAccepted, dismissalStats, withDismissal, withoutDismissal } from './accepted.mjs'
import { prComment, prePushBlock, installHook, removeHook } from './ci-output.mjs'
import { readFindings } from './findingsdoc.mjs'
import { historyFile, readHistory } from './findingshistory.mjs'
import { latestRunDir } from './runlog.mjs'
import { MEERKAT_DIR } from './paths.mjs'
import { suggestionsMarkdown } from './suggest.mjs'
import { trendRows, trendText } from './trend.mjs'
import { loadRuleFile, selfTestRule } from './datarules.mjs'

export { EXTRA_WORDS } from './extras-words.mjs'

const flag = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
// Flags that take a value. Anything else that starts with -- is a switch.
const VALUE_FLAGS = ['--reason', '--run-url']
const positional = (argv) => argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]))

// The newest run's findings document, or null with the reason.
function newestDoc(env, runDir) {
  const dir = runDir ?? latestRunDir(env)
  if (!dir) return { ok: false, text: 'There is no run yet. Run meerkat once first.' }
  const doc = readFindings(dir)
  return doc ? { ok: true, dir, doc } : { ok: false, text: `The run ${dir} has no findings.json (an older Meerkat, or the run did not finish).` }
}

// Finds a finding by its id, or the first few characters of it, in the newest run.
function findById(doc, prefix) {
  const hits = (doc.findings ?? []).filter((f) => f.id === prefix || (prefix.length >= 4 && f.id.startsWith(prefix)))
  return hits.length === 1 ? { ok: true, f: hits[0] } : { ok: false, text: hits.length ? `"${prefix}" matches ${hits.length} findings: use more characters.` : `No open finding with id ${prefix} in the newest run (meerkat findings lists them).` }
}

export function runExtra(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const [word, ...rest] = argv
  const folder = resolve(cwd, positional(rest)[0] ?? '.')
  const say = (r) => {
    ;(r.ok ? out : err)(r.text)
    return r.ok ? 0 : 1
  }

  if (word === 'dismiss' || word === 'undismiss') {
    const id = positional(rest)[0]
    if (!id) return say({ ok: false, text: `usage: meerkat ${word} <finding-id>${word === 'dismiss' ? ' --reason "why this is not a problem"' : ''}` })
    const r = newestDoc(env)
    if (!r.ok) return say(r)
    const found = findById(r.doc, id)
    const projectPath = r.doc.run?.project?.path ?? folder
    if (word === 'undismiss') {
      const items = withoutDismissal(readDismissals(env, projectPath), found.ok ? found.f.id : id)
      saveAccepted('dismissed', env, projectPath, dismissalDoc(items))
      return say({ ok: true, text: `Dismissal removed for ${found.ok ? found.f.id : id}.` })
    }
    if (!found.ok) return say(found)
    try {
      const items = withDismissal(readDismissals(env, projectPath), { id: found.f.id, rule: found.f.rule, check: found.f.check, file: found.f.file, title: found.f.title, reason: flag(rest, '--reason') })
      saveAccepted('dismissed', env, projectPath, dismissalDoc(items))
      return say({ ok: true, text: `Dismissed ${found.f.id} (${found.f.severity}, ${found.f.check}${found.f.rule ? `/${found.f.rule}` : ''}). It no longer fails a check. Reason: ${flag(rest, '--reason').trim()}` })
    } catch (e) {
      return say({ ok: false, text: String(e.message ?? e) })
    }
  }

  if (word === 'dismissals') {
    if (rest.includes('--stats')) {
      const rows = dismissalStats(env)
      if (!rows.length) return say({ ok: true, text: 'No dismissals on this machine yet.' })
      const lines = ['Dismissals by rule, all projects (most dismissed first). A rule dismissed again and again may be a false alarm: review it.', ...rows.map((r) => `${r.count}  ${r.rule}  latest reason: ${r.reason ?? ''}`)]
      return say({ ok: true, text: lines.join('\n') })
    }
    const items = readDismissals(env, folder)
    return say({ ok: true, text: items.length ? items.map((d) => `${d.id}  ${d.check}${d.rule ? `/${d.rule}` : ''}  ${d.file ?? ''}  "${d.reason}"  (${d.at.slice(0, 10)})`).join('\n') : `No dismissals for ${folder}.` })
  }

  if (word === 'baseline') {
    if (rest.includes('--clear')) {
      saveAccepted('baseline', env, folder, { schemaVersion: 1, items: [] })
      return say({ ok: true, text: 'Baseline cleared.' })
    }
    const r = newestDoc(env)
    if (!r.ok) return say(r)
    const doc = baselineDoc(r.doc.findings, { runId: r.doc.run?.id })
    const path = acceptedFile('baseline', env, r.doc.run?.project?.path ?? folder)
    if (!saveAccepted('baseline', env, r.doc.run?.project?.path ?? folder, doc)) return say({ ok: false, text: `Could not write the baseline to ${path}.` })
    return say({ ok: true, text: `Baseline saved: ${doc.count} open finding(s) from run ${doc.runId}. meerkat run --ratchet now fails only on findings that are not in it.` })
  }

  if (word === 'trend') {
    const h = readHistory(historyFile(env, folder))
    return say({ ok: true, text: trendText(trendRows(h)) })
  }

  if (word === 'suggest') {
    const r = newestDoc(env, rest[0] && existsSync(rest[0]) ? resolve(rest[0]) : null)
    if (!r.ok) return say(r)
    return say({ ok: true, text: suggestionsMarkdown(r.doc) })
  }

  if (word === 'pr-comment') {
    const r = newestDoc(env, rest[0] && existsSync(rest[0]) ? resolve(rest[0]) : null)
    if (!r.ok) return say(r)
    return say({ ok: true, text: prComment(r.doc, { runUrl: flag(rest, '--run-url') ?? null }) })
  }

  if (word === 'hook') {
    const action = rest[0]
    const target = resolve(cwd, rest[1] ?? '.')
    let hooksFile
    try {
      hooksFile = execFileSync('git', ['-C', target, 'rev-parse', '--git-path', 'hooks/pre-push'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return say({ ok: false, text: `${target} is not a git repository, so there is no hook to install.` })
    }
    const hookPath = resolve(target, hooksFile)
    if (action === 'install') {
      const run = `node "${join(MEERKAT_DIR, 'run.mjs').replace(/\\/g, '/')}" --app "${target.replace(/\\/g, '/')}" --preset quick --ratchet --plain`
      const r = installHook(hookPath, prePushBlock(run))
      return say(r.ok ? { ok: true, text: `Pre-push hook installed at ${hookPath}. It runs the quick preset with --ratchet before every push. Remove it with: meerkat hook remove` } : { ok: false, text: r.detail })
    }
    if (action === 'remove') {
      const r = removeHook(hookPath)
      return say(r.ok ? { ok: true, text: r.detail } : { ok: false, text: r.detail })
    }
    return say({ ok: false, text: 'usage: meerkat hook install|remove [folder]' })
  }

  if (word === 'rules') {
    const file = rest[1] ? resolve(cwd, rest[1]) : null
    if (rest[0] !== 'test' || !file) return say({ ok: false, text: 'usage: meerkat rules test <file.json>' })
    const { rules, errors } = loadRuleFile(file)
    if (errors.length) return say({ ok: false, text: errors.join('\n') })
    const bad = rules.map((r) => ({ id: r.id, ...selfTestRule(r) })).filter((x) => !x.ok)
    if (bad.length) return say({ ok: false, text: bad.map((x) => `${x.id}: ${x.detail}`).join('\n') })
    return say({ ok: true, text: `${rules.length} rule(s) in ${file}: every bad sample is caught and every good sample passes.` })
  }

  return null
}
