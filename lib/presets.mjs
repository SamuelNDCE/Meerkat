// Named runs: which tier and which kinds of check. `--preset security` runs every security check, `--preset ui-fast` only the quick UI
// ones. A project can add its own in meerkat.config.json ("presets": { "before-release": { "tier": "thorough", "groups": ["security"] } }).
//
//   tier    fast (before every push) or thorough (before a promotion or a release)
//   groups  which kinds of check: security, functionality, ui, performance, refactor (empty means all)
//   include opt-in checks to add (for example "ai")
//   packs   packs to load for this run (for example ["rust"]), added after the config's own packs
//
// A check's dependencies come with it (a UI check pulls in the build it needs), so a focused run never starts a window against nothing.
export const PRESETS = {
  quick: { tier: 'fast', groups: [], about: 'every quick check: before every push' },
  fast: { tier: 'fast', groups: [], about: 'every quick check (same as quick)' },
  full: { tier: 'thorough', groups: [], about: 'every check, the slow ones too: before a release' },
  thorough: { tier: 'thorough', groups: [], about: 'every check, the slow ones too (same as full)' },
  ci: { tier: 'fast', groups: ['security', 'functionality'], about: 'quick security and functionality checks, no windows: for a build server' },
  release: { tier: 'thorough', groups: [], include: ['ai'], about: 'everything, including the AI review: before shipping' },
  'functionality-fast': { tier: 'fast', groups: ['functionality'], about: 'build, type check, lints and tests, quick' },
  functionality: { tier: 'thorough', groups: ['functionality'], about: 'every functionality check, the slow ones too' },
  'security-ai': { tier: 'thorough', groups: ['security'], include: ['ai'], about: 'every security check plus the AI route audit and diff review' },
  'security-fast': { tier: 'fast', groups: ['security'], about: 'the quick security checks: secrets, risky code, advisories, workflows' },
  security: { tier: 'thorough', groups: ['security'], about: 'every security check, the slow ones too' },
  'ui-fast': { tier: 'fast', groups: ['ui'], about: 'the quick UI checks: pages, styles, accessibility basics' },
  ui: { tier: 'thorough', groups: ['ui'], about: 'every UI check, the slow ones too' },
  'app-fast': { tier: 'fast', groups: ['ui', 'functionality'], about: 'UI and functionality, quick' },
  app: { tier: 'thorough', groups: ['ui', 'functionality'], about: 'UI and functionality, thorough' },
  'performance-fast': { tier: 'fast', groups: ['performance'], about: 'size, dependency weight, start-up time and memory' },
  performance: { tier: 'thorough', groups: ['performance'], about: 'every performance check: also response time, load and build time' },
  refactor: { tier: 'thorough', groups: ['refactor'], about: 'is the code in good shape: duplicated code, dead code, files too long' },
}

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
  return { preset: { name, tier, groups, include, packs, about: found.about ?? '' } }
}

// The custom presets a run sees: the project's own win over the person's (~/.meerkat.json). The built-in ones are the fallback in resolvePreset.
export const mergePresets = (project = {}, personal = {}) => ({ ...(personal ?? {}), ...(project ?? {}) })

export const parseGroups = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter((g) => GROUPS.includes(g))
