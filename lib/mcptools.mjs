// The tools added to the MCP server after the first six: gate, smoke, blast, map, tests, findings, finding, redtest, dismiss and baseline.
// Each one is a thin wrapper. It validates its input, then either reads a saved file through `ctx` (tests, findings, finding) or starts the
// matching Meerkat command with an argument list (gate, smoke, blast, map, redtest, dismiss, baseline). Never a shell string.
// Written as a factory so it can share the helpers of lib/mcp.mjs without importing it (that file imports this one).
import { findingDetailText } from './findingscmd.mjs'

export const REDTEST_KINDS = ['mutation', 'faults', 'adversarial', 'regression', 'cleantwin', 'all']
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/@^~-]{0,199}$/
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const REF_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._/@^~-]{0,199}$'
const ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$'

const FOLDER = { type: 'string', description: 'The project folder. Must be inside the folder the server was started in or one added with `meerkat root add`. Defaults to the start-up folder.' }
const FOLDER_REQUIRED = { type: 'string', minLength: 1, description: 'Required. The project folder the newest run belongs to. The write is refused if the newest run was of another folder. Must be inside the folder the server was started in or one added with `meerkat root add`.' }
const GATE_PROPS = {
  folder: FOLDER,
  staged: { type: 'boolean', description: 'Cover the files staged in git (what a commit would contain). Use before a commit.' },
  base: { type: 'string', pattern: REF_PATTERN, description: 'A git ref. Cover the files changed on this branch since it split from that ref, for example "origin/main". Use before a PR.' },
  against: { type: 'string', pattern: REF_PATTERN, description: 'A git ref. Cover the files that differ from that ref right now.' },
  thorough: { type: 'boolean', description: 'Use the thorough tier of each check (slower). Default is the fast tier.' },
}

// A description is two lines: what the tool does, then when to use it.
const two = (what, when) => `${what}\n${when}`

export const NEW_TOOLS = [
  {
    name: 'meerkat_gate',
    description: two('Runs only the checks that cover the files you changed and reports pass, fail or not run for each; exit code 0 means safe to go on.', "Use before a commit (staged: true) or before opening a PR (base: \"origin/main\"). It runs the project's own commands, so only point it at projects the person trusts. With none of staged, base or against it checks uncommitted changes."),
    inputSchema: { type: 'object', properties: GATE_PROPS, additionalProperties: false },
    annotations: { title: 'Gate the changed files', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_smoke',
    description: two('Proves each selected check starts, runs and stops within a few seconds, so a broken or hanging check is found fast.', "Use as a quick \"does the toolchain work here\" test before trusting a gate or a run. Takes the same file selection as meerkat_gate, plus a timeout. It runs the project's own commands."),
    inputSchema: { type: 'object', properties: { ...GATE_PROPS, timeout: { type: 'integer', minimum: 1, maximum: 600, description: 'Seconds each check may take before it counts as hung. Default 5.' } }, additionalProperties: false },
    annotations: { title: 'Smoke-check the checks', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_blast',
    description: two('Shows the blast radius of a file or a symbol: what imports it, what it imports and what could break if it changes.', 'Use before editing a file you do not know well. Give "src/a.js" or "src/a.js#name". "found": false in the result means the file is not in the code map.'),
    inputSchema: { type: 'object', properties: { target: { type: 'string', minLength: 1, maxLength: 500, description: 'A file path relative to the folder, optionally followed by #symbol, for example "lib/gate.mjs#runGate".' }, folder: FOLDER }, required: ['target'], additionalProperties: false },
    annotations: { title: 'Blast radius', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_map',
    description: two('Builds the code map of a project (files, exports, imports, most imported files) and saves codemap.json and codemap.md in a new run folder.', "Use first when you meet an unfamiliar codebase, then read the resource meerkat://map/latest. It reads source files and writes only into Meerkat's own log folder."),
    inputSchema: { type: 'object', properties: { folder: FOLDER }, additionalProperties: false },
    annotations: { title: 'Map the codebase', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_tests',
    description: two('Returns the catalog of everything Meerkat can check: the kinds of check, the families, each check, what it proves, its cost and when it runs (commit, pr, gate, promote).', 'Use to decide which check or preset to run, or to explain what a check proves. detail "summary" (default) is small; "full" lists every check. Reads files only.'),
    inputSchema: { type: 'object', properties: { detail: { type: 'string', enum: ['summary', 'full'], description: 'summary: kinds, families and presets. full: also every check. Default summary.' } }, additionalProperties: false },
    annotations: { title: 'Test catalog', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_findings',
    description: two('Lists the findings of the newest run, most severe first, with rule, place and status; no explanations.', 'Use after meerkat_run or meerkat_gate to see what to fix. Filter with severity, check, suite or status; then call meerkat_finding for one. Reads files only.'),
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: SEVERITIES, description: 'Only findings of this severity.' },
        check: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', description: 'Only findings of this check id.' },
        suite: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', description: 'Only findings of this suite.' },
        status: { type: 'string', enum: ['new', 'known'], description: 'new: not seen in an earlier run. known: seen before.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Most findings to return. Default 50.' },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List findings', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_finding',
    description: two('Returns one finding of the newest run in full: what, where, evidence, which check found it, its log and a fix hint.', 'Use when you have an id from meerkat_findings and are about to fix it. The first 4 or more characters of the id are enough. Reads files only.'),
    inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: ID_PATTERN, description: 'The finding id, or its first 4 or more characters.' } }, required: ['id'], additionalProperties: false },
    annotations: { title: 'One finding', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_redtest',
    description: two("Runs Meerkat's own red tests: deliberate attacks on its checks to prove they still catch real defects (kinds: mutation, faults, adversarial, regression, cleantwin).", "Use when changing Meerkat itself or when you doubt a check can fail. Start with one kind; \"all\" takes minutes. Runs Meerkat's test files only."),
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: REDTEST_KINDS, description: 'Which red tests to run. Default "regression".' } }, additionalProperties: false },
    annotations: { title: 'Red-test Meerkat', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_dismiss',
    description: two('WRITES: records one finding of the newest run as "not a problem", with your reason, so it stops failing checks. Saved in the home folder, not in the project.', "Use only when the person has agreed the finding is a false alarm; never to make a run pass. Keep the client's approval step on. Needs an id from meerkat_findings and a reason."),
    inputSchema: { type: 'object', properties: { folder: FOLDER_REQUIRED, id: { type: 'string', pattern: ID_PATTERN, description: 'The finding id, or its first 4 or more characters.' }, reason: { type: 'string', minLength: 3, maxLength: 500, description: 'Why it is not a problem. Kept with the dismissal.' } }, required: ['folder', 'id', 'reason'], additionalProperties: false },
    annotations: { title: 'Dismiss a finding', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'meerkat_baseline',
    description: two('WRITES: accepts every open finding of the newest run as the baseline, so a ratchet run fails only on findings that are not in it. clear: true removes the baseline.', "Use only when the person asks to adopt a legacy project; never to hide new problems. Keep the client's approval step on. Saved in the home folder."),
    inputSchema: { type: 'object', properties: { folder: FOLDER_REQUIRED, clear: { type: 'boolean', description: 'true removes the baseline instead of saving one.' } }, required: ['folder'], additionalProperties: false },
    annotations: { title: 'Baseline the findings', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
]

export function makeNewTools({ safe, fail, pickFolder, checkNoExtra }) {
  const bool = (args, key) => {
    if (args[key] === undefined) return { value: false }
    return typeof args[key] === 'boolean' ? { value: args[key] } : { error: `${key} must be true or false` }
  }
  const ref = (args, key) => {
    if (args[key] === undefined) return { value: null }
    return typeof args[key] === 'string' && REF_RE.test(args[key]) && !args[key].includes('..') ? { value: args[key] } : { error: `${key} must be a git ref such as "origin/main" (letters, digits and . _ / @ ^ ~ -, not starting with a dash)` }
  }
  const out = (r) => safe(String(r.stdout || r.stderr || '').trim())
  const timedOutResult = (what) => ({ content: [{ type: 'text', text: `${what} was stopped before it finished.` }], isError: true })
  const json = (r) => {
    try {
      return JSON.parse(String(r.stdout))
    } catch {
      return null
    }
  }

  // For the two write tools: the folder must pass pickFolder, and the newest run must belong to exactly that folder.
  const norm = (p) => String(p).split(String.fromCharCode(92)).join('/').replace(/\/+$/, '')
  const same = (a, b) => (/^[A-Za-z]:/.test(norm(a)) ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b))
  function writeTarget(args, ctx, needRun) {
    const f = pickFolder({ folder: args.folder }, ctx)
    if (f.error) return { error: f.error }
    if (!needRun) return { folder: f.folder }
    const r = ctx.latestFindings?.()
    if (!r?.ok) return { error: r?.text ?? 'No run has been saved yet.' }
    const runPath = r.doc.run?.project?.path
    if (typeof runPath !== 'string' || !runPath) return { error: 'The newest run does not record which project it belongs to, so nothing was written. Run meerkat again on this folder.' }
    let real
    try {
      real = ctx.realpath(runPath)
    } catch {
      return { error: `The newest run belongs to ${safe(runPath)}, which cannot be resolved, so nothing was written.` }
    }
    if (!same(real, f.folder)) return { error: `The newest run belongs to ${safe(real)}, not ${safe(f.folder)}, so nothing was written. Run meerkat on ${safe(f.folder)} first.` }
    return { folder: f.folder, runDir: r.dir }
  }

  async function gateLike(word, args, ctx) {
    const bad = checkNoExtra(args, ['folder', 'staged', 'base', 'against', 'thorough', ...(word === 'smoke' ? ['timeout'] : [])])
    if (bad) return fail(bad)
    const f = pickFolder(args, ctx)
    if (f.error) return fail(f.error)
    const staged = bool(args, 'staged')
    const thorough = bool(args, 'thorough')
    const base = ref(args, 'base')
    const against = ref(args, 'against')
    for (const x of [staged, thorough, base, against]) if (x.error) return fail(x.error)
    if (staged.value && (base.value || against.value)) return fail('staged cannot be used with base or against')
    if (base.value && against.value) return fail('base and against cannot be used together')
    const argv = [word, '--app', f.folder, '--json']
    if (staged.value) argv.push('--staged')
    if (base.value) argv.push('--base', base.value)
    if (against.value) argv.push('--against', against.value)
    if (thorough.value) argv.push('--thorough')
    if (word === 'smoke' && args.timeout !== undefined) {
      if (!Number.isInteger(args.timeout) || args.timeout < 1 || args.timeout > 600) return fail('timeout must be a whole number of seconds from 1 to 600')
      argv.push('--timeout', String(args.timeout))
    }
    const r = await ctx.runCli(argv, { timeoutMs: 30 * 60 * 1000 })
    if (r.timedOut) return timedOutResult(`meerkat ${word}`)
    const parsed = json(r)
    if (!parsed) return { content: [{ type: 'text', text: `meerkat ${word} exited with code ${r.code}:\n${out(r)}` }], isError: r.code !== 0 }
    const rows = (parsed.rows ?? []).map((x) => ({ id: x.id, result: x.kind, detail: x.detail ? safe(String(x.detail).split('\n')[0].slice(0, 200)) : null }))
    const s = { exitCode: r.code, kind: word, scope: safe(String(parsed.desc ?? '')), files: Array.isArray(parsed.files) ? parsed.files.length : 0, rows, skipped: Array.isArray(parsed.skipped) ? parsed.skipped.length : 0, note: parsed.note ? safe(String(parsed.note)) : null }
    const lines = [`meerkat ${word}: ${s.scope}, ${s.files} file(s), exit ${r.code} (0 passed, 1 failed, 75 could not run)`, ...rows.map((x) => `${String(x.result).toUpperCase()}  ${x.id}${x.detail ? `  ${x.detail}` : ''}`)]
    if (s.skipped) lines.push(`skipped (no changed file in their paths): ${s.skipped}`)
    if (s.note) lines.push(s.note)
    return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: s, isError: r.code !== 0 }
  }

  return {
    meerkat_gate: (args, ctx) => gateLike('gate', args, ctx),
    meerkat_smoke: (args, ctx) => gateLike('smoke', args, ctx),

    async meerkat_blast(args, ctx) {
      const bad = checkNoExtra(args, ['target', 'folder'])
      if (bad) return fail(bad)
      const t = args.target
      if (typeof t !== 'string' || !t.trim() || t.length > 500 || /[\0\r\n]/.test(t) || t.startsWith('-') || t.startsWith('#')) return fail('target must be a file path, optionally with #symbol, for example "src/a.js#name" (not starting with a dash)')
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      const r = await ctx.runCli(['blast', t, '--app', f.folder, '--json'], { timeoutMs: 120000 })
      if (r.timedOut) return timedOutResult('meerkat blast')
      const parsed = json(r)
      if (!parsed) return fail(`meerkat blast exited with code ${r.code}:\n${out(r)}`)
      return { content: [{ type: 'text', text: safe(JSON.stringify(parsed, null, 2)) }], structuredContent: { found: Boolean(parsed.found), exitCode: r.code } }
    },

    async meerkat_map(args, ctx) {
      const bad = checkNoExtra(args, ['folder'])
      if (bad) return fail(bad)
      const f = pickFolder(args, ctx)
      if (f.error) return fail(f.error)
      const r = await ctx.runCli(['map', '--app', f.folder, '--json'], { timeoutMs: 300000 })
      if (r.timedOut) return timedOutResult('meerkat map')
      const parsed = json(r)
      if (!parsed || r.code !== 0) return fail(`meerkat map exited with code ${r.code}:\n${out(r)}`)
      const s = { runFolder: parsed.runDir, files: parsed.files, summary: parsed.summary }
      return { content: [{ type: 'text', text: `Code map saved in ${parsed.runDir} (codemap.json, codemap.md).\n${safe(JSON.stringify(parsed.summary))}\nRead the resource meerkat://map/latest for the map.` }], structuredContent: s }
    },

    async meerkat_tests(args, ctx) {
      const bad = checkNoExtra(args, ['detail'])
      if (bad) return fail(bad)
      const detail = args.detail ?? 'summary'
      if (detail !== 'summary' && detail !== 'full') return fail('detail must be "summary" or "full"')
      const d = await ctx.buildCatalog()
      const body = detail === 'full' ? d : { schema: d.schema, triggerMeaning: d.triggerMeaning, costMeaning: d.costMeaning, presets: d.presets, totals: d.totals, kinds: d.kinds, families: d.families }
      const lines = [`Meerkat test catalog: ${d.totals.kinds} kinds, ${d.totals.families} families, ${d.totals.checks} checks`, ...d.kinds.map((k) => `${k.id}: ${k.proves} (${k.checkCount} checks, ${k.cost}, ${(k.triggers ?? []).join('/')})`)]
      return { content: [{ type: 'text', text: safe(lines.join('\n')) }], structuredContent: body }
    },

    async meerkat_findings(args, ctx) {
      const bad = checkNoExtra(args, ['severity', 'check', 'suite', 'status', 'limit'])
      if (bad) return fail(bad)
      if (args.severity !== undefined && !SEVERITIES.includes(args.severity)) return fail(`severity must be one of: ${SEVERITIES.join(', ')}`)
      for (const k of ['check', 'suite']) if (args[k] !== undefined && (typeof args[k] !== 'string' || !NAME_RE.test(args[k]))) return fail(`${k} must be a lowercase id such as "secrets"`)
      if (args.status !== undefined && !['new', 'known'].includes(args.status)) return fail('status must be "new" or "known"')
      let limit = 50
      if (args.limit !== undefined) {
        if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 500) return fail('limit must be a whole number from 1 to 500')
        limit = args.limit
      }
      const r = ctx.latestFindings?.()
      if (!r?.ok) return fail(r?.text ?? 'No run has been saved yet.')
      const all = r.doc.findings ?? []
      const rows = all
        .filter((f) => (!args.severity || f.severity === args.severity) && (!args.check || f.check === args.check) && (!args.suite || f.suite === args.suite) && (!args.status || f.status === args.status))
        .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
      const one = (v) => (typeof v === 'string' ? safe(v) : (v ?? null))
      const shown = rows.slice(0, limit).map((f) => ({ id: f.id, severity: f.severity, rule: f.rule ?? null, check: f.check, suite: f.suite, file: one(f.file), line: f.line ?? null, status: f.status, message: one(f.message) }))
      const text = shown.length ? shown.map((f) => `${f.id}  ${f.severity}  ${f.rule ?? f.check}  ${f.file ?? '(no file)'}${f.line ? `:${f.line}` : ''}  ${f.status}  ${f.message ?? ''}`).join('\n') : 'No findings match.'
      return { content: [{ type: 'text', text: `${text}${rows.length > shown.length ? `\n(${rows.length - shown.length} more; raise limit)` : ''}` }], structuredContent: { run: r.doc.run?.id ?? null, total: all.length, matched: rows.length, findings: shown } }
    },

    async meerkat_finding(args, ctx) {
      const bad = checkNoExtra(args, ['id'])
      if (bad) return fail(bad)
      if (typeof args.id !== 'string' || !ID_RE.test(args.id)) return fail('id must be a finding id or its first 4 or more characters (letters, digits, dash, underscore)')
      const r = ctx.latestFindings?.()
      if (!r?.ok) return fail(r?.text ?? 'No run has been saved yet.')
      const hits = (r.doc.findings ?? []).filter((f) => f.id === args.id || f.id.startsWith(args.id))
      if (hits.length !== 1) return fail(hits.length ? `"${args.id}" matches ${hits.length} findings: use more characters.` : `No finding with id ${args.id} in the newest run (meerkat_findings lists them).`)
      return { content: [{ type: 'text', text: safe(findingDetailText(hits[0], r.doc)) }], structuredContent: { id: hits[0].id, severity: hits[0].severity, status: hits[0].status } }
    },

    async meerkat_redtest(args, ctx) {
      const bad = checkNoExtra(args, ['kind'])
      if (bad) return fail(bad)
      const kind = args.kind ?? 'regression'
      if (!REDTEST_KINDS.includes(kind)) return fail(`kind must be one of: ${REDTEST_KINDS.join(', ')}`)
      const r = await ctx.runRedtest(kind, { timeoutMs: 30 * 60 * 1000 })
      if (r.timedOut) return timedOutResult('the red tests')
      const tail = safe(String(r.stdout || r.stderr || '').trim().split('\n').slice(-25).join('\n'))
      return { content: [{ type: 'text', text: `Red tests (${kind}) exited with code ${r.code}${r.code === 0 ? ': all passed' : ': some failed or could not run'}.\n${tail}` }], structuredContent: { kind, exitCode: r.code }, isError: r.code !== 0 }
    },

    async meerkat_dismiss(args, ctx) {
      const bad = checkNoExtra(args, ['folder', 'id', 'reason'])
      if (bad) return fail(bad)
      if (args.folder === undefined) return fail('folder is required: the project the newest run belongs to')
      if (typeof args.id !== 'string' || !ID_RE.test(args.id)) return fail('id must be a finding id or its first 4 or more characters (letters, digits, dash, underscore)')
      if (typeof args.reason !== 'string' || args.reason.trim().length < 3 || args.reason.length > 500 || /[\0\r\n]/.test(args.reason)) return fail('reason is required: 3 to 500 characters on one line')
      const t = writeTarget(args, ctx, true)
      if (t.error) return fail(t.error)
      const r = await ctx.runCli(['dismiss', args.id, '--reason', args.reason.trim(), '--app', t.folder, '--run', t.runDir], { timeoutMs: 60000 })
      return { content: [{ type: 'text', text: out(r) || `exit ${r.code}` }], structuredContent: { exitCode: r.code }, isError: r.code !== 0 }
    },

    async meerkat_baseline(args, ctx) {
      const bad = checkNoExtra(args, ['folder', 'clear'])
      if (bad) return fail(bad)
      if (args.folder === undefined) return fail('folder is required: the project the newest run belongs to')
      const clear = bool(args, 'clear')
      if (clear.error) return fail(clear.error)
      const t = writeTarget(args, ctx, !clear.value)
      if (t.error) return fail(t.error)
      const argv = clear.value ? ['baseline', '--clear', '--app', t.folder] : ['baseline', '--app', t.folder, '--run', t.runDir]
      const r = await ctx.runCli(argv, { timeoutMs: 60000 })
      return { content: [{ type: 'text', text: out(r) || `exit ${r.code}` }], structuredContent: { exitCode: r.code }, isError: r.code !== 0 }
    },
  }
}
