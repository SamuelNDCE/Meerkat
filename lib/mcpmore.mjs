// The last group of MCP tools: the Meerkat commands that had no tool yet (doctor, discover, recommend, tools, trend, suggest, pr-comment,
// dismissals, describe, hook, undismiss). Each is a thin wrapper: it validates its input, then starts the matching command with an argument
// list (never a shell string). The ones that write (undismiss, hook) start their description with WRITES and need a folder.
// Not exposed on purpose, see docs/for-ai-agents.md: root add/remove (it would widen the folders this server may touch), update, init,
// check/preset/pack edits, recommend --add, tools install, ai, rules test (reads any file), logs, repos and recent (list the person's projects).
import { makeWriteTarget } from './mcptools.mjs'

const FOLDER = { type: 'string', description: 'The project folder. Must be inside the folder the server was started in or one added with `meerkat root add`. Defaults to the start-up folder.' }
const FOLDER_REQUIRED = { type: 'string', minLength: 1, description: 'Required. The project folder. Must be inside the folder the server was started in or one added with `meerkat root add`.' }
const FINDING_ID = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$', description: 'The finding id, or its first 4 or more characters.' }
const ID_RE = new RegExp(FINDING_ID.pattern)
const URL_RE = /^https:\/\/[^\s"'<>`]{1,500}$/

// A description is two lines: what the tool does, then when to use it.
const two = (what, when) => `${what}\n${when}`
const readOnly = (title) => ({ title, readOnlyHint: true, destructiveHint: false, openWorldHint: false })
const folderOnly = { type: 'object', properties: { folder: FOLDER }, additionalProperties: false }

export const MORE_TOOLS = [
  {
    name: 'meerkat_doctor',
    description: two('Reports what would run in a project folder, which outside tools are missing and how to install them.', 'Use when a run says a check could not run, or before a first run in a new project. Looks for tools on this computer and changes nothing.'),
    inputSchema: folderOnly,
    annotations: readOnly('Doctor'),
  },
  {
    name: 'meerkat_discover',
    description: two("Lists the project's own tests and scripts that the full, thorough and release presets would run too (nothing is run).", 'Use to learn what test commands a project already has before choosing a preset. Reads files only.'),
    inputSchema: folderOnly,
    annotations: readOnly('Discover the project tests'),
  },
  {
    name: 'meerkat_recommend',
    description: two('Lists tests this project could run that no Meerkat check covers yet, each with an id and why.', 'Use to find gaps in coverage. It never adds anything (adding is a person\'s step: meerkat recommend --add). Reads files only.'),
    inputSchema: folderOnly,
    annotations: readOnly('Recommend more checks'),
  },
  {
    name: 'meerkat_tools',
    description: two('Lists the optional outside tools (linters, scanners) that are found or missing for a project, with how to install each.', 'Use to see why a check is skipped. It does not install anything (meerkat tools install is a person\'s step).'),
    inputSchema: folderOnly,
    annotations: readOnly('Outside tools'),
  },
  {
    name: 'meerkat_trend',
    description: two('Returns one line per recent run of a project: findings by severity, new and fixed.', 'Use to see whether the project is getting better or worse over time. Reads the run history only.'),
    inputSchema: folderOnly,
    annotations: readOnly('Findings trend'),
  },
  {
    name: 'meerkat_suggest',
    description: two("Returns suggested commands for the newest run's findings, as markdown. Nothing is run for you.", 'Use after meerkat_findings to get a starting fix for each kind of finding. Reads files only.'),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly('Suggested fixes'),
  },
  {
    name: 'meerkat_pr_comment',
    description: two('Returns markdown for a pull request comment from the newest run: result, new findings and what to do. Posts nothing.', 'Use when you are about to open or update a PR and want a short summary to paste. run_url (https) adds a link to the CI run.'),
    inputSchema: { type: 'object', properties: { run_url: { type: 'string', pattern: '^https://[^\\s"\'<>`]{1,500}$', description: 'An https link to the CI run, added to the comment. Optional.' } }, additionalProperties: false },
    annotations: readOnly('Pull request comment'),
  },
  {
    name: 'meerkat_dismissals',
    description: two('Lists the findings a person dismissed as "not a problem" in a project, with reasons; stats: true counts them per rule across every project.', 'Use to see what is already accepted before dismissing again, or to spot a rule that is dismissed again and again. Reads files only.'),
    inputSchema: { type: 'object', properties: { folder: FOLDER, stats: { type: 'boolean', description: 'true: count dismissals per rule across all projects instead of listing one project.' } }, additionalProperties: false },
    annotations: readOnly('Dismissed findings'),
  },
  {
    name: 'meerkat_hook_status',
    description: two('Says whether the Meerkat pre-push hook is installed in a git project and whether an install would be allowed.', 'Use before meerkat_hook to see what is there. Reads one hook file only.'),
    inputSchema: folderOnly,
    annotations: readOnly('Pre-push hook status'),
  },
  {
    name: 'meerkat_describe',
    description: two('Returns every Meerkat command, option and output field as one JSON object, including the exit codes.', 'Use to learn the exact command line before telling a person to run something. Reads nothing from the project.'),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly('Describe the commands'),
  },
  {
    name: 'meerkat_undismiss',
    description: two('WRITES: takes back the dismissal of one finding, so it fails checks again. Saved in the home folder, not in the project.', 'Use when a dismissal was wrong or the reason no longer holds. Keep the client\'s approval step on. Needs a finding id and the folder the newest run belongs to.'),
    inputSchema: { type: 'object', properties: { folder: FOLDER_REQUIRED, id: FINDING_ID }, required: ['folder', 'id'], additionalProperties: false },
    annotations: { title: 'Undismiss a finding', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'meerkat_hook',
    description: two('WRITES: installs or removes the git pre-push hook in a project, which runs the quick preset (with --ratchet) before every push.', 'Use only when the person asks for the hook. Keep the client\'s approval step on. It edits .git/hooks/pre-push in that folder; use meerkat_hook_status first.'),
    inputSchema: { type: 'object', properties: { folder: FOLDER_REQUIRED, action: { type: 'string', enum: ['install', 'remove'], description: 'install adds the Meerkat block to the pre-push hook; remove takes only that block out.' } }, required: ['folder', 'action'], additionalProperties: false },
    annotations: { title: 'Install or remove the pre-push hook', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
]

export function makeMoreTools({ safe, fail, pickFolder, checkNoExtra }) {
  const writeTarget = makeWriteTarget({ safe, pickFolder })
  const out = (r) => safe(String(r.stdout || r.stderr || '').trim())
  const timedOut = (what) => ({ content: [{ type: 'text', text: `${what} was stopped before it finished.` }], isError: true })
  const bool = (args, key) => {
    if (args[key] === undefined) return { value: false }
    return typeof args[key] === 'boolean' ? { value: args[key] } : { error: `${key} must be true or false` }
  }
  const parse = (r) => {
    try {
      return JSON.parse(String(r.stdout))
    } catch {
      return null
    }
  }

  // A command that takes a folder and prints JSON or text. `argv` builds the argument list from the folder.
  const folderTool = (word, argv, { json = true, timeoutMs = 120000 } = {}) => async (args, ctx) => {
    const bad = checkNoExtra(args, ['folder'])
    if (bad) return fail(bad)
    const f = pickFolder(args, ctx)
    if (f.error) return fail(f.error)
    const r = await ctx.runCli(argv(f.folder), { timeoutMs })
    if (r.timedOut) return timedOut(`meerkat ${word}`)
    if (json) {
      const data = parse(r)
      if (!data) return fail(`meerkat ${word} exited with code ${r.code}:\n${out(r)}`)
      return { content: [{ type: 'text', text: safe(JSON.stringify(data, null, 2)) }], structuredContent: { exitCode: r.code } }
    }
    return { content: [{ type: 'text', text: out(r) || `exit ${r.code}` }], structuredContent: { exitCode: r.code }, isError: r.code !== 0 }
  }

  // A command that reads the newest run: the run folder comes from the server, never from the caller.
  const newestRunTool = (word, allowed, argv) => async (args, ctx) => {
    const bad = checkNoExtra(args, allowed)
    if (bad) return fail(bad)
    if (args.run_url !== undefined && (typeof args.run_url !== 'string' || !URL_RE.test(args.run_url))) return fail('run_url must be an https link without spaces or quotes')
    const r = ctx.latestFindings?.()
    if (!r?.ok) return fail(r?.text ?? 'No run has been saved yet.')
    const res = await ctx.runCli(argv(r.dir, args), { timeoutMs: 60000 })
    if (res.timedOut) return timedOut(`meerkat ${word}`)
    return { content: [{ type: 'text', text: out(res) || `exit ${res.code}` }], structuredContent: { run: r.doc.run?.id ?? null, exitCode: res.code }, isError: res.code !== 0 }
  }

  return {
    meerkat_doctor: folderTool('doctor', (f) => ['doctor', f, '--json']),
    meerkat_discover: folderTool('discover', (f) => ['discover', f, '--json']),
    meerkat_recommend: folderTool('recommend', (f) => ['recommend', f, '--json']),
    meerkat_tools: folderTool('tools', (f) => ['tools', f, '--json']),
    meerkat_trend: folderTool('trend', (f) => ['trend', '--app', f], { json: false }),
    meerkat_hook_status: folderTool('hook status', (f) => ['hook', 'status', f], { json: false }),
    meerkat_suggest: newestRunTool('suggest', [], (dir) => ['suggest', dir]),
    meerkat_pr_comment: newestRunTool('pr-comment', ['run_url'], (dir, a) => ['pr-comment', dir, ...(a.run_url ? ['--run-url', a.run_url] : [])]),

    async meerkat_dismissals(args, ctx) {
      const bad = checkNoExtra(args, ['folder', 'stats'])
      if (bad) return fail(bad)
      const stats = bool(args, 'stats')
      if (stats.error) return fail(stats.error)
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      const r = await ctx.runCli(['dismissals', '--app', f.folder, ...(stats.value ? ['--stats'] : [])], { timeoutMs: 60000 })
      if (r.timedOut) return timedOut('meerkat dismissals')
      return { content: [{ type: 'text', text: out(r) || `exit ${r.code}` }], structuredContent: { exitCode: r.code }, isError: r.code !== 0 }
    },

    async meerkat_describe(args, ctx) {
      const bad = checkNoExtra(args, [])
      if (bad) return fail(bad)
      const r = await ctx.runCli(['describe'], { timeoutMs: 30000 })
      if (r.timedOut) return timedOut('meerkat describe')
      const data = parse(r)
      if (!data) return fail(`meerkat describe exited with code ${r.code}:\n${out(r)}`)
      return { content: [{ type: 'text', text: safe(JSON.stringify(data, null, 2)) }], structuredContent: { exitCode: r.code } }
    },

    async meerkat_undismiss(args, ctx) {
      const bad = checkNoExtra(args, ['folder', 'id'])
      if (bad) return fail(bad)
      if (args.folder === undefined) return fail('folder is required: the project the newest run belongs to')
      if (typeof args.id !== 'string' || !ID_RE.test(args.id)) return fail('id must be a finding id or its first 4 or more characters (letters, digits, dash, underscore)')
      const t = writeTarget(args, ctx, true)
      if (t.error) return fail(t.error)
      const r = await ctx.runCli(['undismiss', args.id, '--app', t.folder, '--run', t.runDir], { timeoutMs: 60000 })
      if (r.timedOut) return timedOut('meerkat undismiss')
      return { content: [{ type: 'text', text: out(r) || `exit ${r.code}` }], structuredContent: { exitCode: r.code }, isError: r.code !== 0 }
    },

    async meerkat_hook(args, ctx) {
      const bad = checkNoExtra(args, ['folder', 'action'])
      if (bad) return fail(bad)
      if (args.folder === undefined) return fail('folder is required: the git project to put the hook in')
      if (args.action !== 'install' && args.action !== 'remove') return fail('action must be "install" or "remove"')
      const t = writeTarget(args, ctx, false)
      if (t.error) return fail(t.error)
      const r = await ctx.runCli(['hook', args.action, t.folder], { timeoutMs: 60000 })
      if (r.timedOut) return timedOut('meerkat hook')
      return { content: [{ type: 'text', text: out(r) || `exit ${r.code}` }], structuredContent: { exitCode: r.code }, isError: r.code !== 0 }
    },
  }
}
