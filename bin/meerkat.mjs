#!/usr/bin/env node
// `meerkat`: the command line front door. Plans the command with lib/cli.mjs, then does it.
// Exit codes: 0 passed, 1 a check failed or could not run, 2 a usage or configuration error, 3 nothing to run, 130 interrupted.
// Results go to stdout; notes, progress and errors go to stderr.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { helpText, loadPresets, packAdd, packRemove, planCommand, presetsText, rootCommand } from '../lib/cli.mjs'
import { buildBugReport } from '../lib/bugreport.mjs'
import { execute } from '../lib/commands.mjs'
import { afterRun, runMenu, spawnRun } from '../lib/menu.mjs'
import { MEERKAT_DIR } from '../lib/paths.mjs'
import { aiStatus, aiTest, aiUse } from '../lib/aiconfig.mjs'
import { latestRunDir, logRoot } from '../lib/runlog.mjs'
import { runLog, showRun } from '../lib/runs.mjs'
import { asyncTimedExec, maybeAutoUpdateAsync, runUpdateCommand } from '../lib/update.mjs'
import { createUpdateCheck, outcomeOf } from '../lib/updatecheck.mjs'
import { addRecent } from '../lib/userconfig.mjs'

process.noDeprecation = true // the claude command on Windows is a .cmd shim, which can only be started through a shell
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0) // `meerkat ... | head` closed the pipe: not an error
})
process.on('SIGINT', () => process.exit(130))
const env = process.env
const cwd = process.cwd()
const argv = process.argv.slice(2)
if (argv.includes('--no-color')) env.NO_COLOR = '1'
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !env.CI && !argv.includes('--no-input')
const out = (t) => process.stdout.write(`${t}\n`)
const err = (t) => process.stderr.write(`${t}\n`)

function version() {
  try {
    return JSON.parse(readFileSync(join(MEERKAT_DIR, 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

async function main() {
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
    const color = Boolean(process.stdout.isTTY) && !env.NO_COLOR && !env.MEERKAT_PLAIN
    const wipe = () => process.stdout.write('\r\x1b[2K')
    const check = createUpdateCheck({
      version: version(),
      color,
      isTTY: Boolean(process.stdout.isTTY),
      holdMs: inMenu ? 1000 : 0,
      run: async ({ onCheck }) => outcomeOf(await maybeAutoUpdateAsync({ repoDir: MEERKAT_DIR, env, exec: asyncTimedExec(3000), print: inMenu ? () => {} : out, onCheck })),
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
    case 'noun':
      return execute(plan, ctx)
    case 'version':
      out(version())
      return 0
    case 'presets':
      out(presetsText(presets))
      return 0
    case 'bug':
      out(buildBugReport({ env }))
      return 0
    case 'root': {
      const r = rootCommand(plan.action, plan.folder, env)
      out(r.text)
      return r.ok ? 0 : 1
    }
    case 'ai': {
      const r = plan.action === 'status' ? { ok: true, text: aiStatus(env) } : plan.action === 'use' ? aiUse(plan.args, env) : plan.action === 'test' ? await aiTest(env) : { ok: false, text: 'usage: meerkat ai status | use <claude|openai|openrouter> [model] | test' }
      out(plan.json ? JSON.stringify({ ok: r.ok, text: r.text }, null, 2) : r.text)
      return r.ok ? 0 : 1
    }
    case 'menu':
      return runMenu({ cwd, env, folder: plan.folder ?? null, updateCheck })
    case 'update':
      return runUpdateCommand(plan, { repoDir: MEERKAT_DIR, env })
    case 'pack': {
      if (plan.action === 'list') return execute({ kind: 'noun', noun: 'pack', verb: 'list', folder: plan.folder ?? cwd, flags: {} }, ctx)
      const r = plan.action === 'add' ? packAdd(plan.folder, env) : packRemove(plan.folder, env)
      out(r.text)
      return r.ok ? 0 : 1
    }
    case 'last':
    case 'why': {
      const r = plan.kind === 'last' ? showRun(env, undefined) : runLog(env, plan.args[1], plan.args[2])
      ;(r.ok ? out : err)(r.text)
      return r.ok ? 0 : 1
    }
    case 'logs': {
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
