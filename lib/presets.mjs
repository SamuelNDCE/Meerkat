// Named runs: which tier and which kinds of check. `--preset security` runs every security check, `--preset ui-fast` only the quick UI
// ones. A project can add its own in meerkat.config.json ("presets": { "before-release": { "tier": "thorough", "groups": ["security"] } }).
//
//   tier    fast (before every push) or thorough (before a promotion or a release)
//   groups  which kinds of check: security, functionality, ui, performance, refactor (empty means all)
//   include opt-in checks to add (for example "ai")
//   packs   packs to load for this run (for example ["rust"]), added after the config's own packs
//   excludeChecks / excludeSubs  check ids and check/rule ids left out of the run (the bugs preset: lib/bugs-preset.mjs)
//   allPacks  true brings every pack that applies to the folder (lib/init.mjs applicablePacks), on top of the config's own: full, thorough and release
//
// A check's dependencies come with it (a UI check pulls in the build it needs), so a focused run never starts a window against nothing.
// The everyday presets run every kind of check except the code-shape measures (the refactor group: line length, function size, complexity, nesting, duplicated and dead code).
// Those are measurements, not defects, and made up most of a first scan. `meerkat run --preset refactor` (or --groups refactor) still runs them.
import { BUGS_EXCLUDED_CHECKS, BUGS_EXCLUDED_SUBS, BUGS_PRESET_ABOUT, BUGS_PRESET_PURPOSE } from './bugs-preset.mjs'

export const DEFAULT_GROUPS = ['security', 'functionality', 'ui', 'performance']

// The preset `meerkat gate` runs when none is named (since the gate-output release): bugs, so a gate finding is likely a real defect and not a style or documentation note.
// lib/gate.mjs reads this value; changing the default is a decision made here.
export const GATE_DEFAULT_PRESET = 'bugs'

// Checks quick and fast leave out (since the gate-output release): purely documentation or style rules that made up most of a first scan and say nothing about wrong behaviour.
// Formatters (prettier, cargo fmt) stay in quick on purpose: they are the one style check people expect before a push. `bugs` leaves those out too (lib/bugs-preset.mjs).
// `meerkat full` and `thorough` still run every one of these.
export const QUICK_EXCLUDED_CHECKS = [
  'markdownlint', 'markdown-headings', 'markdown-code-fences', 'typos', 'spell-common-typos',
  'readme-sections', 'readme-install-usage', 'contributing-file', 'changelog-format', 'changelog-version-headings',
  'trailing-whitespace', 'final-newline', 'indent-consistency', 'line-length', 'whitespace',
  'js-var-usage', 'css-important-overuse', 'ts-ignore-comments',
]

// COMPILE-HEAVY CHECKS never run in quick or fast (`skipCompile: true`). Time budget of quick, stated here so a change to it is a decision:
// at most 10 minutes on a large app (target 5 to 10; on a small one a minute or two), because quick is only fast static checks:
// secrets, risky code, config and file shapes, lints, formats, type checks. Anything that compiles the whole project or runs its test suite
// (cargo clippy/test/build, go test, mvn, dotnet build, swift build, pytest, rspec, npm run build, tauri/vite/webpack/next build) takes
// minutes on a big project and belongs to full, thorough, release and the focused functionality presets, which keep every one of them.
// A check is compile-heavy when its id is in COMPILE_HEAVY_IDS or its command matches COMPILE_HEAVY_COMMAND, so a NEW check that runs
// a compiler is caught by the command alone; add its id here when the command is not recognisable. tests/presets-quick-budget.test.ts fails otherwise.
export const COMPILE_HEAVY_IDS = ['rust-clippy', 'rust-test', 'rust-build-release', 'rust-doc', 'go-test', 'maven-compile', 'maven-test', 'dotnet-build', 'swift-build', 'pytest', 'rspec', 'perf-build']
export const COMPILE_HEAVY_COMMAND = /^(cargo\s+(clippy|test|build|check|doc|bench|rustc)|rustc|tauri\s+build|cargo\s+tauri|npx?\s+tauri\s+build|(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)|(npx\s+)?(vite|webpack|rollup|next|nuxt|astro)\s+build|dotnet\s+(build|test|publish)|mvn\s+(-\S+\s+)*(compile|test|package|verify|install)|gradlew?\s+(build|test|check|assemble)|go\s+(test|build)|swift\s+(build|test)|pytest|rspec)\b/
// A direct JavaScript unit-test runner (npx vitest run, npx jest) is NOT compile-heavy: it transforms files on the fly and runs no compiler or build, so it stays in quick.
// `npm test` / `yarn test` stay out, because that script may build first and the check cannot see what it runs.
// Type checks that stay in quick on purpose: they type-check without producing or linking anything and take about a minute at most.
export const QUICK_TYPECHECKS = { tsc: 'type check (tsc --noEmit), est 60 s, no emit or link', 'go-vet': 'go vet, est 60 s, reuses the build cache' }
const commandLine = (check) => {
  const run = check?.run
  if (!run || typeof run !== 'object') return ''
  const line = [run.cmd, ...(run.args ?? [])].join(' ').split(String.fromCharCode(92)).join('/')
  return line
}
export function isCompileHeavy(check) {
  if (!check || QUICK_TYPECHECKS[check.id]) return false
  if (COMPILE_HEAVY_IDS.includes(check.id)) return true
  const line = commandLine(check)
  const base = String(check.run?.cmd ?? '').split('/').pop()
  return COMPILE_HEAVY_COMMAND.test(line) || COMPILE_HEAVY_COMMAND.test([base, ...(check.run?.args ?? [])].join(' '))
}
export const PRESETS = {
  quick: { tier: 'fast', skipCompile: true, groups: DEFAULT_GROUPS, allPacks: true, excludeChecks: QUICK_EXCLUDED_CHECKS, about: 'the everyday check, 5 to 10 minutes at most: every short static check, no builds or test runs, before every push', purpose: 'This is the run for before every push. It does every quick check: secrets, risky code, type check, lints, formats and the fast page checks, in about 5 to 10 minutes at most. It skips everything that compiles the project or runs its tests (those are in full), the slow checks and the AI review, so it will not catch a build break, a failing test or a problem that only shows up under load.' },
  fast: { tier: 'fast', skipCompile: true, groups: DEFAULT_GROUPS, allPacks: true, excludeChecks: QUICK_EXCLUDED_CHECKS, about: 'same as quick: the everyday check, in seconds', purpose: 'Same as quick, under a second name. Use whichever you remember. It runs every quick check and none of the slow ones or the builds and test runs, so it suits a run before each push but not a release.' },
  bugs: { tier: 'fast', skipCompile: true, groups: DEFAULT_GROUPS, allPacks: true, excludeChecks: Object.keys(BUGS_EXCLUDED_CHECKS), excludeSubs: Object.keys(BUGS_EXCLUDED_SUBS), about: BUGS_PRESET_ABOUT, purpose: BUGS_PRESET_PURPOSE },
  full: { tier: 'thorough', groups: DEFAULT_GROUPS, allPacks: true, windows: false, about: 'the deep check, takes minutes: every check including builds, your own tests and slow scans; the window tests found in your project run in release', purpose: 'This is the whole set, slow checks included. Run it before a release or a merge you cannot easily undo, and expect it to take far longer than quick. It does not include the AI review, which you switch on with release.' },
  thorough: { tier: 'thorough', groups: DEFAULT_GROUPS, allPacks: true, windows: false, about: 'same as full: the deep check, takes minutes (no window tests: release runs them)', purpose: 'Same as full, under a second name. It runs every check, the slow ones too, and takes as long as full does. The AI review stays off; release adds it.' },
  ci: { tier: 'fast', groups: ['security', 'functionality'], about: 'security and does-it-work checks with no windows: for a build server or CI', purpose: 'Made for a build server, where nobody is watching and no window can open. It runs the quick security and functionality checks only. It does not run the UI, performance or refactor checks, so it will not catch a page that looks wrong.' },
  release: { tier: 'thorough', groups: DEFAULT_GROUPS, allPacks: true, include: ['ai'], about: 'the deepest check: everything in full plus the AI review, just before shipping', purpose: 'Run this just before you ship. It does every check, the slow ones too, and adds the AI review if an AI is set up. It takes the longest of all and may use an AI service. It is not meant for everyday pushes.' },
  'project-smoke': { tier: 'fast', groups: ['functionality'], about: 'does my change break anything: build, type check, lints and quick tests, for any project', purpose: 'The run to use after you change code, to see whether the project still builds and its quick tests still pass. Add --changed to check only the parts you touched, or --scope <folder> to check one folder of a larger project. It does not look at security, looks or speed, and it runs no slow tests.' },
  'functionality-fast': { tier: 'fast', groups: ['functionality'], about: 'build, type check, lints and tests, quick', purpose: 'Asks one question: does the project still work? It builds the project, runs the type check, the lints and the quick tests. It leaves out the slow tests and every security, UI and performance check.' },
  functionality: { tier: 'thorough', groups: ['functionality'], about: 'every functionality check, the slow ones too', purpose: 'The deeper version of functionality-fast. It runs every functionality check, including the slow tests. Use it when a quick pass is not enough, for example after a big change. It does not look at security, looks or speed.' },
  detectors: { tier: 'thorough', groups: DEFAULT_GROUPS, allPacks: true, packs: ['detectors'], include: ['detectors'], about: 'full plus opt-in mature detectors: osv-scanner, Semgrep, clippy, tsc --strict', purpose: 'Runs everything full does, then adds four tools if they are installed: osv-scanner (dependency advisories), Semgrep (security-audit rules, needs the network), cargo clippy (correctness and suspicious lints) and tsc --strict. A missing tool shows NOT RUN with an install hint; nothing is installed for you.' },
  'security-ai': { tier: 'thorough', groups: ['security'], include: ['ai'], about: 'every security check plus the AI route audit and diff review', purpose: 'Every security check, plus two AI reviews: one reads every route and handler, the other reads your recent changes. It is slow and uses an AI service. Run it before a release or when you changed login or data handling. It is not a replacement for a human review.' },
  'security-fast': { tier: 'fast', groups: ['security'], about: 'the quick security checks: secrets, risky code, advisories, workflows', purpose: 'A quick look for the common security mistakes: keys and passwords left in files, risky code, known bad dependencies and unsafe workflow files. Run it before every push. It skips the slow history scans and the AI review, so old leaked secrets can still hide.' },
  security: { tier: 'thorough', groups: ['security'], about: 'every security check, the slow ones too', purpose: 'Every security check, the slow ones too, including a scan of the whole git history for secrets that were once committed. Use it before a release or after changing who can reach your code. It does not run the AI review; security-ai adds that.' },
  'ui-fast': { tier: 'fast', groups: ['ui'], about: 'the quick UI checks: pages, styles, accessibility basics', purpose: 'The quick checks on how the app looks and behaves: pages, styles and the basic accessibility rules. Use it after you touched screens or styling. It does not open the app in a window, so it can miss a layout that only breaks on screen.' },
  ui: { tier: 'thorough', groups: ['ui'], about: 'every UI check, the slow ones too', purpose: 'Every UI check, the slow ones too. That includes the window checks that open the app and look at it. Use it before a release or after a big change to the screens. It does not test the logic behind the screens.' },
  'app-fast': { tier: 'fast', groups: ['ui', 'functionality'], about: 'UI and functionality, quick', purpose: 'The quick checks for the app itself: how it looks and whether it works. It joins ui-fast and functionality-fast in one run. Good for a push when you changed both screens and code. It skips security and the slow checks.' },
  app: { tier: 'thorough', groups: ['ui', 'functionality'], about: 'UI and functionality, thorough', purpose: 'The full set for the app itself: every UI check and every functionality check, slow ones included. Use it before a release when security is checked on its own. It does not cover security, performance or the AI review.' },
  'performance-fast': { tier: 'fast', groups: ['performance'], about: 'size, dependency weight, start-up time and memory', purpose: 'Quick measures of weight and speed: how big the output is, how heavy the dependencies are, how fast the app starts and how much memory it takes. Use it when the app feels slower or bigger. It does not test response time under load.' },
  performance: { tier: 'thorough', groups: ['performance'], about: 'every performance check: also response time, load and build time', purpose: 'All the performance checks, the slow ones too: response time, behaviour under load and build time, as well as size and start-up. Use it before a release or when something got slow. Results depend on how busy this PC is.' },
  refactor: { tier: 'thorough', groups: ['refactor'], about: 'is the code in good shape: duplicated code, dead code, files too long', purpose: 'Asks whether the code is in good shape. It looks for duplicated code, dead code nobody uses and files that have grown too long. Run it when you plan to tidy up. It never says the code is wrong, only that it may be hard to keep working on.' },
}

// A custom preset may carry `about` (one line, up to 200 characters) and `purpose` (a longer text, up to 600). Anything else is dropped:
// not text gives '', tabs and line breaks become spaces, other control characters go, the ends are trimmed, too long is cut.
export const ABOUT_MAX = 200
export const PURPOSE_MAX = 600
const cleanLine = (text, max) => (typeof text === 'string' ? text.replace(/[\t\r\n]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/ {2,}/g, ' ').trim().slice(0, max).trim() : '')
export const cleanAbout = (text) => cleanLine(text, ABOUT_MAX)
export const cleanPurpose = (text) => cleanLine(text, PURPOSE_MAX)

const TIERS = ['fast', 'thorough']
const GROUPS = ['security', 'functionality', 'ui', 'performance', 'refactor']

// The preset to use: a project's own first, then the built-in ones. Returns { preset } or { error }.
export function resolvePreset(name, custom = {}) {
  if (!name) return { preset: null }
  const found = custom[name] ?? PRESETS[name]
  if (!found) return { error: `no preset called "${name}". Presets: ${[...Object.keys(PRESETS), ...Object.keys(custom)].join(', ')}` }
  const tier = TIERS.includes(found.tier) ? found.tier : 'fast'
  const groups = Array.isArray(found.groups) ? found.groups.filter((g) => GROUPS.includes(g)) : []
  const include = Array.isArray(found.include) ? found.include.filter((x) => typeof x === 'string') : []
  const packs = Array.isArray(found.packs) ? found.packs.filter((p) => typeof p === 'string' && /^[a-z0-9-]+$/.test(p)) : []
  const allPacks = found.allPacks === true
  const names = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9/-]*$/.test(x)) : [])
  const excludeChecks = names(found.excludeChecks)
  const excludeSubs = names(found.excludeSubs)
  const skipCompile = found.skipCompile === true // compile-heavy checks (builds, test runs) are left out: quick and fast
  const windows = found.windows !== false // false: the project's own window tests (found-* on the windows lane) are not selected
  return { preset: { name, tier, groups, include, packs, allPacks, excludeChecks, excludeSubs, skipCompile, windows, about: cleanAbout(found.about), purpose: cleanPurpose(found.purpose) } }
}

// The custom presets a run sees: the project's own win over the person's (~/.meerkat.json). The built-in ones are the fallback in resolvePreset.
export const mergePresets = (project = {}, personal = {}) => ({ ...(personal ?? {}), ...(project ?? {}) })

export const parseGroups = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter((g) => GROUPS.includes(g))

// Leaves out what a preset excludes (the bugs preset). Works on the result of applyConfig: only checks that are loaded are touched, so a
// pack that is not on here causes no note. Excluded checks are listed as disabled, rules as turned-off sub-checks.
export function applyPresetExclusions(applied, preset) {
  const checks = preset?.excludeChecks ?? []
  const subs = preset?.excludeSubs ?? []
  if (!checks.length && !subs.length) return applied
  const by = `preset ${preset.name}`
  const loaded = new Set((applied.all ?? applied.checks).map((c) => c.id))
  const dropped = applied.checks.filter((c) => checks.includes(c.id))
  applied.checks = applied.checks.filter((c) => !checks.includes(c.id))
  for (const c of dropped) applied.disabled.push({ id: c.id, title: c.title, by, preset: preset.name })
  for (const ref of subs) if (loaded.has(ref.split('/')[0]) && !applied.disabledSubs.includes(ref)) applied.disabledSubs.push(ref)
  return applied
}
