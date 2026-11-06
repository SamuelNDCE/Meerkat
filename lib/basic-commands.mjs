// The commands that only print a fixed text (help, describe, completion). They live apart from lib/commands.mjs so `meerkat --help` does not load every command's code.
import { completionScript } from './completion.mjs'
import { commandHelp, describe, overviewHelp } from './help.mjs'
import { listPresets, loadPresets } from './cli.mjs'

// Returns the exit code, or null when the plan is not one of these.
export function executeBasic(plan, ctx) {
  const { out, env = process.env } = ctx
  const names = () => listPresets(ctx.presets ?? loadPresets({ cwd: ctx.cwd, env })).map((p) => p.name)
  switch (plan.kind) {
    case 'help':
      out(plan.topic ? commandHelp(plan.topic) : overviewHelp(names()))
      return 0
    case 'describe':
      out(JSON.stringify(describe({ version: ctx.version ?? '', presetNames: names() }), null, 2))
      return 0
    case 'completion':
      out(completionScript(plan.shell).trimEnd())
      return 0
    default:
      return null
  }
}
