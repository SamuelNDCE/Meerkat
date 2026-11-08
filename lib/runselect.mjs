// The one function that decides which checks a run starts, used by run.mjs and by `meerkat doctor`, so the two always count the same.
import { applicablePacks, presetPacks } from './init.mjs'
import { applyPresetExclusions, mergePresets, resolvePreset } from './presets.mjs'
import { loadProject } from './projectchecks.mjs'
import { selectChecks } from './runner.mjs'
import { changedFiles as gitChangedFiles } from './changed.mjs'

export function selectForRun(checks, { tier, only = [], include = [], mode = 'all', changedFiles = null, groups = [], suites = [], preset = null, env = process.env, kindOrder = null }) {
  return selectChecks(checks, { kindOrder, tier, only, include, mode, changedFiles, groups, suites, windows: preset?.windows !== false || env.MEERKAT_WINDOWS === '1', skipCompile: preset?.skipCompile === true })
}

// The checks a preset would start in a folder, loaded the way run.mjs loads them (the preset's packs, its exclusions, its kinds).
export async function presetSelection(folder, presetName = 'quick', { env = process.env, project: given = null } = {}) {
  let project = given ?? (await loadProject(folder, { env }))
  const chosen = resolvePreset(presetName, mergePresets(project.config?.presets ?? {}, project.user?.presets ?? {}))
  if (chosen.error) return { error: chosen.error }
  const p = chosen.preset
  if (!given) {
    const extra = [...presetPacks(p, project.appDir), ...(project.configFile ? [] : applicablePacks(project.appDir))]
    if (extra.some((x) => !(project.config.packs ?? []).includes(x))) project = await loadProject(folder, { env, extraPacks: extra })
  }
  const applied = applyPresetExclusions({ checks: project.checks, all: project.allChecks, disabled: [], disabledSubs: [] }, p)
  // The same mode a run uses: a fast tier looks at what changed against the base branch, and every check when nothing differs or git cannot say.
  let mode = p.tier === 'thorough' ? 'all' : 'changed'
  const changedFiles = mode === 'changed' ? gitChangedFiles(project.repoRoot, env) : null
  if (mode === 'changed' && (!Array.isArray(changedFiles) || changedFiles.length === 0)) mode = 'all'
  const sel = selectForRun(applied.checks, { tier: p.tier, include: p.include, groups: p.groups, preset: p, env, mode, changedFiles })
  return { project, preset: p, checks: applied.checks, sel }
}
