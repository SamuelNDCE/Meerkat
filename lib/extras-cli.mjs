// The commands added with the accepted-findings, history, suggestion and CI features. bin/meerkat.mjs sends these words here before
// planCommand (lib/cli.mjs) sees them, so the older command parser stays as it was.
//   meerkat dismiss <id> --reason "..."     accept one finding as not a problem (kept with its reason, in the home folder)
//   meerkat undismiss <id>                  take a dismissal back
//   meerkat dismissals [--stats]            the dismissals of this project, or --stats: per rule, across every project
//   meerkat baseline [--clear]              accept the newest run's findings as they are; `meerkat run --ratchet` then fails only on new ones
//   meerkat trend [folder]                  one line per recent run: findings by severity, new and fixed
//   meerkat suggest [run-dir]               suggested commands for the newest run's findings (never run for you)
//   meerkat pr-comment [run-dir]            markdown for a pull request comment (print it, or pipe it to gh pr comment)
//   meerkat blast <file>[#symbol]           the blast radius of a file or symbol (lib/blast.mjs)
//   meerkat brief <file>[#symbol]           the pre-edit brief: callers, tests, findings, churn, risk (lib/brief.mjs)
//   meerkat map [--app <dir>]               write codemap.json and codemap.md into a run folder (lib/codemap.mjs)
//   meerkat gate [--staged | --base <ref> | --against <ref>]   run the checks that cover the changed files (lib/gate.mjs)
//   meerkat smoke [--timeout <seconds>]     prove each selected check starts and stops in time (lib/gate.mjs)
//   meerkat memory [--dry-run]              hand the newest run to the memory adapter named in meerkat.config.json (lib/memory.mjs)
//   meerkat init --profile <name> [--write] print (or with --write, create) a meerkat.config.json for a kind of workflow (lib/workflow-profiles.mjs)
//   meerkat hook install|remove|status [folder]    a git pre-push hook that runs the quick preset with --ratchet
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { acceptedFile, baselineDoc, dismissalDoc, readDismissals, saveAccepted, dismissalStats, withDismissal, withoutDismissal } from './accepted.mjs'
import { prComment, prePushBlock, installHook, removeHook, hookRefusals, hookStatus, shq } from './ci-output.mjs'
import { readFindings } from './findingsdoc.mjs'
import { historyFile, readHistory } from './findingshistory.mjs'
import { latestRunDir, usedRunLine } from './runlog.mjs'
import { MEERKAT_DIR } from './paths.mjs'
import { suggestionsMarkdown } from './suggest.mjs'
import { trendRows, trendText } from './trend.mjs'
import { runBlast } from './blast.mjs'
import { runBrief } from './brief.mjs'
import { runMap } from './codemap.mjs'
import { gateMain } from './gate.mjs'
import { postComment } from './github.mjs'
import { loadRuleFile, selfTestRule } from './datarules.mjs'
import { runMemory } from './memory.mjs'
import { runInitProfile } from './workflow-profiles.mjs'

export { EXTRA_WORDS } from './extras-words.mjs'

const flag = (argv, name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
// Flags that take a value. Anything else that starts with -- is a switch.
const VALUE_FLAGS = ['--reason', '--run-url', '--run', '--app', '--repo', '--sha', '--pr']
const positional = (argv) => argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]))

// meerkat redtest [--kind mutation|faults|adversarial|regression|cleantwin|all]: the same code as `node lib/redtest/run.mjs` and the MCP tool meerkat_redtest.
export function runRedtestCommand(args, { env = process.env, err = (t) => process.stderr.write(`${t}
`) } = {}) {
  const r = spawnSync(process.execPath, [join(MEERKAT_DIR, 'lib', 'redtest', 'run.mjs'), ...args], { stdio: 'inherit', env })
  if (r.error) {
    err(`meerkat redtest: could not start the red tests: ${String(r.error.message ?? r.error)}`)
    return 1
  }
  return r.status ?? 1
}

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

async function postPrComment(body, { rest, env, say }) {
  let pr = flag(rest, '--pr') ?? null
  if (!pr && env.GITHUB_EVENT_PATH) {
    try {
      pr = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))?.pull_request?.number ?? null
    } catch {
      // no readable event file: carry on without a pull request number
    }
  }
  const r = await postComment({ body, repo: flag(rest, '--repo') ?? env.GITHUB_REPOSITORY, pr, token: env.GITHUB_TOKEN })
  return say({ ok: r.ok, text: `meerkat pr-comment --post: ${r.detail}` })
}

export function runExtra(argv, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  const [word, ...rest] = argv
  if (word === 'gate' || word === 'smoke') return gateMain(rest, { smoke: word === 'smoke', env, cwd, log: out, err })
  if (word === 'redtest') return runRedtestCommand(rest, { env, err })
  if (word === 'blast') return runBlast(rest, { env, cwd, out, err })
  if (word === 'brief') return runBrief(rest, { env, cwd, out, err })
  if (word === 'map') return runMap(rest, { env, cwd, out, err })
  if (word === 'memory') return runMemory(argv, { env, cwd, out, err })
  if (word === 'init') return runInitProfile(argv, { cwd, out, err })
  const folder = resolve(cwd, flag(rest, '--app') ?? positional(rest)[0] ?? '.')
  // --run <dir> names the run to act on, so dismiss and baseline never fall back to the global newest run (the MCP tools always pass it).
  const runArg = flag(rest, '--run') ? resolve(cwd, flag(rest, '--run')) : null
  const say = (r) => {
    ;(r.ok ? out : err)(r.text)
    return r.ok ? 0 : (r.code ?? 1)
  }

  if (word === 'dismiss' || word === 'undismiss') {
    const id = positional(rest)[0]
    if (!id) return say({ ok: false, text: `usage: meerkat ${word} <finding-id>${word === 'dismiss' ? ' --reason "why this is not a problem"' : ''}` })
    const r = newestDoc(env, runArg)
    if (!r.ok) return say(r)
    out(usedRunLine(r.dir))
    const found = findById(r.doc, id)
    const projectPath = r.doc.run?.project?.path ?? folder
    if (word === 'undismiss') {
      const target = found.ok ? found.f.id : id
      const had = readDismissals(env, projectPath)
      if (!had.some((d) => d.id === target)) return say({ ok: false, text: `Nothing is dismissed under ${target}, so there is nothing to take back (meerkat dismissals lists them).` })
      const items = withoutDismissal(had, target)
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
    const r = newestDoc(env, runArg)
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
    out(usedRunLine(r.dir))
    return say({ ok: true, text: suggestionsMarkdown(r.doc) })
  }

  if (word === 'pr-comment') {
    const r = newestDoc(env, rest[0] && existsSync(rest[0]) ? resolve(rest[0]) : null)
    if (!r.ok) return say(r)
    const body = prComment(r.doc, { runUrl: flag(rest, '--run-url') ?? null, repo: flag(rest, '--repo') ?? env.GITHUB_REPOSITORY ?? null, sha: flag(rest, '--sha') ?? env.GITHUB_SHA ?? null })
    if (!rest.includes('--post')) return say({ ok: true, text: body })
    // --post: update the one marked comment on the pull request, or create it. Needs only GITHUB_TOKEN (lib/github.mjs); no gh.
    return postPrComment(body, { rest, env, say })
  }

  if (word === 'hook') {
    const action = rest[0]
    const target = resolve(cwd, rest[1] ?? '.')
    let hooksFile
    try {
      hooksFile = execFileSync('git', ['-C', target, 'rev-parse', '--git-path', 'hooks/pre-push'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return say({ ok: false, text: `${target} is not a git repository, so there is no hook to install.` })
    }
    const hookPath = resolve(target, hooksFile)
    if (action === 'status') {
      const st = hookStatus(hookPath)
      const why = hookRefusals(target, hookPath, env)
      return say({ ok: true, text: [`Hook file: ${hookPath}${st.exists ? '' : ' (does not exist)'}`, `Meerkat block installed: ${st.installed ? 'yes' : 'no'}`, why.length ? `Install would be refused: ${why.join('; ')}` : 'Install would be allowed.'].join('\n') })
    }
    if (action === 'install') {
      const why = hookRefusals(target, hookPath, env)
      if (why.length) return say({ ok: false, code: 2, text: `Not installing the pre-push hook: ${why.join('; ')}.` })
      const runFile = join(MEERKAT_DIR, 'run.mjs').replace(/\\/g, '/')
      const r = installHook(hookPath, prePushBlock(runFile, `--app ${shq(target.replace(/\\/g, '/'))} --preset quick --ratchet --plain`))
      return say(r.ok ? { ok: true, text: `Pre-push hook installed at ${hookPath}. It runs the quick preset with --ratchet before every push. If Meerkat itself is missing or times out it prints TOOL FAULT and blocks the push (fails closed); to push anyway on purpose, set MEERKAT_ALLOW_HOOK_FAIL=1 for that push (it is logged in hook.log). Remove it with: meerkat hook remove` } : { ok: false, text: r.detail })
    }
    if (action === 'remove') {
      const r = removeHook(hookPath)
      return say(r.ok ? { ok: true, text: r.detail } : { ok: false, text: r.detail })
    }
    return say({ ok: false, text: 'usage: meerkat hook install|remove|status [folder]' })
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
