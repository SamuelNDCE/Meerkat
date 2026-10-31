// The commands for checks that are yours: `meerkat check new|edit|remove|mine` and `meerkat recommend`. (`check try <id>` is a normal
// run of one check, planned in lib/cli.mjs.) A check lives in one of two files as data: the project's meerkat.config.json
// (customChecks, for this project) or ~/.meerkat.json (customChecks, for every project; MEERKAT_USER_CONFIG moves that file).
// The helpers (confirm, ask, ...) come from lib/commands.mjs so the questions behave like every other command's.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findConfig, CONFIG_NAME } from './config.mjs'
import { addEntry, commandText, defaultLabel, GROUPS, isOwn, originLabel, readJsonObject, removeEntry, replaceEntry, splitCommand, TIERS, validateEntry, DEFAULT_SUITE } from './customchecks.mjs'
import { detect } from './init.mjs'
import { repoRootOf } from './paths.mjs'
import { toolFound } from './packs.mjs'
import { loadProject } from './projectchecks.mjs'
import { recommend } from './recommend.mjs'
import { stripControl } from './tui/safe.mjs'
import { userConfigPath } from './userconfig.mjs'

const s = (x) => stripControl(String(x ?? ''))

// Where the check's data lives: 'personal' (~/.meerkat.json) or the project's file. The project file is created (with the packs that fit
// the folder, so that making a config never switches the default checks off) when there is none.
export function targetFile(kind, folder, env = process.env) {
  if (kind === 'personal') return { kind, file: userConfigPath(env), exists: existsSync(userConfigPath(env)), seed: null }
  const appDir = resolve(folder)
  const found = findConfig({ appDir, repoRoot: repoRootOf(appDir) })
  const file = found ?? join(appDir, CONFIG_NAME)
  return { kind: 'project', file, exists: Boolean(found), seed: found ? null : detect(appDir).config.packs }
}

// Adds an entry to the file (creating it with `packs` when it is new). Returns the text that was (or would be) written.
export function writeEntry(target, entry, { dryRun = false } = {}) {
  const seed = !target.exists && target.seed ? { packs: target.seed } : null
  return addEntry(target.file, entry, { create: true, dryRun, seed }).text
}

const entryOfIdea = (i, suite = DEFAULT_SUITE) => ({ id: i.id, title: i.title, cmd: i.cmd, args: i.args, suite, group: i.group, tier: i.tier, ...(i.estSeconds ? { estSeconds: i.estSeconds } : {}) })

// Your own checks, with where each lives and whether its program is installed.
export function mineRows(project, { env = process.env, find } = {}) {
  const dirs = [project.appDir, project.repoRoot]
  return project.checks.filter(isOwn).map((c) => {
    const run = c.run && typeof c.run === 'object' ? c.run : null
    const programs = run ? [run.cmd] : []
    const missing = [...new Set([...(c.needs ?? []), ...programs.filter((p) => !/[\\/]/.test(p))])].filter((b) => !toolFound(b, { env, dirs, ...(find ? { find } : {}) }))
    const where = c.where?.kind === 'config' ? `${project.configFile ?? CONFIG_NAME} (customChecks)` : c.where?.kind === 'personal-config' ? `${userConfigPath(env)} (customChecks)` : String(c.source ?? '')
    return { id: s(c.id), title: s(c.title), origin: c.origin, label: originLabel(c.origin), suite: s(c.suite ?? ''), group: c.group, tier: c.tier, where: s(where), editable: c.where?.kind === 'config' || c.where?.kind === 'personal-config', whereKind: c.where?.kind ?? 'code', file: c.where?.kind === 'config' ? s(project.configFile ?? '') : c.where?.kind === 'personal-config' ? s(userConfigPath(env)) : null, command: run ? commandText(run.cmd, run.args ?? []) : 'a function in the check file', installed: missing.length === 0, missing: missing.map(s) }
  })
}

export function mineText(rows, folder) {
  if (!rows.length) return `No checks of your own in ${folder} yet.\nAdd one: meerkat check new      See ideas: meerkat recommend`
  const w = Math.max(...rows.map((r) => r.id.length))
  const lines = [`Your own checks (${rows.length}) in ${folder}`, '']
  for (const r of rows) lines.push(`${r.id.padEnd(w)}  ${r.label.padEnd(7)} ${r.suite.padEnd(12)} ${r.tier.padEnd(9)} ${r.installed ? 'program found' : `NOT RUN until you install: ${r.missing.join(', ')}`}`, `${' '.repeat(w)}  ${r.command}`, `${' '.repeat(w)}  in ${r.where}`)
  lines.push('', 'Run one: meerkat check try <id>      Change: meerkat check edit <id>      Remove: meerkat check remove <id>')
  return lines.join('\n')
}

export function ideasText(r, folder) {
  if (!r.ideas.length) return `No ideas for ${folder}: ${r.covered ? `the ${r.covered} test command(s) found are already covered by a check.` : 'no test scripts, test-runner configs, Makefile targets or CI commands were found.'}\nWrite your own: meerkat check new`
  const w = Math.max(...r.ideas.map((i) => i.id.length))
  const lines = [`${r.ideas.length} test${r.ideas.length === 1 ? '' : 's'} ${folder} could run (nothing was run or written)`, '']
  for (const i of r.ideas) lines.push(`${i.id.padEnd(w)}  ${i.title}`, `${' '.repeat(w)}  runs: ${commandText(i.cmd, i.args)}`, `${' '.repeat(w)}  why:  ${i.why}`)
  lines.push('', 'Add one:  meerkat recommend --add <id>      Add all:  meerkat recommend --add all', 'Keep it for every project: add --personal.   See what would change first: add --dry-run')
  return lines.join('\n')
}

// Which of the entry's fields were given as flags.
const flagEntry = (f) => {
  const e = {}
  if (typeof f.id === 'string') e.id = f.id
  if (typeof f.title === 'string') e.title = f.title
  if (typeof f.suite === 'string') e.suite = f.suite
  if (typeof f.group === 'string') e.group = f.group
  if (typeof f.tier === 'string') e.tier = f.tier
  if (typeof f.cwd === 'string') e.cwd = f.cwd
  if (typeof f.timeout === 'string' && /^\d+$/.test(f.timeout)) e.timeoutSeconds = Number(f.timeout)
  return e
}

export async function yourAppCommand(key, plan, ctx, h) {
  const { out, err, env = process.env } = ctx
  const f = plan.flags ?? {}
  const wantJson = Boolean(f.json)
  const folder = plan.folder ?? ctx.cwd ?? process.cwd()
  const project = await loadProject(folder, { env })
  for (const n of project.notes ?? []) err(`config: ${s(n)}`)
  const known = () => new Set(project.checks.map((c) => c.id))
  const print = (data, text) => out(wantJson ? JSON.stringify(data, null, 2) : text)

  if (key === 'check mine') {
    const rows = mineRows(project, { env })
    print(rows, mineText(rows, project.appDir))
    return 0
  }

  if (key === 'recommend list') {
    const r = recommend(project.appDir, { checks: project.checks })
    if (f.add === undefined) {
      print({ folder: project.appDir, covered: r.covered, ideas: r.ideas.map((i) => ({ id: s(i.id), title: s(i.title), cmd: i.cmd, args: i.args, why: s(i.why), group: i.group, tier: i.tier })) }, ideasText(r, project.appDir))
      return 0
    }
    const wanted = f.add === 'all' ? r.ideas : r.ideas.filter((i) => i.id === f.add)
    if (!wanted.length) {
      err(f.add === 'all' ? 'There are no ideas to add. See: meerkat recommend' : `No idea called "${s(f.add)}". See: meerkat recommend`)
      return 2
    }
    const target = targetFile(f.personal ? 'personal' : 'project', project.appDir, env)
    const what = `${wanted.length} check(s) (${wanted.map((i) => i.id).join(', ')}) to ${target.file}`
    if (f.dryRun) {
      print({ dryRun: true, file: target.file, add: wanted.map((i) => entryOfIdea(i)) }, `Dry run. Would add ${what}:\n${JSON.stringify(wanted.map((i) => entryOfIdea(i)), null, 2)}`)
      return 0
    }
    const ok = await h.confirm(ctx, f, `Add ${what}?`)
    if (ok === null) return h.needYes(ctx, `This adds ${what}.`)
    if (!ok) {
      err('Left it as it was.')
      return 0
    }
    for (const i of wanted) {
      writeEntry(target, entryOfIdea(i))
      target.exists = true
      target.seed = null
    }
    print({ ok: true, file: target.file, added: wanted.map((i) => i.id) }, `Added ${what}.\nSee them: meerkat check mine      Run one: meerkat check try ${wanted[0].id}`)
    return 0
  }

  if (key === 'check new') {
    const e = flagEntry(f)
    let line = typeof f.cmd === 'string' ? f.cmd : null
    const ask = ctx.ask ?? h.defaultAsk
    const interactive = h.canAsk(ctx, f)
    if (interactive) {
      if (!e.id) e.id = (await ask('Id (lowercase, dashes), for example e2e: ')).trim()
      if (!e.title) e.title = (await ask(`Title [${defaultLabel(e.id || 'check')}]: `)).trim() || defaultLabel(e.id || 'check')
      if (!line) line = (await ask('Command to run, for example npm run test:e2e: ')).trim()
      if (!e.suite) e.suite = (await ask(`Suite (one of Meerkat's, or a name of your own) [${DEFAULT_SUITE}]: `)).trim() || DEFAULT_SUITE
      if (!e.group) e.group = (await ask(`Group ${GROUPS.join('/')} [functionality]: `)).trim() || 'functionality'
      if (!e.tier) e.tier = (await ask(`Tier ${TIERS.join('/')} [thorough]: `)).trim() || 'thorough'
    }
    if (!e.id || !line) {
      err('Say what to add: meerkat check new --id e2e --cmd "npm run test:e2e" [--title "End-to-end tests" --suite my-app --group functionality --tier thorough --personal|--project] --yes')
      return 2
    }
    const sp = splitCommand(line)
    if (!sp.ok) {
      err(`--cmd: ${sp.error}`)
      return 2
    }
    const v = validateEntry({ ...e, title: e.title ?? defaultLabel(e.id), cmd: sp.cmd, args: sp.args }, { known: known() })
    if (v.error) {
      err(`Could not add it: ${v.error}`)
      return 2
    }
    const target = targetFile(f.personal ? 'personal' : 'project', project.appDir, env)
    const text = `${v.entry.id} (${commandText(v.entry.cmd, v.entry.args)}) to ${target.file}`
    if (f.dryRun) {
      print({ dryRun: true, file: target.file, entry: v.entry }, `Dry run. Would add ${text}:\n${JSON.stringify(v.entry, null, 2)}`)
      return 0
    }
    const ok = interactive && !f.yes ? await h.confirm(ctx, f, `Add ${text}?`) : f.yes ? true : null
    if (ok === null) return h.needYes(ctx, `This adds ${text}.`)
    if (!ok) {
      err('Left it as it was.')
      return 0
    }
    writeEntry(target, v.entry)
    print({ ok: true, file: target.file, origin: f.personal ? 'personal' : 'project', entry: v.entry }, `Added ${text}.${!target.exists && target.seed ? ' (A new meerkat.config.json was made with the packs that fit this folder.)' : ''}\nRun just this one: meerkat check try ${v.entry.id}`)
    return 0
  }

  // edit and remove work on one check of yours that is written as data
  const id = plan.id
  const c = project.checks.find((x) => x.id === id)
  if (!c) {
    err(`No check called "${s(id)}" here. See: meerkat check mine`)
    return 2
  }
  if (!isOwn(c)) {
    err(`"${s(id)}" is a bundled Meerkat check, not one of yours. Only your own can be ${key === 'check edit' ? 'edited' : 'removed'}. To turn a bundled one off, add its id to "disable" in meerkat.config.json.`)
    return 2
  }
  if (c.where?.kind !== 'config' && c.where?.kind !== 'personal-config') {
    err(`"${s(id)}" is written in code (${s(c.source)}). ${key === 'check edit' ? 'Edit' : 'Delete'} that file by hand.`)
    return 2
  }
  const target = c.where.kind === 'personal-config' ? targetFile('personal', project.appDir, env) : { kind: 'project', file: project.configFile, exists: true, seed: null }
  let current
  try {
    current = (readJsonObject(target.file).raw.customChecks ?? []).find((x) => x?.id === id)
  } catch {
    err(`${s(target.file)} could not be read as JSON, so nothing was changed.`)
    return 2
  }
  if (!current) {
    err(`"${s(id)}" was not found in ${s(target.file)}.`)
    return 2
  }

  if (key === 'check remove') {
    const text = `${id} from ${target.file}`
    if (f.dryRun) {
      print({ dryRun: true, file: target.file, remove: id }, `Dry run. Would remove ${text}.`)
      return 0
    }
    const ok = await h.confirm(ctx, f, `Remove ${text}?`)
    if (ok === null) return h.needYes(ctx, `This removes ${text}.`)
    if (!ok) {
      err('Left it as it was.')
      return 0
    }
    removeEntry(target.file, id)
    print({ ok: true, file: target.file, removed: id }, `Removed ${text}.`)
    return 0
  }

  // check edit
  const next = { ...current, ...flagEntry(f) }
  delete next.id
  next.id = id
  if (typeof f.cmd === 'string') {
    const sp = splitCommand(f.cmd)
    if (!sp.ok) {
      err(`--cmd: ${sp.error}`)
      return 2
    }
    next.cmd = sp.cmd
    next.args = sp.args
  }
  if (!Object.keys({ ...flagEntry(f), ...(typeof f.cmd === 'string' ? { cmd: 1 } : {}) }).length) {
    if (!h.canAsk(ctx, f)) {
      err(`Say what to change: meerkat check edit ${s(id)} --title "..." --cmd "npm run test:e2e" --suite my-app --group functionality --tier fast`)
      return 2
    }
    const ask = ctx.ask ?? h.defaultAsk
    const keep = async (label, cur) => (await ask(`${label} [${cur}] (Enter keeps it): `)).trim()
    const t = await keep('Title', current.title ?? id)
    const cl = await keep('Command', commandText(current.cmd, current.args ?? []))
    const su = await keep('Suite', current.suite ?? DEFAULT_SUITE)
    const gr = await keep('Group', current.group ?? 'functionality')
    const ti = await keep('Tier', current.tier ?? 'thorough')
    if (t) next.title = t
    if (cl) {
      const sp = splitCommand(cl)
      if (!sp.ok) {
        err(`Command: ${sp.error}`)
        return 2
      }
      next.cmd = sp.cmd
      next.args = sp.args
    }
    if (su) next.suite = su
    if (gr) next.group = gr
    if (ti) next.tier = ti
  }
  const others = known()
  others.delete(id)
  const v = validateEntry(next, { known: others })
  if (v.error) {
    err(`Could not change it: ${v.error}`)
    return 2
  }
  if (f.dryRun) {
    print({ dryRun: true, file: target.file, entry: v.entry }, `Dry run. Would change ${id} in ${target.file} to:\n${JSON.stringify(v.entry, null, 2)}`)
    return 0
  }
  const ok = await h.confirm(ctx, f, `Change ${id} in ${target.file}?`)
  if (ok === null) return h.needYes(ctx, `This changes ${id} in ${target.file}.`)
  if (!ok) {
    err('Left it as it was.')
    return 0
  }
  replaceEntry(target.file, id, v.entry)
  print({ ok: true, file: target.file, entry: v.entry }, `Changed ${id} in ${target.file}.`)
  return 0
}

export { entryOfIdea }
