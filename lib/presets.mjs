// Named runs: which tier and which kinds of check. `--preset security` runs every security check, `--preset ui-fast` only the quick UI
// ones. A project can add its own in meerkat.config.json ("presets": { "before-release": { "tier": "thorough", "groups": ["security"] } }).
//
//   tier    fast (before every push) or thorough (before a promotion or a release)
//   groups  which kinds of check: security, functionality, ui, performance (empty means all)
//
// A check's dependencies come with it (a UI check pulls in the build it needs), so a focused run never starts a window against nothing.
export const PRESETS = {
  quick: { tier: 'fast', groups: [], about: 'everything quick: before every push' },
  full: { tier: 'thorough', groups: [], about: 'everything: security, UI, functionality, fuzzing, mutation testing' },
  'security-fast': { tier: 'fast', groups: ['security'], about: 'the quick security checks (secret scan, advisories, source rules)' },
  security: { tier: 'thorough', groups: ['security'], about: 'every security check, including fuzzing and mutation testing' },
  'ui-fast': { tier: 'fast', groups: ['ui'], about: 'the quick real-window checks' },
  ui: { tier: 'thorough', groups: ['ui'], about: 'every UI check: every control, every look, accessibility' },
  'app-fast': { tier: 'fast', groups: ['ui', 'functionality'], about: 'UI and functionality, quick' },
  app: { tier: 'thorough', groups: ['ui', 'functionality'], about: 'UI and functionality, thorough' },
}

const TIERS = ['fast', 'thorough']
const GROUPS = ['security', 'functionality', 'ui', 'performance']

// The preset to use: a project's own first, then the built-in ones. Returns { preset } or { error }.
export function resolvePreset(name, custom = {}) {
  if (!name) return { preset: null }
  const found = custom[name] ?? PRESETS[name]
  if (!found) return { error: `no preset called "${name}". Presets: ${[...Object.keys(PRESETS), ...Object.keys(custom)].join(', ')}` }
  const tier = TIERS.includes(found.tier) ? found.tier : 'fast'
  const groups = Array.isArray(found.groups) ? found.groups.filter((g) => GROUPS.includes(g)) : []
  return { preset: { name, tier, groups, about: found.about ?? '' } }
}

export const parseGroups = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter((g) => GROUPS.includes(g))
