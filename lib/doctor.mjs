// `meerkat doctor [folder]`: for this project, which quick checks would run, which would be NOT RUN because a tool is missing
// (with the install line), which packs are available but off, and the exact next command for each.
import { homedir } from 'node:os'
import { detect } from './init.mjs'
import { availablePacks, toolFound } from './packs.mjs'
import { loadProject } from './projectchecks.mjs'
import { recommend } from './recommend.mjs'
import { selectChecks } from './runner.mjs'
import { stripControl } from './tui/safe.mjs'
import { combinedCommand, CATALOG } from './tools.mjs'
import { findBinary, missingReason, toolsHome } from './which.mjs'

const s = (x) => stripControl(String(x ?? ''))

export async function doctorReport(folder, { env = process.env, find = findBinary, home = homedir(), project: given } = {}) {
  const project = given ?? (await loadProject(folder, { env }))
  const dirs = [project.appDir, project.repoRoot]
  const sel = selectChecks(project.checks, { tier: 'fast', only: [], include: [], mode: 'all', changedFiles: null, groups: [] })
  const notRun = []
  for (const c of sel.run) {
    const missing = (c.needs ?? []).filter((bin) => !toolFound(bin, { env, dirs, find }))
    if (missing.length) notRun.push({ id: s(c.id), tool: s(missing[0]), tools: missing.map(s), install: c.install ? s(c.install) : null, fix: c.install ? s(c.install) : `install ${s(missing[0])} and put it on your PATH`, reason: s(missingReason(missing, c.install)) })
  }
  // Checks that use a built-in fallback because their tool is missing: they run, and say "built-in fallback".
  const fallbacks = sel.run
    .filter((c) => c.fallback && !toolFound(c.optionalNeeds?.[0], { env, dirs, find }))
    .map((c) => ({ id: s(c.id), tool: s(c.optionalNeeds?.[0]) }))
  // One line for all of it: every missing tool, and one command per ecosystem.
  const gone = [...new Set([...notRun.flatMap((n) => n.tools), ...fallbacks.map((x) => x.tool)])]
  const byEco = {}
  for (const t of gone) {
    const e = CATALOG.find((c) => c.bin === t)
    ;(byEco[e?.ecosystem ?? 'other'] ??= []).push(e?.pkg ?? t)
  }
  const commands = Object.entries(byEco)
    .filter(([k]) => k !== 'other')
    .map(([k, v]) => combinedCommand(k, v, { dir: toolsHome(env, home) }))
  const missingLine = gone.length ? `Missing tools: ${gone.join(', ')}. ${commands.length ? commands.join(' | ') : 'meerkat tools'}` : null
  const on = new Set(project.config.packs ?? [])
  const seen = detect(project.appDir).suggest
  const suggested = seen.filter((x) => !on.has(x.pack)).map((x) => ({ name: x.pack, why: s(x.why), fix: `meerkat pack enable ${x.pack}` }))
  const hint = new Set(suggested.map((x) => x.name))
  const packsOff = availablePacks(env, home).filter((p) => !on.has(p.name) && !hint.has(p.name) && p.source === 'bundled').map((p) => ({ name: p.name, fix: `meerkat pack enable ${p.name}` }))
  const next = [...notRun.map((n) => n.fix), ...suggested.map((x) => x.fix)]
  // Tests this folder could run that no check covers (lib/recommend.mjs); only when the project has no checks of its own yet.
  const ideas = project.checks.some((c) => c.origin === 'personal' || c.origin === 'project') ? 0 : recommend(project.appDir, { checks: project.checks }).ideas.length
  return { ideas, folder: project.appDir, configFile: project.configFile, quickChecks: sel.run.length, wouldRun: sel.run.length - notRun.length, notRun, fallbacks, missingLine, packsOff, suggested, next, notes: project.notes.map(s) }
}

export function doctorText(r) {
  const lines = [`Meerkat doctor: ${r.folder}`, r.configFile ? `config: ${r.configFile}` : 'config: none (the packs that fit this folder are used)', '']
  lines.push(`The quick checks: ${r.quickChecks}. They would run: ${r.wouldRun}. NOT RUN: ${r.notRun.length}.`)
  if (r.notRun.length) {
    lines.push('', 'Would be NOT RUN (a tool is missing):')
    for (const n of r.notRun) lines.push(`  ${n.id}: needs ${n.tools.join(', ')}`, `    fix: ${n.fix}`)
  }
  if (r.fallbacks?.length) lines.push('', `Using a built-in fallback (the real tool is not installed): ${r.fallbacks.map((x) => `${x.id} (${x.tool})`).join(', ')}`)
  if (r.missingLine) lines.push('', r.missingLine, '  see all: meerkat tools')
  if (r.suggested.length) {
    lines.push('', 'Found in this folder, pack is off:')
    for (const x of r.suggested) lines.push(`  ${x.name}: ${x.why}`, `    turn on: ${x.fix}`)
  }
  if (r.packsOff.length) lines.push('', `Other packs you can turn on: ${r.packsOff.map((p) => p.name).join(', ')}`, '  turn on: meerkat pack enable <name>')
  if (r.ideas > 0) lines.push('', `Tests this project could run: ${r.ideas}. See them: meerkat recommend`)
  for (const n of r.notes) lines.push('', `note: ${n}`)
  lines.push('', r.notRun.length ? 'Fix the lines above, then run: meerkat verify' : 'Nothing is missing. Run: meerkat verify')
  return lines.join('\n')
}
