#!/usr/bin/env node
// `meerkat`: the command line front door. Plans the command with lib/cli.mjs, then does it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { helpText, loadPresets, packAdd, packList, packRemove, planCommand, presetsText, rootCommand } from '../lib/cli.mjs'
import { buildBugReport } from '../lib/bugreport.mjs'
import { afterRun, runMenu, spawnRun } from '../lib/menu.mjs'
import { MEERKAT_DIR } from '../lib/paths.mjs'
import { aiStatus, aiTest, aiUse } from '../lib/aiconfig.mjs'
import { latestRunDir } from '../lib/runlog.mjs'
import { maybeAutoUpdate, runUpdateCommand } from '../lib/update.mjs'

process.noDeprecation = true // the claude command on Windows is a .cmd shim, which can only be started through a shell
const env = process.env
const cwd = process.cwd()
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !env.CI
const out = (t) => process.stdout.write(`${t}\n`)

function version() {
  try {
    return JSON.parse(readFileSync(join(MEERKAT_DIR, 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

async function main() {
  const presets = loadPresets({ cwd, env })
  const plan = planCommand(process.argv.slice(2), { cwd, env, interactive, presets })
  // At most once a day, and only if the person turned it on (meerkat update notify|auto). Silent on any failure.
  if (interactive && (plan.kind === 'menu' || plan.kind === 'run')) {
    try {
      maybeAutoUpdate({ repoDir: MEERKAT_DIR, env, print: out })
    } catch {
      /* an update check never stops anything */
    }
  }
  switch (plan.kind) {
    case 'error':
      process.stderr.write(`${plan.message}\n`)
      return 2
    case 'help':
      out(helpText(presets))
      return 0
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
      out(r.text)
      return r.ok ? 0 : 1
    }
    case 'menu':
      return runMenu({ cwd, env })
    case 'update':
      return runUpdateCommand(plan, { repoDir: MEERKAT_DIR, env })
    case 'pack': {
      const r = plan.action === 'add' ? packAdd(plan.folder, env) : plan.action === 'remove' ? packRemove(plan.folder, env) : { ok: true, text: packList(env) }
      out(r.text)
      return r.ok ? 0 : 1
    }
    case 'run': {
      const code = spawnRun(plan.args, { env, cwd })
      if (interactive) await afterRun({ runDir: latestRunDir(env), env, args: plan.args, cwd })
      return code
    }
    default:
      // last, why, logs, list, self-test, init: straight to run.mjs
      return spawnRun(plan.args, { env, cwd })
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (e) => {
    process.stderr.write(`meerkat: ${String(e?.message ?? e).split('\n')[0]}\n`)
    process.exit(1)
  },
)
