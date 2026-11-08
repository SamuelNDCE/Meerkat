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
//   meerkat hook install [--gate]|remove|status [folder]    a git pre-push hook: quick preset with --ratchet on the whole repo, or with --gate only the pushed commits
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { acceptedFile, allDismissals, baselineDoc, dismissalDoc, parseExpiry, readDismissals, readRepoDismissals, repoDismissFile, saveAccepted, saveRepoDismissals, dismissalStats, withDismissal, withoutDismissal } from './accepted.mjs'
import { GATE_ARGS, installHookFile, removeHookFile } from './hook-safety.mjs'
import { prComment, prePushBlock, hookRefusals, hookStatus, shq } from './ci-output.mjs'
import { readFindings } from './findingsdoc.mjs'
import { missingFindingsText } from './findingsread.mjs'
import { historyFile, readHistory } from './findingshistory.mjs'
import { latestRunDir, pickRunDir, usedRunLine } from './runlog.mjs'
import { MEERKAT_DIR } from './paths.mjs'
import { suggestionsMarkdown } from './suggest.mjs'
import { trendRows, trendText } from './trend.mjs'
import { runBlast } from './blast.mjs'
import { runLock } from './lockcmd.mjs'
import { runTestRun } from './testrun.mjs'
import { runBrief } from './brief.mjs'
import { runTop, runVerdict } from './branchcmds.mjs'
import { runCommandsList, runNamedCommand } from './repocommands.mjs'
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
// Without a run named, the newest run of `folder` (never another project's).
function newestDoc(env, runDir, folder = null) {
  const dir = runDir ?? latestRunDir(env, folder)
  if (!dir) return { ok: false, text: folder ? `There is no run for ${folder} yet. Run meerkat verify there first.` : 'There is no run yet. Run meerkat once first.' }
  const doc = readFindings(dir)
  return doc ? { ok: true, dir, doc } : { ok: false, text: missingFindingsText(dir) }
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

export function runExtra(args, { env = process.env, cwd = process.cwd(), out = (t) => process.stdout.write(`${t}\n`), err = (t) => process.stderr.write(`${t}\n`) } = {}) {
  // Global flags every command accepts (docs/commands.md "Global options"). The commands below do nothing different for them (they never ask a question), so they are dropped here.
  const argv = args.filter((a) => a !== '--no-input' && a !== '--no-color')
  const [word, ...rest] = argv
  if (word === 'gate' || word === 'smoke') return gateMain(rest, { smoke: word === 'smoke', env, cwd, log: out, err, banner: true })
  if (word === 'redtest') return runRedtestCommand(rest, { env, err })
  if (word === 'test-run') return runTestRun(rest, { env, cwd, out, err })
  if (word === 'lock') return runLock(rest, { env, out, err })
  if (word === 'blast') return runBlast(rest, { env, cwd, out, err })
  if (word === 'brief') return runBrief(rest, { env, cwd, out, err })
  if (word === 'verdict') return runVerdict(rest, { env, cwd, out, err })
  if (word === 'top') return runTop(rest, { env, cwd, out, err })
  if (word === 'commands') return runCommandsList(rest, { env, cwd, out, err })
  if (word === 'build') return runNamedCommand('build', rest, { env, cwd, out, err })
  // `meerkat test` has always been the quick check; it runs the repo's own test command only when the config defines one.
  if (word === 'test') return runNamedCommand('test', rest, { env, cwd, out, err, fallback: true })
  if (word === 'map') return runMap(rest, { env, cwd, out, err })
  if (word === 'memory') return runMemory(argv, { env, cwd, out, err })
  if (word === 'init') return runInitProfile(argv, { cwd, out, err })
  const isIdWord = word === 'dismiss' || word === 'undismiss'
  const folder = resolve(cwd, flag(rest, '--app') ?? (isIdWord ? null : positional(rest)[0]) ?? '.')
  // --run <dir> names the run to act on, so dismiss and baseline never fall back to the global newest run (the MCP tools always pass it).
  const runArg = flag(rest, '--run') ? resolve(cwd, flag(rest, '--run')) : null
  const say = (r) => {
    ;(r.ok ? out : err)(r.text)
    return r.ok ? 0 : (r.code ?? 1)
  }

  if (word === 'dismiss' || word === 'undismiss') {
    const id = positional(rest)[0]
    if (!id) return say({ ok: false, code: 2, text: `usage: meerkat ${word} <finding-id>${word === 'dismiss' ? ' --reason "why this is not a problem"' : ''}` })
    // An optional run after the id: `meerkat dismiss <id> <run-id>` (the folder name of a run, or the start of it). Without one: the newest run of this folder.
    let pickedDir = runArg
    if (!pickedDir && positional(rest)[1]) {
      const p = pickRunDir(env, { run: positional(rest)[1], folder })
      if (!p.ok) return say(p)
      pickedDir = p.dir
    }
    const r = newestDoc(env, pickedDir, folder)
    if (!r.ok) return say(r)
    out(usedRunLine(r.dir))
    const found = findById(r.doc, id)
    const projectPath = r.doc.run?.project?.path ?? folder
    if (word === 'undismiss') {
      const had = readDismissals(env, projectPath)
      const hadRepo = readRepoDismissals(projectPath)
      const known = [...had, ...hadRepo].map((d) => d.id)
      const pre = id.length >= 4 ? [...new Set(known.filter((k) => k.startsWith(id)))] : []
      if (!found.ok && pre.length > 1) return say({ ok: false, text: `"${id}" matches ${pre.length} dismissals: use more characters.` })
      const target = found.ok ? found.f.id : (pre.length === 1 ? pre[0] : id)
      if (hadRepo.some((d) => d.id === target)) {
        saveRepoDismissals(projectPath, withoutDismissal(hadRepo, target))
        if (!had.some((d) => d.id === target)) return say({ ok: true, text: `Dismissal removed for ${target} (from ${repoDismissFile(projectPath)}).` })
      }
      if (!had.some((d) => d.id === target)) return say({ ok: false, text: `Nothing is dismissed under ${target}, so there is nothing to take back (meerkat dismissals lists them).` })
      const items = withoutDismissal(had, target)
      saveAccepted('dismissed', env, projectPath, dismissalDoc(items))
      return say({ ok: true, text: `Dismissal removed for ${found.ok ? found.f.id : id}.` })
    }
    if (!found.ok) return say(found)
    try {
      const expires = flag(rest, '--expires') ? parseExpiry(flag(rest, '--expires')) : undefined
      if (expires && String(expires).slice(0, 10) < new Date().toISOString().slice(0, 10)) return say({ ok: false, code: 2, text: `--expires ${expires} is in the past, so the dismissal would never apply. Give a date from today on, for example --expires 30d.` })
      const entry = { id: found.f.id, rule: found.f.rule, check: found.f.check, file: found.f.file, title: found.f.title, reason: flag(rest, '--reason'), expires }
      const repoWide = rest.includes('--write-repo')
      if (repoWide) {
        const items = withDismissal(readRepoDismissals(projectPath), entry)
        if (!saveRepoDismissals(projectPath, items)) return say({ ok: false, text: `Could not write ${repoDismissFile(projectPath)}.` })
      } else {
        saveAccepted('dismissed', env, projectPath, dismissalDoc(withDismissal(readDismissals(env, projectPath), entry)))
      }
      return say({ ok: true, text: `Dismissed ${found.f.id} (${found.f.severity}, ${found.f.check}${found.f.rule ? `/${found.f.rule}` : ''}). It no longer fails a check${expires ? ` until ${expires}` : ''}. Reason: ${flag(rest, '--reason').trim()}${repoWide ? `\nSaved in ${repoDismissFile(projectPath)}: commit it so teammates and CI see it.` : ''}` })
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
    const items = allDismissals(env, folder)
    const row = (d) => `${d.expired ? 'EXPIRED' : 'ACTIVE '}  ${d.id}  ${d.check}${d.rule ? `/${d.rule}` : ''}  ${d.file ?? ''}  "${d.reason}"  set ${d.at.slice(0, 10)}  ${d.expires ? (d.expired ? `expired on ${d.expires}` : `expires ${d.expires}`) : 'no expiry'}  [${d.source}]`
    return say({ ok: true, text: items.length ? items.map(row).join('\n') : `No dismissals for ${folder}.` })
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
    const target = resolve(cwd, rest.slice(1).find((a) => !a.startsWith('--')) ?? '.')
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
      const gateMode = rest.includes('--gate')
      const appArg = target.replace(/\\/g, '/')
      const r = installHookFile(hookPath, prePushBlock(runFile, gateMode ? GATE_ARGS(appArg) : `--app ${shq(appArg)} --preset quick --ratchet --plain`))
      const which = gateMode ? 'Installed: the GATE hook (checks only the files changed in the commits being pushed, against the upstream branch).' : 'Installed: the whole-repo hook (quick preset with --ratchet on the whole repository). To check only the pushed commits instead, run: meerkat hook install --gate'
      return say(r.ok ? { ok: true, text: `${which}\nPre-push hook installed at ${hookPath}. ${gateMode ? 'It runs meerkat gate --base <upstream branch> (origin/HEAD when there is none) before every push, so only the files changed in the pushed commits are checked.' : 'It runs the quick preset with --ratchet on the whole repository before every push.'} If Meerkat itself is missing or times out it prints TOOL FAULT and blocks the push (fails closed); to push anyway on purpose, set MEERKAT_ALLOW_HOOK_FAIL=1 for that push (it is logged in hook.log). Remove it with: meerkat hook remove` } : { ok: false, text: r.detail })
    }
    if (action === 'remove') {
      const r = removeHookFile(hookPath)
      return say(r.ok ? { ok: true, text: r.detail } : { ok: false, text: r.detail })
    }
    return say({ ok: false, text: 'usage: meerkat hook install [--gate]|remove|status [folder]' })
  }

  if (word === 'rules') {
    const file = rest[1] ? resolve(cwd, rest[1]) : null
    if (rest[0] !== 'test' || !file) return say({ ok: false, code: 2, text: 'usage: meerkat rules test <file.json>' })
    const { rules, errors } = loadRuleFile(file)
    if (errors.length) return say({ ok: false, text: errors.join('\n') })
    const bad = rules.map((r) => ({ id: r.id, ...selfTestRule(r) })).filter((x) => !x.ok)
    if (bad.length) return say({ ok: false, text: bad.map((x) => `${x.id}: ${x.detail}`).join('\n') })
    return say({ ok: true, text: `${rules.length} rule(s) in ${file}: every bad sample is caught and every good sample passes.` })
  }

  return null
}
