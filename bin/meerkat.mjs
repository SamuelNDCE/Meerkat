#!/usr/bin/env node
// `meerkat`: the command line front door. Plans the command with lib/cli.mjs, then does it.
// Exit codes: the one table in lib/exitcodes.mjs (0 passed, 1 a finding or a failed check, 2 usage or configuration error, 3 nothing could be judged, 4 stale base, 70 Meerkat's own error, 75 incomplete, 124 time limit, 130 interrupted).
// Results go to stdout; notes, progress and errors go to stderr.
import { helpText, loadPresets, packAdd, packRemove, planCommand, presetsText, rootCommand } from '../lib/cli.mjs'
import { unknownOption } from '../lib/flagcheck.mjs'
import { executeBasic } from '../lib/basic-commands.mjs'
import { EXTRA_WORDS } from '../lib/extras-words.mjs'
import { spawnRun } from '../lib/spawnrun.mjs'
import { MEERKAT_DIR } from '../lib/paths.mjs'
import { addRecent } from '../lib/userconfig.mjs'
import { VERSION } from '../lib/version.mjs'
import { startCostMeter } from '../lib/cost.mjs'
import { dataDir } from '../lib/datadir.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Everything below is loaded only by the command that needs it: `meerkat --help` and the look-up commands must not pay for the menu, the screens, the runner or the update code.
const lazy = (path) => {
  let p = null
  return () => (p ??= import(path))
}
const menuMod = lazy('../lib/menu.mjs')
const commandsMod = lazy('../lib/commands.mjs')
const runlogMod = lazy('../lib/runlog.mjs')
const runsMod = lazy('../lib/runs.mjs')
const updateMod = lazy('../lib/update.mjs')
const updateCheckMod = lazy('../lib/updatecheck.mjs')
const aiMod = lazy('../lib/aiconfig.mjs')
const bugMod = lazy('../lib/bugreport.mjs')
const extrasMod = lazy('../lib/extras-cli.mjs')

process.noDeprecation = true // the claude command on Windows is a .cmd shim, which can only be started through a shell
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0) // `meerkat ... | head` closed the pipe: not an error
})
process.on('SIGINT', () => process.exit(130))
const env = process.env
const cwd = process.cwd()
const argv = process.argv.slice(2)
startCostMeter(argv, { env }) // lib/cost.mjs: one row per command in cost.jsonl, read back with `meerkat cost`
if (argv.includes('--no-color')) env.NO_COLOR = '1'
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !env.CI && !argv.includes('--no-input')
const out = (t) => process.stdout.write(`${t}\n`)
const err = (t) => process.stderr.write(`${t}\n`)

const version = () => VERSION // lib/version.mjs: package.json, read once

async function main() {
  // The small commands stop on an option they do not know (exit 2, with the usage line), before anything runs or is written.
  const badOption = unknownOption(argv.filter((a) => a !== '--no-input' && a !== '--no-color'))
  if (badOption) {
    err(badOption.message)
    return badOption.code
  }
  // The accepted-findings, history, suggestion and CI commands (lib/extras-cli.mjs) are handled before the older parser sees them.
  // `meerkat <word> --help` is answered from the command registry (planCommand), not by the command.
  if ((EXTRA_WORDS.includes(argv[0]) || (argv[0] === 'init' && argv.includes('--profile'))) && !argv.includes('--help') && !argv.includes('-h')) {
    const code = await (await extrasMod()).runExtra(argv, { env, cwd, out, err })
    if (code !== null) return code
  }
  const presets = loadPresets({ cwd, env })
  const plan = planCommand(argv, { cwd, env, interactive, presets })
  const ctx = { out, err, env, cwd, interactive, presets, version: version() }
  // At most once a day (not with `meerkat update off`): a read-only look-up of the latest version, 3 seconds at most, remembered for
  // the menu's yellow bar. Only mode auto installs anything. Silent on any failure. It never runs without a terminal.
  // The menu starts it and goes on at once: a spinner line in the menu header shows it, and no key waits for it. A plain run waits
  // for it (3 seconds at most) with the same spinner on one line, which is cleared afterwards.
  let updateCheck = null
  if (interactive && (plan.kind === 'menu' || (plan.kind === 'run' && !plan.json && !plan.quiet))) {
    const inMenu = plan.kind === 'menu'
    const { asyncTimedExec, maybeAutoUpdateAsync } = await updateMod()
    const { createUpdateCheck, outcomeOf } = await updateCheckMod()
    const color = Boolean(process.stdout.isTTY) && !env.NO_COLOR && !env.MEERKAT_PLAIN
    const wipe = () => process.stdout.write('\r\x1b[2K')
    const check = createUpdateCheck({
      version: version(),
      color,
      isTTY: Boolean(process.stdout.isTTY),
      holdMs: inMenu ? 1000 : 0,
      timeoutMs: inMenu ? 20000 : 3000, // the menu never waits, so a slow fetch may take its time; a plain run waits 3 seconds at most
      run: async ({ onCheck }) => ({ outcome: outcomeOf(await maybeAutoUpdateAsync({ repoDir: MEERKAT_DIR, env, exec: asyncTimedExec(inMenu ? 20000 : 3000), print: inMenu ? () => {} : out, onCheck })) }),
    })
    if (!inMenu) {
      const draw = () => {
        const line = check.line()
        wipe()
        if (line) process.stdout.write(line)
      }
      check.onChange = draw
    }
    try {
      const done = check.start()
      if (inMenu) updateCheck = check
      else await done
    } catch {
      /* an update check never stops anything */
    }
    if (!inMenu) {
      check.stop()
      wipe()
    }
  }
  switch (plan.kind) {
    case 'error':
      err(plan.message)
      return 2
    case 'help':
    case 'describe':
    case 'completion':
      return executeBasic(plan, ctx)
    case 'noun':
      return (await commandsMod()).execute(plan, ctx)
    case 'version':
      out(version())
      return 0
    case 'presets':
      out(presetsText(presets))
      return 0
    case 'bug':
      out((await bugMod()).buildBugReport({ env }))
      return 0
    case 'root': {
      const r = rootCommand(plan.action, plan.folder, env)
      out(r.text)
      return r.ok ? 0 : 2 // a root command fails only on a bad folder or a missing action
    }
    case 'ai': {
      if (plan.action === 'hooks') { const h = await import('../lib/aihooks.mjs'); out(h.hooksText()); process.stderr.write(h.hooksNotes() + '\n'); return 0 }
      const { aiStatus, aiTest, aiUse } = await aiMod()
      const r = plan.action === 'status' ? { ok: true, text: aiStatus(env) } : plan.action === 'use' ? aiUse(plan.args, env) : plan.action === 'test' ? await aiTest(env) : { ok: false, text: 'usage: meerkat ai status | use <claude|openai|openrouter> [model] | test' }
      out(plan.json ? JSON.stringify({ ok: r.ok, text: r.text }, null, 2) : r.text)
      return r.ok ? 0 : plan.action === 'test' ? 1 : 2 // a failed test is a failed check; anything else is a bad action or value
    }
    case 'menu':
      return (await menuMod()).runMenu({ cwd, env, folder: plan.folder ?? null, updateCheck })
    case 'update':
      return (await updateMod()).runUpdateCommand(plan, { repoDir: MEERKAT_DIR, env })
    case 'pack': {
      if (plan.action === 'list') return (await commandsMod()).execute({ kind: 'noun', noun: 'pack', verb: 'list', folder: plan.folder ?? cwd, flags: {} }, ctx)
      const r = plan.action === 'add' ? packAdd(plan.folder, env) : packRemove(plan.folder, env)
      out(r.text)
      return r.ok ? 0 : 2 // a folder that is not a project
    }
    case 'last':
    case 'why': {
      const { runLog, showRun } = await runsMod()
      const r = plan.kind === 'last' ? showRun(env, undefined) : runLog(env, plan.args[1], plan.args[2])
      ;(r.ok ? out : err)(r.text)
      return r.ok ? 0 : 3 // no saved run to show: nothing to judge
    }
    case 'logs': {
      const { latestRunDir, logRoot } = await runlogMod()
      const dir = latestRunDir(env)
      out(`logs are saved in ${logRoot(env)}${dir ? `\nnewest run: ${dir}` : ''}`)
      return 0
    }
    case 'run': {
      if (plan.folder) {
        try {
          addRecent(plan.folder, env)
        } catch {
          /* the recent list is a convenience */
        }
      }
      const code = spawnRun(plan.args, { env, cwd })
      if (interactive && !plan.json && !plan.quiet) {
        const { afterRun, runMenu } = await menuMod()
        const { latestRunDir } = await runlogMod()
        const next = await afterRun({ runDir: latestRunDir(env), env, args: plan.args, cwd, canMenu: true })
        // m on the results screen: back to the home menu, for the same project.
        if (next === 'menu') await runMenu({ cwd, env, folder: plan.folder ?? cwd })
      }
      return code
    }
    default:
      // list, self-test, init: straight to run.mjs
      return spawnRun(plan.args, { env, cwd })
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (e) => {
    err(`meerkat: ${String(e?.message ?? e).split('\n')[0]}`)
    process.exit(1)
  },
)
