// SMOKE: runs every top-level command of `meerkat --help`, and every documented subcommand of `meerkat describe`, on a copy of tests/fixtures/smoke-app.
// The list of commands is read from the real CLI when the test starts, so a new command is covered automatically. A command that is not in EXAMPLES below
// fails the test "every command has an example", which is the reminder to add one.
// A smoke test only asks: did it finish, with a documented exit code, with some output, and without a stack trace? It does not check deep correctness.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { CLI, hasStack, makeSandbox, newestRunDir, runCli } from './smoke-helpers.mjs'

const DOCUMENTED_EXIT_CODES = [0, 1, 2, 3, 75, 130] // docs/commands.md "Exit codes"

// ---- the command list, from the CLI itself ----------------------------------------------------------------------------------------------
const cli = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', CI: '1' } }).stdout

const helpText: string = cli(['--help'])
// "  meerkat verify      run the quick checks" -> verify
const topLevel: string[] = [...helpText.matchAll(/^ {2}meerkat ([a-z][a-z-]*) {2,}\S/gm)].map((m) => m[1])
// "Results and look-ups: meerkat last, meerkat why <check>, meerkat logs" -> last, why, logs
const lookups: string[] = [...(helpText.match(/^Results and look-ups:(.*)$/m)?.[1] ?? '').matchAll(/meerkat ([a-z][a-z-]*)/g)].map((m) => m[1])
const presets: string[] = (helpText.match(/^Presets \(meerkat <preset> \[folder\]\): (.*)$/m)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// Documented subcommands: the usage lines of `meerkat describe` ("meerkat check show <id>" -> "check show"; "meerkat update auto|notify|off|status" -> four).
const described = JSON.parse(cli(['describe'])) as { commands: { name: string; usage?: string[] }[] }
const subcommands = new Set<string>()
for (const c of described.commands) {
  for (const u of c.usage ?? []) {
    const m = u.match(/^meerkat ([a-z][a-z-]*) ([a-z][a-z-]*(?:\|[a-z][a-z-]*)*)(?: |$)/)
    if (m && m[1] === c.name) for (const sub of m[2].split('|')) subcommands.add(`${c.name} ${sub}`)
  }
}

// ---- one documented example per command -------------------------------------------------------------------------------------------------
// Placeholders: {id} a finding id from the first run, {root} the sandbox folder, {rules} a data-rules file, {packs} an empty folder of packs.
// `codes` is the exit codes this example may end with (default: 0). Commands that need a person, a network or minutes are called with --help or a listing flag instead, and say why.
type Example = { args: string[]; codes?: number[]; why?: string }
const EXAMPLES: Record<string, Example> = {
  // Run
  verify: { args: ['verify', '--plain'], codes: [0, 1] }, // the quick checks: the fixture has no CI, no SECURITY.md and so on, so failures are expected
  full: { args: ['full', '--estimate'], why: 'a real full run takes minutes and runs the project\'s own tests; --estimate prints the plan' },
  repos: { args: ['repos', '--json'] },
  security: { args: ['security', '--estimate'], why: 'a preset word; --estimate prints the plan instead of running it' },
  'recent': { args: ['recent'] },
  'recent clear': { args: ['recent', 'clear'] },
  redtest: { args: ['redtest', '--help'], why: 'redtest runs Meerkat\'s own test files with vitest (about a minute): running it inside a test run is a loop' },
  gate: { args: ['gate', '--staged'], codes: [0, 1, 75] },
  smoke: { args: ['smoke', '--timeout', '20'], codes: [0, 1, 75] },
  // Look at results
  run: { args: ['run', 'list'] },
  'run list': { args: ['run', 'list'] },
  'run show': { args: ['run', 'show'] },
  'run log': { args: ['run', 'log', 'license'] },
  'run open': { args: ['run', 'open'] },
  findings: { args: ['findings', '--limit', '5'] },
  prompt: { args: ['prompt', '--print', '--no-copy'] },
  map: { args: ['map'] },
  blast: { args: ['blast', 'src/math.js#add'] },
  brief: { args: ['brief', 'src/math.js#add'] },
  lock: { args: ['lock', 'status'] },
  'lock status': { args: ['lock', 'status'] },
  'test-run': { args: ['test-run', 'src/math.js'], codes: [2], why: 'the fixture defines no commands.test, so it must say so and exit 2' },
  'who-calls': { args: ['who-calls', 'add'], codes: [0, 75], why: '75 when the fixture has no call of the name' },
  deps: { args: ['deps', 'src/math.js'], codes: [0, 75], why: '75 when the file imports no project file' },
  'tests-for': { args: ['tests-for', 'src/math.js'], codes: [0, 75], why: '75 when no test names the file' },
  verdict: { args: ['verdict'], codes: [0, 1, 2], why: 'one line for a branch; the fixture may have no base branch, then it prints a NO-RESULT line (1 or 2)' },
  fix: { args: ['fix'], codes: [0, 2], why: 'the fixture has no fixable finding, so it says no automatic fix (2) or has nothing to fix (0)' },
  handoff: { args: ['handoff'], codes: [0, 1, 2], why: 'the verdict is needed; with no base branch it says so (1 or 2)' },
  top: { args: ['top'], codes: [0, 1, 2], why: 'a table of changed-file findings; 1 or 2 with a NO-RESULT line when there is nothing to compare' },
  commands: { args: ['commands'] },
  trust: { args: ['trust'], codes: [0], why: 'the fixture defines no commands, so there is nothing to trust' },
  build: { args: ['build'], codes: [2], why: 'the fixture defines no commands.build, so it must say so and exit 2' },
  finding: { args: ['finding', '{id}'] },
  last: { args: ['last'] },
  why: { args: ['why', 'license'] },
  logs: { args: ['logs'] },
  dismiss: { args: ['dismiss', '{id}', '--reason', 'smoke test: not a problem'] },
  dismissals: { args: ['dismissals'] },
  cost: { args: ['cost', '--last', '3'] },
  team: { args: ['team'] },
  undismiss: { args: ['undismiss', '{id}'] },
  baseline: { args: ['baseline'] },
  trend: { args: ['trend'] },
  suggest: { args: ['suggest'] },
  'pr-comment': { args: ['pr-comment'] },
  // Checks, presets, packs
  tests: { args: ['tests'] },
  suite: { args: ['suite', 'list'] },
  'suite list': { args: ['suite', 'list'] },
  'suite show': { args: ['suite', 'show', 'secrets'] },
  check: { args: ['check', 'list', '--flat'] },
  'check list': { args: ['check', 'list'] },
  'check show': { args: ['check', 'show', 'secret-scan'] },
  'check new': { args: ['check', 'new', '--id', 'smoke-x', '--title', 'Smoke X', '--cmd', 'node -v', '--suite', 'smoke', '--group', 'functionality', '--tier', 'fast', '--project', '--yes'] },
  'check edit': { args: ['check', 'edit', 'smoke-x', '--title', 'Smoke X again', '--yes'] },
  'check mine': { args: ['check', 'mine'] },
  'check try': { args: ['check', 'try', 'smoke-x'], codes: [0, 1] },
  'check remove': { args: ['check', 'remove', 'smoke-x', '--yes'] },
  discover: { args: ['discover'] },
  recommend: { args: ['recommend'] },
  preset: { args: ['preset', 'list'] },
  'preset list': { args: ['preset', 'list'] },
  'preset show': { args: ['preset', 'show', 'quick'] },
  'preset new': { args: ['preset', 'new', '--name', 'smoke-p', '--tier', 'fast', '--group', 'security', '--about', 'smoke preset', '--purpose', 'smoke test', '--project'] },
  'preset edit': { args: ['preset', 'edit', 'smoke-p', '--about', 'smoke preset edited', '--project'] },
  'preset delete': { args: ['preset', 'delete', 'smoke-p', '--yes'] },
  pack: { args: ['pack', 'list'] },
  'pack list': { args: ['pack', 'list'] },
  'pack enable': { args: ['pack', 'enable', 'a11y'] },
  'pack disable': { args: ['pack', 'disable', 'a11y', '--yes'] },
  'pack add': { args: ['pack', 'add', '{packs}'] },
  'pack remove': { args: ['pack', 'remove', '{packs}'] },
  root: { args: ['root', 'list'] },
  'root list': { args: ['root', 'list'] },
  'root add': { args: ['root', 'add', '{root}'] },
  'root remove': { args: ['root', 'remove', '{root}'] },
  rules: { args: ['rules', 'test', '{rules}'] },
  'rules test': { args: ['rules', 'test', '{rules}'] },
  // Set up and look after
  init: { args: ['init'] },
  tools: { args: ['tools'] },
  'tools install': { args: ['tools', 'install', '--dry-run'], why: 'a real install downloads from the network; --dry-run lists what it would do' },
  doctor: { args: ['doctor'], codes: [0, 1] }, // exit 1 when a tool a quick check needs is missing
  'self-test': { args: ['self-test', '--help'], why: 'self-test runs every check against its broken case (minutes)' },
  ai: { args: ['ai', 'status'] },
  'ai status': { args: ['ai', 'status'] },
  'ai use': { args: ['ai', 'use', 'claude', 'haiku'] },
  'ai test': { args: ['ai', 'test', '--help'], why: 'ai test sends a real request to a model (network, maybe paid)' },
  'ai hooks': { args: ['ai', 'hooks'] },
  update: { args: ['update', 'status'] },
  'update auto': { args: ['update', 'auto'], why: 'sets the mode only (the mode is kept in the sandbox user config); nothing is installed' },
  'update notify': { args: ['update', 'notify'] },
  'update off': { args: ['update', 'off'] },
  'update status': { args: ['update', 'status'] },
  mcp: { args: ['mcp', 'status'], codes: [0, 1] }, // 1 when Meerkat is not registered with Claude Code (the sandbox home is empty)
  'mcp install': { args: ['mcp', 'install', '--dry-run'] },
  'mcp serve': { args: ['mcp', 'serve'], why: 'the server ends when its input ends (the test gives it no input)' },
  'mcp status': { args: ['mcp', 'status'], codes: [0, 1] },
  completion: { args: ['completion', 'bash'] },
  'completion powershell': { args: ['completion', 'powershell'] },
  'completion bash': { args: ['completion', 'bash'] },
  'completion zsh': { args: ['completion', 'zsh'] },
  describe: { args: ['describe'] },
  bug: { args: ['bug'] },
  hook: { args: ['hook', 'status'] },
  'hook install': { args: ['hook', 'install'] },
  'hook status': { args: ['hook', 'status'] },
  'hook remove': { args: ['hook', 'remove'] },
  // Other documented words
  menu: { args: ['menu'], codes: [2], why: 'the menu needs a terminal; with none it must say so and exit 2' },
  version: { args: ['version'] },
  memory: { args: ['memory', '--dry-run'], codes: [2], why: 'needs a memory adapter named in meerkat.config.json; the fixture has none, so it must say so and exit 2' },
  help: { args: ['help', 'gate'] },
}

// The order matters (a run store first, then everything that reads it; check new before check try): it is the order of EXAMPLES. A command not in EXAMPLES is reported by the test below.
const keys = [...new Set([...topLevel, ...lookups, ...subcommands, 'menu', 'version', 'help'])]
const ordered = [...Object.keys(EXAMPLES).filter((k) => keys.includes(k)), ...keys.filter((k) => !EXAMPLES[k])]

let sb: ReturnType<typeof makeSandbox>
let findingId = ''
beforeAll(() => {
  sb = makeSandbox({ label: 'every' })
  mkdirSync(join(sb.root, 'mypacks'))
  writeFileSync(join(sb.root, 'rules.json'), JSON.stringify({ rules: [] }))
}, 60000)
afterAll(() => sb?.cleanup())

describe('the command list is read from the real CLI', () => {
  test('--help and describe list commands', () => {
    expect(topLevel.length).toBeGreaterThan(30)
    expect(topLevel).toContain('verify')
    expect(subcommands.size).toBeGreaterThan(30)
    expect(presets.length).toBeGreaterThan(5)
  })
  test('every command and documented subcommand has an example in this test', () => {
    const missing = keys.filter((k) => !EXAMPLES[k])
    expect(missing, `add an entry to EXAMPLES in tests/smoke-every-command.test.ts for: ${missing.join(', ')}`).toEqual([])
  })
})

describe('every command runs on the fixture project', () => {
  for (const key of ordered) {
    test(`meerkat ${key}`, () => {
      const ex = EXAMPLES[key]
      if (!ex) return // reported by the test above
      const fill = (a: string) => a.replace('{id}', findingId || 'none').replace('{root}', sb.root).replace('{rules}', join(sb.root, 'rules.json')).replace('{packs}', join(sb.root, 'mypacks'))
      const r = runCli(sb, ex.args.map(fill), { timeout: 140000 })
      expect(r.timedOut, `meerkat ${ex.args.join(' ')} did not finish in time`).toBe(false)
      expect(DOCUMENTED_EXIT_CODES).toContain(r.code)
      expect(ex.codes ?? [0], `exit code ${r.code}; output: ${r.all.slice(0, 400)}`).toContain(r.code)
      expect(r.stdout.trim().length + r.stderr.trim().length, 'no output at all').toBeGreaterThan(0)
      expect(hasStack(r.all), `a stack trace in the output of meerkat ${ex.args.join(' ')}`).toBe(false)
      if (key === 'verify') {
        const dir = newestRunDir(sb)
        expect(dir, 'verify left no run folder').not.toBeNull()
        // The id of one finding, for finding / dismiss / undismiss below.
        const f = JSON.parse(spawnSync(process.execPath, [CLI, 'findings', '--json', '--limit', '1'], { cwd: sb.app, env: sb.env, encoding: 'utf8' }).stdout || '{}')
        findingId = String((f.findings ?? f.items ?? [])[0]?.id ?? '')
        expect(findingId, 'the fixture run should have at least one finding to use as an example').not.toBe('')
      }
    }, 150000)
  }
})

describe('presets are reachable', () => {
  for (const name of presets) {
    test(`meerkat preset show ${name}`, () => {
      const r = runCli(sb, ['preset', 'show', name], { timeout: 60000 })
      expect(r.code, r.all.slice(0, 300)).toBe(0)
      expect(r.stdout).toContain(name)
      expect(hasStack(r.all)).toBe(false)
    })
  }
})
