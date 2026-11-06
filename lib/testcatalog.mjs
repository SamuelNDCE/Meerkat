// `meerkat tests --json`: the machine-readable catalog of every kind of test and every family of check, generated from the registry
// (the bundled packs, lib/suites.mjs, lib/presets.mjs), never typed by hand, so it cannot drift. A new check shows up here by existing.
//
//   kind     the broad question a check answers (the check's `group`): security, functionality, ui, performance, refactor
//   family   a suite (lib/suites.mjs): the general checks a person picks, such as secrets or accessibility
//   check    one script or tool, with its own id
//
// Every entry says: what it proves, what triggers it, its cost, what it needs, and how to add or reorder it.
//   triggers  commit (quick, fast), pr (ci), gate (full, thorough, detectors), promote (release), manual (any other preset, or --only).
//             Worked out by selecting the checks of each built-in preset with the runner's own selectChecks, so a preset change moves them.
//   cost      fast (about 10 seconds or less), medium (up to a minute), slow (longer), from the check's estimate (30 seconds when it has none).
//   needs     tools (programs on the PATH), network (reaches out), app (opens a window or a running app).
import { catalogueChecks } from './suitelist.mjs'
import { GROUPS } from './load-checks.mjs'
import { PRESETS } from './presets.mjs'
import { selectChecks } from './runner.mjs'
import { DEFAULT_KIND_ORDER, ORDER_FILE } from './testorder.mjs'
import { projectSuites, SUITES, suiteIdOf } from './suites.mjs'

export const CATALOG_SCHEMA = 1

export const KIND_INFO = {
  security: 'No secret, risky call, injection shape, weak setting or known-bad dependency is in the project.',
  functionality: 'The project builds, type checks, lints, formats and passes its tests, and its files and docs are well formed.',
  ui: 'Pages and windows are valid, accessible and look right.',
  performance: 'Size, start-up, memory, response time and build time stay inside their budgets.',
  refactor: 'The code is in a shape that is easy to keep working on: no duplicated or dead code, no files or functions that are too long.',
}

// Which trigger each built-in preset stands for. A preset not listed here is manual.
export const PRESET_TRIGGER = { quick: 'commit', fast: 'commit', ci: 'pr', full: 'gate', thorough: 'gate', detectors: 'gate', release: 'promote' }
export const TRIGGERS = ['commit', 'pr', 'gate', 'promote', 'manual']

// Checks that reach out over the network (advisory databases). Checks behind the `ai` or `detectors` opt-in do too. A test keeps this list true.
export const NETWORK_IDS = ['npm-audit-all', 'rust-audit', 'rust-deny']
export const NETWORK_OPT_INS = ['ai', 'detectors']
export const APP_LANES = ['electron', 'windows']

export const FAST_SECONDS = 10
export const MEDIUM_SECONDS = 60
export const costOf = (c) => {
  const s = c.estSeconds ?? 30
  return s <= FAST_SECONDS ? 'fast' : s <= MEDIUM_SECONDS ? 'medium' : 'slow'
}
const COST_RANK = { fast: 0, medium: 1, slow: 2 }

const HOW_TO_ADD = {
  check: 'Add an object to a pack file (packs/<pack>/<pack>.mjs) with id, group (the kind), tier, lane, title, run and a selfTest; docs/writing-checks.md has the rest. For one project only: meerkat check new, or customChecks in meerkat.config.json.',
  reorder: `Edit ${ORDER_FILE} in the project folder: {"kinds": ["security", "functionality"]} starts the kinds in that order. See meerkat.order.json in the Meerkat repository.`,
}

function presetsOf(checks) {
  const byCheck = new Map()
  for (const [name, p] of Object.entries(PRESETS)) {
    const sel = selectChecks(checks, { tier: p.tier, only: [], include: p.include ?? [], mode: 'all', changedFiles: null, groups: p.groups ?? [], windows: p.windows !== false, skipCompile: p.skipCompile === true })
    for (const c of sel.run) byCheck.set(c.id, [...(byCheck.get(c.id) ?? []), name])
  }
  return byCheck
}

const unique = (xs) => [...new Set(xs)]
const triggersOf = (presets) => TRIGGERS.filter((t) => t === 'manual' || presets.some((p) => (PRESET_TRIGGER[p] ?? 'manual') === t))

function checkEntry(c, presetNames) {
  const presets = presetNames.get(c.id) ?? []
  return {
    id: c.id,
    kind: c.group,
    family: suiteIdOf(c),
    pack: /^pack (.+)$/.exec(String(c.source ?? ''))?.[1] ?? null,
    proves: c.title,
    triggers: triggersOf(presets),
    presets,
    optIn: c.optIn ?? null,
    cost: costOf(c),
    seconds: c.estSeconds ?? null,
    tier: c.tier,
    lane: c.lane,
    needs: { tools: unique(c.needs ?? []), network: NETWORK_IDS.includes(c.id) || NETWORK_OPT_INS.includes(c.optIn), app: APP_LANES.includes(c.lane) },
    run: `meerkat check ${c.id}`,
    reorder: `its kind is "${c.group}": move that kind in ${ORDER_FILE}`,
  }
}

// What a kind or a family adds up to over its checks.
function rollup(entries) {
  const worst = entries.reduce((w, e) => (COST_RANK[e.cost] > COST_RANK[w] ? e.cost : w), 'fast')
  const count = (cost) => entries.filter((e) => e.cost === cost).length
  return {
    checks: entries.map((e) => e.id),
    checkCount: entries.length,
    triggers: TRIGGERS.filter((t) => entries.some((e) => e.triggers.includes(t))),
    cost: entries.length ? worst : 'fast',
    costCounts: { fast: count('fast'), medium: count('medium'), slow: count('slow') },
    seconds: entries.reduce((n, e) => n + (e.seconds ?? 30), 0),
    needs: { tools: unique(entries.flatMap((e) => e.needs.tools)).sort(), network: entries.some((e) => e.needs.network), app: entries.some((e) => e.needs.app) },
  }
}

export async function buildCatalog({ env = process.env, home, load } = {}) {
  const checks = await catalogueChecks({ env, home, load })
  const presetNames = presetsOf(checks)
  const entries = checks.map((c) => checkEntry(c, presetNames))
  const kinds = GROUPS.map((id) => ({ id, proves: KIND_INFO[id], ...rollup(entries.filter((e) => e.kind === id)), defaultPosition: DEFAULT_KIND_ORDER.indexOf(id) + 1, add: HOW_TO_ADD.check, reorder: HOW_TO_ADD.reorder }))
  const families = [...projectSuites(), ...SUITES].map((s) => ({ id: s.id, label: s.label, proves: s.purpose, kinds: unique(entries.filter((e) => e.family === s.id).map((e) => e.kind)), ...rollup(entries.filter((e) => e.family === s.id)), add: HOW_TO_ADD.check, reorder: HOW_TO_ADD.reorder })).filter((f) => f.checkCount > 0)
  return {
    schema: CATALOG_SCHEMA,
    triggerMeaning: { commit: 'quick or fast: before every push', pr: 'ci: on a pull request, on a build server', gate: 'full, thorough or detectors: the merge gate', promote: 'release: before shipping', manual: 'any other preset, or --only / meerkat check' },
    costMeaning: { fast: `about ${FAST_SECONDS} seconds or less`, medium: `up to ${MEDIUM_SECONDS} seconds`, slow: `longer than ${MEDIUM_SECONDS} seconds` },
    order: { file: ORDER_FILE, kinds: DEFAULT_KIND_ORDER, how: HOW_TO_ADD.reorder },
    presets: Object.entries(PRESETS).map(([name, p]) => ({ name, trigger: PRESET_TRIGGER[name] ?? 'manual', tier: p.tier, kinds: p.groups?.length ? p.groups : ['all'], include: p.include ?? [], about: p.about })),
    totals: { kinds: kinds.length, families: families.length, checks: entries.length },
    kinds,
    families,
    checks: entries,
  }
}

export function catalogText(d) {
  const lines = [`Meerkat test catalog: ${d.totals.kinds} kinds, ${d.totals.families} families, ${d.totals.checks} checks`, '', `${'kind'.padEnd(14)} ${'checks'.padEnd(7)} ${'cost'.padEnd(7)} triggers`]
  for (const k of d.kinds) lines.push(`${k.id.padEnd(14)} ${String(k.checkCount).padEnd(7)} ${k.cost.padEnd(7)} ${k.triggers.join(', ')}`)
  lines.push('', `Order: edit ${d.order.file} to change which kind starts first. meerkat tests --json has every family and check.`)
  return lines.join('\n')
}
