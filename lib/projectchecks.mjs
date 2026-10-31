// Loads the checks a folder would use (its config, its packs) the way run.mjs does, without running anything.
// Feeds `check list`, `check show`, `preset show`, `pack list` and `doctor`.
import { cpus } from 'node:os'
import { resolve } from 'node:path'
import { applyConfig, findConfig, readConfig } from './config.mjs'
import { estimateRemaining } from './eta.mjs'
import { detect, presetPacks } from './init.mjs'
import { repoRootOf } from './paths.mjs'
import { mergePresets, resolvePreset } from './presets.mjs'
import { selectChecks } from './runner.mjs'
import { effectiveTimeoutSeconds } from './timeouts.mjs'
import { applyLearned, loadTimings, timingsPath } from './timings.mjs'
import { createModel } from './tui/model.mjs'
import { stripControl } from './tui/safe.mjs'
import { detailsText } from './presetdetails.mjs'
import { readUserConfig } from './userconfig.mjs'
import { originLabel } from './customchecks.mjs'
import { projectSuites, SUITES, suiteIdOf } from './suites.mjs'

const s = (x) => stripControl(String(x ?? ''))

export function durationText(ms) {
  if (ms >= 90_000) return `${Math.round(ms / 6000) / 10} minutes`
  const sec = Math.round(ms / 1000)
  return sec === 1 ? '1 second' : `${sec} seconds`
}

// Everything known about a folder's checks. extraPacks are added to the config's own list (a preset can bring packs).
export async function loadProject(folder, { env = process.env, extraPacks = [], configFile: given } = {}) {
  const appDir = resolve(folder)
  const repoRoot = repoRootOf(appDir)
  const configFile = given === undefined ? findConfig({ appDir, repoRoot }) : given
  const read = configFile ? readConfig(configFile) : { config: { packs: detect(appDir).config.packs, extraChecks: [], disable: [], override: {}, budget: null, presets: {} }, notes: [] }
  const user = readUserConfig(env)
  const packDirs = Array.isArray(user.packDirs) ? user.packDirs.filter((d) => typeof d === 'string' && d.trim() !== '') : []
  // Tab completion sets MEERKAT_NO_PROJECT_CODE: a project's own extraChecks folders are code from the repo, never loaded just to complete a word.
  const config = { ...read.config, packs: [...new Set([...(read.config.packs ?? []), ...extraPacks])], ...(env.MEERKAT_NO_PROJECT_CODE ? { extraChecks: [] } : {}) }
  const noCode = Boolean(env.MEERKAT_NO_PROJECT_CODE)
  const applied = await applyConfig([], config, { file: configFile, extraPackDirs: packDirs, personalChecks: user.customChecks, projectDir: appDir, noProjectCode: noCode })
  return { appDir, repoRoot, configFile, config, user, packDirs, projectSuites: applied.projectSuites, noProjectCode: noCode, checks: applied.checks, allChecks: applied.all ?? applied.checks, disabled: applied.disabled, notes: [...read.notes, ...applied.notes], presets: mergePresets(read.config.presets ?? {}, user.presets ?? {}), detected: !configFile, ownPresets: { project: asObject(read.config.presets), personal: asObject(user.presets) } }
}

const asObject = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {})
const packOf = (source) => (/^pack (.+)$/.exec(String(source ?? ''))?.[1] ?? null)

export function checkRow(c) {
  return { id: s(c.id), kind: c.group, tier: c.tier, lane: c.lane, weight: c.weight ?? null, seconds: c.estSeconds ?? null, title: s(c.title), optIn: c.optIn ?? null, pack: packOf(c.source), suite: suiteIdOf(c), subChecks: c.subs ?? 1, origin: c.origin ?? 'bundled' }
}

export function describeRun(run) {
  if (typeof run === 'function') return { kind: 'function', text: 'a function inside Meerkat (no outside command)' }
  if (run && typeof run.cmd === 'string') return { kind: 'command', cmd: s(run.cmd), args: (run.args ?? []).map(s), cwd: run.cwd ? s(run.cwd) : 'app', text: [run.cmd, ...(run.args ?? [])].map(s).join(' ') }
  return { kind: 'unknown', text: 'unknown' }
}

export function checkShow(c) {
  return { ...checkRow(c), timeoutSeconds: effectiveTimeoutSeconds(c), source: s(c.source), where: c.where ? { kind: c.where.kind, file: c.where.file ? s(c.where.file) : null } : null, needs: (c.needs ?? []).map(s), install: c.install ? s(c.install) : null, paths: c.paths ?? null, after: c.after ?? [], supersededBy: c.supersededBy ?? null, timeoutSeconds: c.timeoutSeconds ?? null, hasSelfTest: Boolean(c.selfTest), runs: describeRun(c.run) }
}

// By default the checks are nested under their suite; `flat` is one line per check.
export function checkListText(rows, { flat = false } = {}) {
  if (!rows.length) return 'No checks apply here. Add a pack: meerkat pack list'
  const w = Math.max(...rows.map((r) => r.id.length))
  const tagged = rows.some((r) => originLabel(r.origin))
  const line = (r) => `${r.id.padEnd(w)}  ${tagged ? `${originLabel(r.origin).padEnd(7)} ` : ''}${String(r.kind).padEnd(13)} ${String(r.tier).padEnd(9)} ${String(r.weight ?? '-').padEnd(7)} ~${String(r.seconds ?? '?').padStart(4)}s${r.optIn ? `  opt-in:${r.optIn}` : ''}  ${r.title}`
  if (flat) return rows.map(line).join('\n')
  const out = []
  for (const sx of [...projectSuites(), ...SUITES]) {
    const mine = rows.filter((r) => (r.suite ?? 'other') === sx.id)
    if (!mine.length) continue
    out.push(`${sx.label} (${sx.id}): ${mine.length} checks, ${mine.reduce((n, r) => n + (r.subChecks ?? 1), 0)} sub-checks`, ...mine.map((r) => `  ${line(r)}`))
  }
  return out.join('\n')
}

export function checkShowText(d) {
  const lines = [`${d.id}: ${d.title}`, '', ...(originLabel(d.origin) ? [`  origin      ${d.origin === 'personal' ? 'yours (in every project)' : 'this project'}${d.where?.file ? `, defined in ${d.where.file}` : ''}`] : []), `  kind        ${d.kind}`, `  tier        ${d.tier}`, `  lane        ${d.lane}`, `  weight      ${d.weight ?? 'default for the lane'}`, `  time        about ${d.seconds ?? '?'} s`, `  pack        ${d.pack ?? d.source}`]
  if (d.timeoutSeconds) lines.push(`  time limit  ${d.timeoutSeconds} s (about ${d.seconds ?? '?'} s expected; --timeout-scale <n> or "timeouts" in .meerkat-budgets.json changes it)`)
  if (d.optIn) lines.push(`  opt-in      only with --include ${d.optIn}`)
  lines.push(`  needs       ${d.needs.length ? d.needs.join(', ') : 'nothing installed'}`)
  if (d.install) lines.push(`  install     ${d.install}`)
  lines.push(`  runs        ${d.runs.text}${d.runs.cwd ? `   (in: ${d.runs.cwd})` : ''}`)
  if (d.paths) lines.push(`  only when   these change: ${d.paths.join(', ')}`)
  if (d.after.length) lines.push(`  after       ${d.after.join(', ')}`)
  if (d.supersededBy) lines.push(`  covered by  ${d.supersededBy} when both run`)
  lines.push(`  self-test   ${d.hasSelfTest ? 'yes' : 'no'}`, '', `Run only this: meerkat check ${d.id}`)
  return lines.join('\n')
}

// What a preset would run here: its checks and about how long that takes on this PC.
export async function presetShow(name, folder, { env = process.env } = {}) {
  let project = await loadProject(folder, { env })
  const first = resolvePreset(name, project.presets)
  if (first.error) return { ok: false, text: first.error }
  const p = first.preset
  const brought = presetPacks(p, project.appDir)
  if (brought.some((x) => !project.config.packs.includes(x))) project = await loadProject(folder, { env, extraPacks: brought })
  const checks = project.checks
  let timings = {}
  try {
    timings = loadTimings(timingsPath(env), project.appDir)
    applyLearned(checks, timings, p.tier)
  } catch {
    /* the written times are used */
  }
  const sel = selectChecks(checks, { tier: p.tier, only: [], include: p.include, mode: 'all', changedFiles: null, groups: p.groups })
  let ms = sel.run.reduce((n, c) => n + (c.estSeconds ?? 0), 0) * 1000
  try {
    const rows = createModel({ checks: sel.run, timings, tier: p.tier }).snapshot(0)
    ms = estimateRemaining(rows, 0, { freeSlots: Math.max(1, cpus().length - 1) })
  } catch {
    /* the sum of the written times is the fallback */
  }
  const source = name in project.ownPresets.project ? 'project' : name in project.ownPresets.personal ? 'personal' : 'bundled'
  const data = { name: p.name, source, tier: p.tier, kinds: p.groups.length ? p.groups : ['all'], include: p.include, packs: brought, about: s(p.about), purpose: s(p.purpose), folder: project.appDir, checks: sel.run.map(checkRow), estimateSeconds: Math.round(ms / 1000) }
  return { ok: true, data, text: detailsText(data, { width: 80 }) }
}
