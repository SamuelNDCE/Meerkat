// `meerkat suite list` and `meerkat suite show <name>`: the suites, how many checks and sub-checks each holds, and how many of them apply to
// this folder. Two numbers are always kept apart so the count is honest: the CATALOGUE (everything Meerkat ships, plus the project's own
// extra checks) and what applies HERE (the checks of the packs that are on for this folder, minus what the config turned off).
// A check that declares no rules (`subs` on the check) counts as one sub-check.
import { loadChecks } from './load-checks.mjs'
import { availablePacks } from './packs.mjs'
import { declaredSubs, isSuite, packOfCheck, SUITES, suiteIdOf, suiteInfo } from './suites.mjs'
import { stripControl } from './tui/safe.mjs'

const s = (x) => stripControl(String(x ?? ''))

// Every check Meerkat ships (the bundled packs), each marked with its pack.
export async function catalogueChecks({ env = process.env, home, load = loadChecks } = {}) {
  const out = []
  for (const p of availablePacks(env, home).filter((x) => x.source === 'bundled')) for (const c of await load(p.dir)) out.push({ ...c, source: `pack ${p.name}` })
  return out
}

const sum = (list, f) => list.reduce((n, c) => n + f(c), 0)

export async function suiteList(project, { env = process.env, home, load } = {}) {
  const shipped = await catalogueChecks({ env, home, load })
  const known = new Set(shipped.map((c) => c.id))
  const catalogue = [...shipped, ...project.checks.filter((c) => !known.has(c.id))]
  const turnedOff = new Set((project.disabled ?? []).filter((d) => d.by?.startsWith('suite:')).map((d) => d.by.slice(6)))
  const rows = SUITES.map((x) => {
    const all = catalogue.filter((c) => suiteIdOf(c) === x.id)
    const here = project.checks.filter((c) => suiteIdOf(c) === x.id)
    return { id: x.id, label: x.label, category: x.category, purpose: x.purpose, checks: { here: here.length, catalogue: all.length }, subChecks: { here: sum(here, declaredSubs), catalogue: sum(all, declaredSubs) }, seconds: Math.round(sum(here, (c) => c.estSeconds ?? 0)), disabled: turnedOff.has(x.id) }
  }).filter((r) => r.checks.catalogue > 0 || r.checks.here > 0)
  const total = (f) => rows.reduce((n, r) => n + f(r), 0)
  return {
    folder: project.appDir,
    totals: { suites: { here: rows.filter((r) => r.checks.here > 0).length, catalogue: rows.length }, checks: { here: total((r) => r.checks.here), catalogue: total((r) => r.checks.catalogue) }, subChecks: { here: total((r) => r.subChecks.here), catalogue: total((r) => r.subChecks.catalogue) } },
    suites: rows,
  }
}

const time = (sec) => (sec < 60 ? `${sec} s` : `${(sec / 60).toFixed(sec < 600 ? 1 : 0)} min`)

export function suiteListText(d) {
  const w = Math.max(5, ...d.suites.map((r) => r.id.length))
  const t = d.totals
  const lines = [
    `Suites for ${d.folder}`,
    `${t.suites.here} of ${t.suites.catalogue} suites apply here: ${t.checks.here} of ${t.checks.catalogue} checks, ${t.subChecks.here} of ${t.subChecks.catalogue} sub-checks (a check that reports no rules counts as one).`,
    '',
    `${'suite'.padEnd(w)}  ${'checks here/all'.padEnd(14)}  ${'sub-checks'.padEnd(12)}  ${'time'.padEnd(7)}  what it covers`,
  ]
  for (const r of d.suites) lines.push(`${r.id.padEnd(w)}  ${`${r.checks.here}/${r.checks.catalogue}`.padEnd(14)}  ${`${r.subChecks.here}/${r.subChecks.catalogue}`.padEnd(12)}  ${(r.checks.here ? `~${time(r.seconds)}` : '-').padEnd(7)}  ${r.disabled ? '(turned off in the config) ' : ''}${s(r.purpose)}`)
  lines.push('', 'Run one: meerkat check <suite>      See one: meerkat suite show <suite>      One check: meerkat check <suite>/<check>')
  return lines.join('\n')
}

export async function suiteShow(name, project, { env = process.env, home, load } = {}) {
  const info = suiteInfo(name)
  if (!info || !isSuite(name)) return { id: s(name), error: `No suite called "${s(name)}"` }
  const shipped = await catalogueChecks({ env, home, load })
  const hereIds = new Set(project.checks.map((c) => c.id))
  const known = new Set(shipped.map((c) => c.id))
  const all = [...shipped, ...project.checks.filter((c) => !known.has(c.id))].filter((c) => suiteIdOf(c) === name)
  const checks = all.map((c) => ({ id: s(c.id), title: s(c.title), here: hereIds.has(c.id), pack: packOfCheck(c), subChecks: declaredSubs(c), tier: c.tier, seconds: c.estSeconds ?? null }))
  return { id: info.id, label: info.label, category: info.category, purpose: info.purpose, checks, subChecks: checks.reduce((n, c) => n + c.subChecks, 0), disabled: (project.disabled ?? []).some((d) => d.by === `suite:${name}`) }
}

export function suiteShowText(d) {
  if (d.error) return d.error
  const w = Math.max(...d.checks.map((c) => c.id.length), 5)
  const lines = [`${d.label} (${d.id}): ${d.purpose}`, `${d.checks.length} checks, ${d.subChecks} sub-checks${d.disabled ? '. Turned off in the config.' : ''}`, '', `${'check'.padEnd(w)}  ${'here?'.padEnd(18)}  ${'tier'.padEnd(9)}  ${'rules'.padEnd(5)}  what it does`]
  for (const c of d.checks) lines.push(`${c.id.padEnd(w)}  ${(c.here ? 'yes' : `no (pack ${c.pack ?? '?'} is off)`).padEnd(18)}  ${String(c.tier).padEnd(9)}  ${String(c.subChecks).padEnd(5)}  ${c.title}`)
  lines.push('', `Run the whole suite: meerkat check ${d.id}`, `Run one check:       meerkat check ${d.id}/<check>`, `Run one rule:        meerkat check ${d.id}/<check>/<rule>`)
  return lines.join('\n')
}
