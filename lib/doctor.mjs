// `meerkat doctor [folder]`: for this project, which quick checks would run, which would be NOT RUN because a tool is missing
// (with the install line), which packs are available but off, and the exact next command for each.
import { homedir } from 'node:os'
import { detect } from './init.mjs'
import { availablePacks, toolFound } from './packs.mjs'
import { loadProject } from './projectchecks.mjs'
import { selectChecks } from './runner.mjs'
import { stripControl } from './tui/safe.mjs'
import { findBinary } from './which.mjs'

const s = (x) => stripControl(String(x ?? ''))

export async function doctorReport(folder, { env = process.env, find = findBinary, home = homedir(), project: given } = {}) {
  const project = given ?? (await loadProject(folder, { env }))
  const dirs = [project.appDir, project.repoRoot]
  const sel = selectChecks(project.checks, { tier: 'fast', only: [], include: [], mode: 'all', changedFiles: null, groups: [] })
  const notRun = []
  for (const c of sel.run) {
    const missing = (c.needs ?? []).filter((bin) => !toolFound(bin, { env, dirs, find }))
    if (missing.length) notRun.push({ id: s(c.id), tool: s(missing[0]), tools: missing.map(s), install: c.install ? s(c.install) : null, fix: c.install ? s(c.install) : `install ${s(missing[0])} and put it on your PATH` })
  }
  const on = new Set(project.config.packs ?? [])
  const seen = detect(project.appDir).suggest
  const suggested = seen.filter((x) => !on.has(x.pack)).map((x) => ({ name: x.pack, why: s(x.why), fix: `meerkat pack enable ${x.pack}` }))
  const hint = new Set(suggested.map((x) => x.name))
  const packsOff = availablePacks(env, home).filter((p) => !on.has(p.name) && !hint.has(p.name) && p.source === 'bundled').map((p) => ({ name: p.name, fix: `meerkat pack enable ${p.name}` }))
  const next = [...notRun.map((n) => n.fix), ...suggested.map((x) => x.fix)]
  return { folder: project.appDir, configFile: project.configFile, quickChecks: sel.run.length, wouldRun: sel.run.length - notRun.length, notRun, packsOff, suggested, next, notes: project.notes.map(s) }
}

export function doctorText(r) {
  const lines = [`Meerkat doctor: ${r.folder}`, r.configFile ? `config: ${r.configFile}` : 'config: none (the packs that fit this folder are used)', '']
  lines.push(`The quick checks: ${r.quickChecks}. They would run: ${r.wouldRun}. NOT RUN: ${r.notRun.length}.`)
  if (r.notRun.length) {
    lines.push('', 'Would be NOT RUN (a tool is missing):')
    for (const n of r.notRun) lines.push(`  ${n.id}: needs ${n.tools.join(', ')}`, `    fix: ${n.fix}`)
  }
  if (r.suggested.length) {
    lines.push('', 'Found in this folder, pack is off:')
    for (const x of r.suggested) lines.push(`  ${x.name}: ${x.why}`, `    turn on: ${x.fix}`)
  }
  if (r.packsOff.length) lines.push('', `Other packs you can turn on: ${r.packsOff.map((p) => p.name).join(', ')}`, '  turn on: meerkat pack enable <name>')
  for (const n of r.notes) lines.push('', `note: ${n}`)
  lines.push('', r.notRun.length ? 'Fix the lines above, then run: meerkat verify' : 'Nothing is missing. Run: meerkat verify')
  return lines.join('\n')
}
