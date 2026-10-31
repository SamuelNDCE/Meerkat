// Named runs: which tier and which kinds of check. `--preset security` runs every security check, `--preset ui-fast` only the quick UI
// ones. A project can add its own in meerkat.config.json ("presets": { "before-release": { "tier": "thorough", "groups": ["security"] } }).
//
//   tier    fast (before every push) or thorough (before a promotion or a release)
//   groups  which kinds of check: security, functionality, ui, performance, refactor (empty means all)
//   include opt-in checks to add (for example "ai")
//   packs   packs to load for this run (for example ["rust"]), added after the config's own packs
//   allPacks  true brings every pack that applies to the folder (lib/init.mjs applicablePacks), on top of the config's own: full, thorough and release
//
// A check's dependencies come with it (a UI check pulls in the build it needs), so a focused run never starts a window against nothing.
export const PRESETS = {
  quick: { tier: 'fast', groups: [], allPacks: true, about: 'every quick check: before every push', purpose: 'This is the run for before every push. It does every quick check: secrets, risky code, build, type check, lints, tests and the fast page checks. It skips the slow checks and the AI review, so it will not catch a slow test failure or a problem that only shows up under load.' },
  fast: { tier: 'fast', groups: [], allPacks: true, about: 'every quick check (same as quick)', purpose: 'Same as quick, under a second name. Use whichever you remember. It runs every quick check and none of the slow ones, so it suits a run before each push but not a release.' },
  full: { tier: 'thorough', groups: [], allPacks: true, about: 'every check, the slow ones too: before a release', purpose: 'This is the whole set, slow checks included. Run it before a release or a merge you cannot easily undo, and expect it to take far longer than quick. It does not include the AI review, which you switch on with release.' },
  thorough: { tier: 'thorough', groups: [], allPacks: true, about: 'every check, the slow ones too (same as full)', purpose: 'Same as full, under a second name. It runs every check, the slow ones too, and takes as long as full does. The AI review stays off; release adds it.' },
  ci: { tier: 'fast', groups: ['security', 'functionality'], about: 'quick security and functionality checks, no windows: for a build server', purpose: 'Made for a build server, where nobody is watching and no window can open. It runs the quick security and functionality checks only. It does not run the UI, performance or refactor checks, so it will not catch a page that looks wrong.' },
  release: { tier: 'thorough', groups: [], allPacks: true, include: ['ai'], about: 'everything, including the AI review: before shipping', purpose: 'Run this just before you ship. It does every check, the slow ones too, and adds the AI review if an AI is set up. It takes the longest of all and may use an AI service. It is not meant for everyday pushes.' },
  'functionality-fast': { tier: 'fast', groups: ['functionality'], about: 'build, type check, lints and tests, quick', purpose: 'Asks one question: does the project still work? It builds the project, runs the type check, the lints and the quick tests. It leaves out the slow tests and every security, UI and performance check.' },
  functionality: { tier: 'thorough', groups: ['functionality'], about: 'every functionality check, the slow ones too', purpose: 'The deeper version of functionality-fast. It runs every functionality check, including the slow tests. Use it when a quick pass is not enough, for example after a big change. It does not look at security, looks or speed.' },
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
  return { preset: { name, tier, groups, include, packs, allPacks, about: cleanAbout(found.about), purpose: cleanPurpose(found.purpose) } }
}

// The custom presets a run sees: the project's own win over the person's (~/.meerkat.json). The built-in ones are the fallback in resolvePreset.
export const mergePresets = (project = {}, personal = {}) => ({ ...(personal ?? {}), ...(project ?? {}) })

export const parseGroups = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter((g) => GROUPS.includes(g))
