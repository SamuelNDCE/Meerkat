// The command registry: one object per command. It drives `meerkat help`, `meerkat <command> --help`, the
// "did you mean" hint, `meerkat describe` (for AI agents), the menu's wording and the shell completions.
// Plain English, short lines. Keep docs/commands.md in step with this file.
import { stripControl } from './tui/safe.mjs'

export const EXIT_CODES = [
  { code: 0, meaning: 'everything passed' },
  { code: 1, meaning: 'a check failed or could not run' },
  { code: 2, meaning: 'a usage or configuration error (the message says what to change)' },
  { code: 3, meaning: 'nothing to run (the preset selected no checks here)' },
  { code: 130, meaning: 'interrupted' },
]

export const GLOBAL_OPTIONS = [
  { flag: '-h, --help', text: 'help for the command (also: meerkat help <command>)' },
  { flag: '--json', text: 'print the result as one JSON object or list on stdout, nothing else' },
  { flag: '-q, --quiet', text: 'print only the final result line' },
  { flag: '--no-color', text: 'no colour (NO_COLOR and MEERKAT_PLAIN=1 do the same)' },
  { flag: '-y, --yes', text: 'say yes to a question, so nothing waits for typing' },
  { flag: '--no-input', text: 'never ask; a question that needs an answer is an error' },
  { flag: '--dry-run', text: 'show what a command that changes things would do, and do nothing' },
]

const RUN_OPTIONS = [
  { flag: '--ai', text: 'include the AI checks' },
  { flag: '--json', text: 'print the run summary as one JSON object (stdout only)' },
  { flag: '--plain', text: 'no board, plain lines' },
  { flag: '--no-color', text: 'no colour' },
  { flag: '-q, --quiet', text: 'print only the final result line' },
  { flag: '--fail-fast', text: 'stop starting new checks after a failure' },
  { flag: '--keep-going', text: 'run every check even after a failure (the default)' },
  { flag: '--group <kinds>', text: 'only these kinds: security, functionality, ui, performance, refactor' },
  { flag: '--include <name>', text: 'add an opt-in group of checks, for example ai' },
  { flag: '--only <ids>', text: 'only these checks (comma separated)' },
  { flag: '--config <file>', text: 'use this meerkat.config.json' },
  { flag: '--no-config', text: 'ignore meerkat.config.json' },
]

const RUN_OUTPUT = 'The board and notes go to stderr. With --json, stdout is one object: the run summary plus "runDir". Exit codes: 0, 1, 2, 3, 130.'

// group: where the command shows in `meerkat help`.
export const COMMANDS = [
  { name: 'verify', group: 'Run', aliases: ['quick', 'test'], summary: 'run the quick checks', usage: ['meerkat verify [folder]'], options: RUN_OPTIONS, examples: ['meerkat verify', 'meerkat verify ../my-app', 'meerkat verify --json', 'meerkat verify --only secret-scan'], output: RUN_OUTPUT },
  { name: 'full', group: 'Run', aliases: ['thorough'], summary: 'run every check, the slow ones too', usage: ['meerkat full [folder]'], options: RUN_OPTIONS, examples: ['meerkat full', 'meerkat full my-app --json'], output: RUN_OUTPUT },
  { name: 'run', group: 'Look at results', aliases: ['runs'], summary: 'past runs: list, show, log, open (also runs a preset)', usage: ['meerkat run list [--limit <n>]', 'meerkat run show [id]', 'meerkat run log <check> [id]', 'meerkat run open [id]', 'meerkat run <preset> [folder]'], options: [{ flag: '--limit <n>', text: 'how many runs to list (default 20)' }], examples: ['meerkat run list', 'meerkat run show', 'meerkat run log secret-scan', 'meerkat run list --json'], output: 'Runs are read from the log folder (MEERKAT_LOG_DIR, else ~/.meerkat/logs). --json prints the data as JSON.' },
  { name: 'last', group: 'Look at results', aliases: [], summary: 'show the report of the newest run', usage: ['meerkat last'], options: [], examples: ['meerkat last'], output: 'Same as: meerkat run show' },
  { name: 'why', group: 'Look at results', aliases: ['log'], summary: 'show one check\'s log from the newest run', usage: ['meerkat why <check> [run-id]'], options: [], examples: ['meerkat why secret-scan'], output: 'Same as: meerkat run log <check>' },
  { name: 'logs', group: 'Look at results', aliases: [], summary: 'print the folder where logs are kept', usage: ['meerkat logs'], options: [], examples: ['meerkat logs'], output: 'Same as: meerkat run open' },
  { name: 'check', group: 'Checks, presets, packs', aliases: [], summary: 'list or show checks, or run only some of them', usage: ['meerkat check list [folder]', 'meerkat check show <id> [folder]', 'meerkat check <id>... [folder]'], options: [{ flag: '--json', text: 'check list and check show print JSON' }, ...RUN_OPTIONS.filter((o) => !o.flag.startsWith('--json'))], examples: ['meerkat check list', 'meerkat check list --json', 'meerkat check show secret-scan', 'meerkat check secret-scan eslint ../my-app'], output: 'check list fields: id, kind, tier, lane, weight, seconds, title, optIn, pack. Running checks: see meerkat verify --help.' },
  { name: 'preset', group: 'Checks, presets, packs', aliases: ['presets'], summary: 'list, show, create or delete presets (named runs)', usage: ['meerkat preset list', 'meerkat preset show <name> [folder]', 'meerkat preset new [--name <n> --tier fast|thorough --group <kinds> --pack <name> --about <text> --personal|--project]', 'meerkat preset delete <name>'], options: [{ flag: '--name <name>', text: 'preset name: lowercase letters, numbers, dashes' }, { flag: '--tier <fast|thorough>', text: 'quick or slow checks' }, { flag: '--group <kinds>', text: 'for example security,ui' }, { flag: '--pack <name>', text: 'a pack this preset brings' }, { flag: '--about <text>', text: 'one line about the preset' }, { flag: '--personal', text: 'save for you, in every project (default)' }, { flag: '--project', text: 'save in this project\'s meerkat.config.json' }], examples: ['meerkat preset list', 'meerkat preset show security', 'meerkat preset new --name pre-push --tier fast --group security,ui --personal', 'meerkat preset delete pre-push --yes'], output: 'preset list fields: name, source (bundled, personal, project), tier, kinds, about.' },
  { name: 'pack', group: 'Checks, presets, packs', aliases: [], summary: 'packs of checks: list, enable, disable, add, remove', usage: ['meerkat pack list [folder]', 'meerkat pack enable <name> [folder]', 'meerkat pack disable <name> [folder]', 'meerkat pack add <folder>', 'meerkat pack remove <folder>'], options: [], examples: ['meerkat pack list', 'meerkat pack enable python', 'meerkat pack disable python --yes', 'meerkat pack enable go --dry-run'], output: 'pack list fields: name, source, enabled, checks, tools (each with found and install).' },
  { name: 'root', group: 'Checks, presets, packs', aliases: [], summary: 'folders where project names are looked up', usage: ['meerkat root list', 'meerkat root add <folder>', 'meerkat root remove <folder>'], options: [], examples: ['meerkat root add ~/code', 'meerkat verify my-app'], output: 'Plain text.' },
  { name: 'init', group: 'Set up and look after', aliases: [], summary: 'write a starting meerkat.config.json', usage: ['meerkat init [folder]'], options: [], examples: ['meerkat init'], output: 'Never overwrites an existing config.' },
  { name: 'doctor', group: 'Set up and look after', aliases: [], summary: 'what would run here, what is missing, and how to fix it', usage: ['meerkat doctor [folder]'], options: [{ flag: '--json', text: 'print the report as JSON' }], examples: ['meerkat doctor', 'meerkat doctor ../my-app --json'], output: 'Exit 0 when nothing is missing, 1 when a check would be NOT RUN. JSON fields: folder, quickChecks, wouldRun, notRun, packsOff, suggested, next.' },
  { name: 'self-test', group: 'Set up and look after', aliases: [], summary: 'prove every check fails on its broken case', usage: ['meerkat self-test [folder]'], options: [], examples: ['meerkat self-test'], output: 'Run output, exit codes as for a run.' },
  { name: 'ai', group: 'Set up and look after', aliases: [], summary: 'choose the model for the AI checks', usage: ['meerkat ai status', 'meerkat ai use <claude|openai|openrouter> [model]', 'meerkat ai test'], options: [{ flag: '--json', text: 'ai status prints JSON' }], examples: ['meerkat ai status', 'meerkat ai use claude haiku', 'meerkat ai use openrouter deepseek/deepseek-chat'], output: 'Plain text; ai status --json prints { text }.' },
  { name: 'update', group: 'Set up and look after', aliases: [], summary: 'update Meerkat (off by default)', usage: ['meerkat update [--check] [--yes]', 'meerkat update auto|notify|off|status'], options: [], examples: ['meerkat update --check', 'meerkat update notify'], output: 'Plain text.' },
  { name: 'mcp', group: 'Set up and look after', aliases: [], summary: 'register or run the tool server for AI agents', usage: ['meerkat mcp install [claude] [--dry-run]', 'meerkat mcp serve', 'meerkat mcp status'], options: [], examples: ['meerkat mcp install --dry-run', 'meerkat mcp install', 'meerkat mcp status'], output: 'install registers Meerkat with Claude Code for you (user scope). serve speaks MCP on stdin and stdout.' },
  { name: 'completion', group: 'Set up and look after', aliases: [], summary: 'print a shell completion script', usage: ['meerkat completion powershell|bash|zsh'], options: [], examples: ['meerkat completion powershell', 'meerkat completion bash'], output: 'The script on stdout. docs/commands.md says where to put it.' },
  { name: 'describe', group: 'Set up and look after', aliases: [], summary: 'every command, option and output field as JSON, for AI agents', usage: ['meerkat describe'], options: [], examples: ['meerkat describe'], output: 'One JSON object: commands, aliases, options, exit codes, output fields, presets.' },
  { name: 'bug', group: 'Set up and look after', aliases: [], summary: 'a bug report to paste into an issue', usage: ['meerkat bug'], options: [], examples: ['meerkat bug'], output: 'Secrets are removed. Nothing is sent.' },
  { name: 'menu', group: 'Set up and look after', aliases: [], summary: 'open the menu (needs a terminal)', usage: ['meerkat menu'], options: [], examples: ['meerkat menu'], output: 'meerkat on its own opens the menu in a terminal.' },
  { name: 'version', group: 'Set up and look after', aliases: [], summary: 'print the version', usage: ['meerkat version'], options: [], examples: ['meerkat --version'], output: 'The version number.' },
  { name: 'help', group: 'Set up and look after', aliases: [], summary: 'help for Meerkat or for one command', usage: ['meerkat help [command]'], options: [], examples: ['meerkat help', 'meerkat help verify'], output: 'Plain text.' },
]

// Words that older versions accepted and that still work. They are commands too, for help and for completion.
export const LEGACY_WORDS = { list: 'check', 'self-test': 'self-test' }

export const nameOf = (word) => {
  const w = String(word ?? '')
  const hit = COMMANDS.find((c) => c.name === w || c.aliases.includes(w))
  return hit ? hit.name : null
}
export const commandNames = () => COMMANDS.map((c) => c.name)
export const allWords = () => [...new Set(COMMANDS.flatMap((c) => [c.name, ...c.aliases]))]
export const summaryOf = (name) => COMMANDS.find((c) => c.name === name)?.summary ?? ''

export function editDistance(a, b) {
  const m = a.length
  const n = b.length
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[m][n]
}

// The closest command or preset within edit distance 2, or null.
export function suggest(word, presetNames = []) {
  const w = String(word ?? '').toLowerCase()
  if (!w) return null
  let best = null
  for (const c of [...allWords(), ...presetNames]) {
    const d = editDistance(w, c)
    if (d <= 2 && d < w.length && (!best || d < best.d)) best = { c, d }
  }
  return best ? best.c : null
}

const block = (title, rows) => (rows.length ? ['', `${title}:`, ...rows.map((r) => `  ${r}`)] : [])

// Help for one command. Examples first, short, a pointer to the README at the end.
export function commandHelp(word) {
  const name = nameOf(word)
  const c = COMMANDS.find((x) => x.name === name)
  if (!c) return null
  const w = Math.max(0, ...c.options.map((o) => o.flag.length))
  const lines = [`meerkat ${c.name}: ${c.summary}`]
  if (c.aliases.length) lines.push(`Also: ${c.aliases.map((a) => `meerkat ${a}`).join(', ')}`)
  lines.push(...block('Examples', c.examples))
  lines.push(...block('Usage', c.usage))
  lines.push(...block('Options', c.options.map((o) => `${o.flag.padEnd(w)}  ${o.text}`)))
  lines.push(...block('Output', [c.output]))
  lines.push('', 'Every command also takes -h/--help. More: README.md')
  return lines.join('\n')
}

// `meerkat help`: the concise overview, grouped.
export function overviewHelp(presetNames = []) {
  const groups = []
  for (const c of COMMANDS) {
    if (['menu', 'version', 'help', 'last', 'why', 'logs'].includes(c.name)) continue
    let g = groups.find((x) => x.name === c.group)
    if (!g) groups.push((g = { name: c.group, rows: [] }))
    g.rows.push(c)
  }
  const lines = ['MEERKAT: one command that checks your project.', '', 'Examples:', '  meerkat verify                the quick checks on this folder', '  meerkat full ../my-app        every check on another project', '  meerkat security              one kind (a preset)', '  meerkat verify --json         the result as JSON for a script']
  for (const g of groups) {
    lines.push('', `${g.name}:`)
    for (const c of g.rows) lines.push(`  meerkat ${c.name.padEnd(11)} ${c.summary}`)
  }
  lines.push('', `Presets (meerkat <preset> [folder]): ${presetNames.join(', ')}`, 'Results and look-ups: meerkat last, meerkat why <check>, meerkat logs', 'meerkat on its own opens a menu in a terminal.', 'Help for one command: meerkat <command> --help', 'More: README.md')
  return lines.join('\n')
}

export const OUTPUT_FIELDS = {
  run: ['schema', 'version', 'tier', 'preset', 'summary', 'exitCode', 'startedAt', 'endedAt', 'ms', 'machine', 'git', 'selection', 'configFile', 'argv', 'counts', 'results', 'runDir'],
  'run.results[]': ['id', 'status', 'detail', 'ms', 'logFile'],
  'check list': ['id', 'kind', 'tier', 'lane', 'weight', 'seconds', 'title', 'optIn', 'pack'],
  'preset list': ['name', 'source', 'tier', 'kinds', 'about'],
  'pack list': ['name', 'source', 'enabled', 'checks', 'tools[].check', 'tools[].tool', 'tools[].found', 'tools[].install'],
  doctor: ['folder', 'quickChecks', 'wouldRun', 'notRun[].id', 'notRun[].tool', 'notRun[].install', 'notRun[].fix', 'packsOff[].name', 'packsOff[].fix', 'suggested[].name', 'suggested[].why', 'suggested[].fix', 'next'],
  'run list': ['id', 'dir', 'tier', 'preset', 'summary', 'exitCode', 'startedAt', 'counts'],
}

// `meerkat describe`: everything, stable and complete, for programs.
export function describe({ version = '', presetNames = [] } = {}) {
  return {
    schema: 1,
    name: 'meerkat',
    version,
    about: 'One command that checks a project. Results on stdout, progress and errors on stderr.',
    commands: COMMANDS.map((c) => ({ name: c.name, aliases: c.aliases, group: c.group, summary: c.summary, usage: c.usage, options: c.options, examples: c.examples, output: c.output })),
    globalOptions: GLOBAL_OPTIONS,
    exitCodes: EXIT_CODES,
    presets: presetNames,
    outputFields: OUTPUT_FIELDS,
    notes: ['[folder] is a path or the name of a project; leave it off for the current folder.', 'No prompt ever appears without a terminal. Use --yes or --no-input.', 'Config order: flags, environment, meerkat.config.json, ~/.meerkat.json, defaults.'],
  }
}

export const safe = (x) => stripControl(String(x ?? ''))
