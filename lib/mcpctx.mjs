// MCP tools for the AI-context commands (roadmap C5): meerkat_context, meerkat_risks, meerkat_task_pack, and the budget/for mode of meerkat_map.
// Each one runs the matching command (`meerkat context`, `meerkat map --budget`, `meerkat risks`, `meerkat brief --task`) as a child process with an
// argument list, never a shell string, and returns its stdout as text. isError is set only for a usage error or an invalid plan; a missing run is not one.
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const FOLDER = { type: 'string', description: 'The project folder. Must be inside the folder the server was started in or one added with `meerkat root add`. Defaults to the start-up folder.' }
const two = (what, when) => `${what}\n${when}`
const readOnly = (title) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })

export const MAX_TEXT = 16000
export const DEFAULT_BUDGET = 4000
export const MAX_BUDGET = 1000000
const TASK_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export const CONTEXT_TOOLS = [
  {
    name: 'meerkat_context',
    description: two('Returns a short project brief: what the project is, the commands that verify it, the checks that apply, the folders and what each holds, and the rules files.', 'Use first in an unfamiliar project, before reading code. Prints the same text as `meerkat context`; writes nothing into the project.'),
    inputSchema: { type: 'object', properties: { folder: FOLDER }, additionalProperties: false },
    annotations: readOnly('Project brief'),
  },
  {
    name: 'meerkat_risks',
    description: two('Returns the newest run\'s open findings grouped by file, ranked by severity and by how often the file changed; dismissed findings are listed apart.', 'Use before editing, to see which files are risky. No saved run is not an error. json: true also returns the list as structured data. Reads files only.'),
    inputSchema: { type: 'object', properties: { folder: FOLDER, json: { type: 'boolean', description: 'Also return the list as structured data. Default false.' } }, additionalProperties: false },
    annotations: readOnly('Risky files'),
  },
  {
    name: 'meerkat_task_pack',
    description: two('Returns the context pack for one task of a plan file: the files it owns, the symbols they define, callers outside the task, open risks and the done command.', 'Use to brief a sub-agent in one paste. A plan that fails plan check returns its errors, not a pack. Reads files only, changes nothing.'),
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'string', minLength: 1, maxLength: 1000, description: 'Path to the plan file (see `meerkat plan`). Its folder must be inside the folder the server was started in or one added with `meerkat root add`.' },
        task: { type: 'string', minLength: 1, maxLength: 100, description: 'The task id in the plan.' },
        maxChars: { type: 'integer', minimum: 1, maximum: 100000, description: 'Cap on the pack length in characters. Default 4000.' },
      },
      required: ['plan', 'task'],
      additionalProperties: false,
    },
    annotations: readOnly('Task context pack'),
  },
]

// The extra arguments meerkat_map accepts (budget, for). Added to its schema in lib/mcp.mjs.
export const MAP_EXTRA_PROPS = {
  budget: { type: 'integer', minimum: 1, maximum: MAX_BUDGET, description: `Token budget for a ranked map of the symbols that matter most (1 token is about 4 characters). With budget or for the result is that ranked text, not a saved code map. Default ${DEFAULT_BUDGET}.` },
  for: { type: 'string', minLength: 1, maxLength: 500, description: 'A file inside the folder (relative path) to rank the map for: symbols defined in, used by or next to it come first.' },
}

export function makeContextTools({ safe, fail, pickFolder, checkNoExtra }) {
  const cap = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n[truncated: ${s.length - MAX_TEXT} more characters]` : s)
  const stdoutOf = (r) => safe(String(r.stdout ?? '').replace(/\s+$/, ''))
  const errOf = (r) => safe(String(r.stderr || r.stdout || '').trim())
  const timedOut = (what) => fail(`${what} was stopped before it finished.`)

  return {
    async meerkat_context(args, ctx) {
      const bad = checkNoExtra(args, ['folder'])
      if (bad) return fail(bad)
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      const r = await ctx.runCli(['context', f.folder], { timeoutMs: 120000 })
      if (r.timedOut) return timedOut('meerkat context')
      if (r.code !== 0) return fail(`meerkat context exited with code ${r.code}:\n${errOf(r)}`)
      const body = stdoutOf(r)
      return { content: [{ type: 'text', text: cap(body) }], structuredContent: { folder: f.folder, chars: body.length, truncated: body.length > MAX_TEXT }, _status: 'project brief' }
    },

    // Called by meerkat_map in lib/mcptools.mjs when budget or for is given. Returns null when neither is, so the old behaviour is untouched.
    async mapRanked(args, ctx) {
      if (args.budget === undefined && args.for === undefined) return null
      let budget = DEFAULT_BUDGET
      if (args.budget !== undefined) {
        if (!Number.isInteger(args.budget) || args.budget < 1 || args.budget > MAX_BUDGET) return fail(`budget must be a whole number of tokens from 1 to ${MAX_BUDGET}`)
        budget = args.budget
      }
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      const argv = ['map', f.folder, '--budget', String(budget)]
      if (args.for !== undefined) {
        const v = args.for
        if (typeof v !== 'string' || !v.trim() || v.length > 500 || /[\0\r\n]/.test(v) || v.startsWith('-') || isAbsolute(v) || /^[A-Za-z]:/.test(v)) return fail('for must be a file path inside the folder, relative to it, for example "lib/gate.mjs"')
        const abs = resolve(f.folder, v)
        const rel = relative(f.folder, abs)
        if (!rel || rel.startsWith('..') || isAbsolute(rel)) return fail('for must be a file path inside the folder, relative to it, for example "lib/gate.mjs"')
        argv.push('--for', abs)
      }
      const r = await ctx.runCli(argv, { timeoutMs: 300000 })
      if (r.timedOut) return timedOut('meerkat map')
      if (r.code !== 0) return fail(`meerkat map exited with code ${r.code}:\n${errOf(r)}`)
      const body = stdoutOf(r)
      return { content: [{ type: 'text', text: cap(body) }], structuredContent: { folder: f.folder, budget, for: args.for ?? null, ranked: true }, _status: `ranked map, budget ${budget}` }
    },

    async meerkat_risks(args, ctx) {
      const bad = checkNoExtra(args, ['folder', 'json'])
      if (bad) return fail(bad)
      if (args.json !== undefined && typeof args.json !== 'boolean') return fail('json must be true or false')
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      const argv = ['risks', f.folder]
      if (args.json === true) argv.push('--json')
      const r = await ctx.runCli(argv, { timeoutMs: 120000 })
      if (r.timedOut) return timedOut('meerkat risks')
      if (r.code === 3) return { content: [{ type: 'text', text: `No run has been saved for ${f.folder} yet, so there is no risk list. Call meerkat_run or meerkat_gate with this folder first.` }], structuredContent: { folder: f.folder, noRun: true }, _status: 'no saved run' }
      if (r.code !== 0) return fail(`meerkat risks exited with code ${r.code}:\n${errOf(r)}`)
      const body = stdoutOf(r)
      const sc = { folder: f.folder, noRun: false }
      if (args.json === true) {
        try {
          sc.risks = JSON.parse(String(r.stdout))
        } catch {
          return fail(`meerkat risks --json printed something that is not JSON:\n${body.slice(0, 300)}`)
        }
      }
      return { content: [{ type: 'text', text: cap(body) }], structuredContent: sc, _status: 'risk list' }
    },

    async meerkat_task_pack(args, ctx) {
      const bad = checkNoExtra(args, ['plan', 'task', 'maxChars'])
      if (bad) return fail(bad)
      if (typeof args.plan !== 'string' || !args.plan.trim() || args.plan.length > 1000 || /[\0\r\n]/.test(args.plan)) return fail('plan is required: the path to a plan file')
      if (typeof args.task !== 'string' || !TASK_RE.test(args.task)) return fail('task is required: a task id from the plan, letters, digits, dots, dashes and underscores (not starting with a dash)')
      let maxChars
      if (args.maxChars !== undefined) {
        if (!Number.isInteger(args.maxChars) || args.maxChars < 1 || args.maxChars > 100000) return fail('maxChars must be a whole number from 1 to 100000')
        maxChars = args.maxChars
      }
      const planAbs = resolve(ctx.cwd, args.plan)
      const f = pickFolder({ folder: dirname(planAbs) }, ctx)
      if (f.error) return fail(`the plan file must be inside a folder this server may read. ${f.error}`)
      const argv = ['brief', '--task', planAbs, args.task]
      if (maxChars !== undefined) argv.push('--max-chars', String(maxChars))
      const r = await ctx.runCli(argv, { timeoutMs: 120000 })
      if (r.timedOut) return timedOut('meerkat brief --task')
      if (r.code !== 0) return fail(`meerkat brief --task exited with code ${r.code}:\n${errOf(r)}`)
      const body = stdoutOf(r)
      return { content: [{ type: 'text', text: cap(body) }], structuredContent: { plan: planAbs, task: args.task, chars: body.length }, _status: `task pack ${args.task}` }
    },
  }
}
