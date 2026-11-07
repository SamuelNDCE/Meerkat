// The tools that bring the MCP server level with the command line: meerkat_version, meerkat_check_list, meerkat_prompt and meerkat_run_list.
// Each validates its input; the first two and the last only read, meerkat_prompt writes one file into a run folder of Meerkat's own log folder.
// Never a shell string: the one child process is `node bin/meerkat.mjs` with an argument list.
import { basename } from 'node:path'
import { contextOf, READ_SCOPE_PROPS, SCOPE_KEYS } from './mcpscope.mjs'

const FOLDER = { type: 'string', description: 'The project folder. Must be inside the folder the server was started in or one added with `meerkat root add`. Defaults to the start-up folder.' }
const two = (what, when) => `${what}\n${when}`
const readOnly = (title) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })

export const PARITY_TOOLS = [
  {
    name: 'meerkat_version',
    description: two('Returns the version of this Meerkat server, the commit it was built from when that is known, and how many tools it registers.', 'Use to check that the server a client started is the one that was installed (a long-running server keeps the version it started with). Takes no argument and reads nothing from a project.'),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly('Server version'),
  },
  {
    name: 'meerkat_check_list',
    description: two("Lists the checks a project defines itself (its own checks, not the built-in ones) and the packs of checks with whether each is enabled and which outside tools it needs.", 'Use before adding a check or pack, or to see why a check exists. Read-only: it adds, edits and removes nothing (those are a person\'s steps: meerkat check new, meerkat pack enable).'),
    inputSchema: { type: 'object', properties: { folder: FOLDER }, additionalProperties: false },
    annotations: readOnly('Own checks and packs'),
  },
  {
    name: 'meerkat_prompt',
    description: two('WRITES one file: meerkat-prompt-<date>-<time>-<preset>.md in the run folder (every finding of the run in full, grouped by severity, with instructions for an AI). Never touches the clipboard.', 'Use to hand a whole run to another AI or a later session in one file. folder is required; run and preset pick an older run of that folder. The file goes into Meerkat\'s log folder, not into the project.'),
    inputSchema: { type: 'object', properties: { ...READ_SCOPE_PROPS, folder: { ...READ_SCOPE_PROPS.folder, minLength: 1, description: 'Required. The project folder the run belongs to. Must be inside the folder the server was started in or one added with `meerkat root add`.' } }, required: ['folder'], additionalProperties: false },
    annotations: { title: 'Write the AI prompt file', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_run_list',
    description: two('Lists the past runs of a project folder, newest first: run id, preset, exit code, how long it took and when it started.', 'Use to pick a run id for the run argument of meerkat_last, meerkat_findings and the others, or to see whether a project is run regularly. Reads files only.'),
    inputSchema: { type: 'object', properties: { folder: FOLDER, limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Most runs to return. Default 20.' } }, additionalProperties: false },
    annotations: readOnly('Past runs of a folder'),
  },
]

export function makeParityTools({ safe, fail, pickFolder, checkNoExtra, readScope, toolCount }) {
  const parse = (r) => {
    try {
      return JSON.parse(String(r.stdout))
    } catch {
      return null
    }
  }
  const out = (r) => safe(String(r.stdout || r.stderr || '').trim())

  return {
    async meerkat_version(args, ctx) {
      const bad = checkNoExtra(args, [])
      if (bad) return fail(bad)
      const commit = ctx.buildCommit?.() ?? null
      const s = { version: ctx.version, commit, tools: toolCount() }
      return { content: [{ type: 'text', text: `meerkat server ${s.version}${commit ? `, built from commit ${commit}` : ', build commit not known'}, ${s.tools} tools` }], structuredContent: s }
    },

    async meerkat_check_list(args, ctx) {
      const bad = checkNoExtra(args, ['folder'])
      if (bad) return fail(bad)
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      const checks = await ctx.runCli(['check', 'list', '--json', f.folder], { timeoutMs: 120000 })
      const packs = await ctx.runCli(['pack', 'list', '--json', f.folder], { timeoutMs: 120000 })
      const c = parse(checks)
      const p = parse(packs)
      if (!Array.isArray(c)) return fail(`meerkat check list exited with code ${checks.code}:\n${out(checks)}`)
      if (!p || !Array.isArray(p.packs)) return fail(`meerkat pack list exited with code ${packs.code}:\n${out(packs)}`)
      const own = c.filter((x) => x && (x.origin === 'personal' || x.origin === 'project')).map((x) => ({ id: x.id, origin: x.origin ?? null, kind: x.kind ?? null, tier: x.tier ?? null, suite: x.suite ?? null, title: typeof x.title === 'string' ? safe(x.title) : '' }))
      const packRows = p.packs.map((x) => ({ name: x.name, source: x.source ?? null, enabled: Boolean(x.enabled), checks: x.checks ?? 0, toolsMissing: (x.tools ?? []).filter((t) => t && t.found === false).map((t) => t.tool) }))
      const lines = [`${own.length} own check(s), ${packRows.length} pack(s) (${packRows.filter((x) => x.enabled).length} enabled)`, ...own.map((x) => `own  ${x.id}  ${x.origin ?? ''}  ${x.title}`), ...packRows.map((x) => `pack ${x.name}  ${x.source ?? ''}  ${x.enabled ? 'enabled' : 'off'}  ${x.checks} checks${x.toolsMissing.length ? `  missing tools: ${x.toolsMissing.join(', ')}` : ''}`)]
      return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { own, packs: packRows }, _status: `${own.length} own check(s), ${packRows.length} pack(s)` }
    },

    async meerkat_prompt(args, ctx) {
      const bad = checkNoExtra(args, SCOPE_KEYS)
      if (bad) return fail(bad)
      if (args.folder === undefined) return fail('folder is required: the project the run belongs to')
      const sc = readScope(args, ctx)
      if (sc.error) return fail(sc.error)
      const r = await ctx.runCli(['prompt', '--run-dir', sc.info.dir, '--no-copy', '--json'], { timeoutMs: 60000 })
      if (r.timedOut) return fail('meerkat prompt was stopped before it finished.')
      const data = parse(r)
      if (!data || !data.file) return fail(`meerkat prompt exited with code ${r.code}:\n${out(r)}`)
      return { content: [{ type: 'text', text: `Wrote ${data.file} (${data.findings} finding(s), every one in full). Give an AI this line: ${safe(String(data.short ?? ''))}` }], structuredContent: { file: data.file, short: safe(String(data.short ?? '')), findings: data.findings, runFolder: sc.info.dir }, _context: contextOf(sc.info), _status: `wrote ${data.file}` }
    },

    async meerkat_run_list(args, ctx) {
      const bad = checkNoExtra(args, ['folder', 'limit'])
      if (bad) return fail(bad)
      let limit = 20
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) return fail('limit must be a whole number from 1 to 100')
        limit = args.limit
      }
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      const rawRuns = ctx.listFolderRuns?.(f.folder, limit) ?? []
      const runs = rawRuns.map((x) => ({ id: x.id, preset: x.preset ?? null, exitCode: x.exitCode ?? null, ms: x.ms ?? null, startedAt: x.startedAt ?? null }))
      const rows = runs.map((x) => `${x.id}  ${x.preset ?? '-'}  exit ${x.exitCode ?? '?'}  ${x.ms == null ? '?' : (x.ms / 1000).toFixed(1)}s  ${x.startedAt ?? ''}`)
      const text = runs.length ? rows.join('\n') : `No run has been saved for ${f.folder} yet. Call meerkat_run with this folder first.`
      return { content: [{ type: 'text', text }], structuredContent: { folder: f.folder, runs }, _context: { project: ctx.listFolderRuns ? (rawRuns[0]?.project ?? (basename(f.folder) || null)) : null, projectPath: f.folder, run: runs[0]?.id ?? null, preset: null }, _status: `${runs.length} run(s)` }
    },
  }
}
