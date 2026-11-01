// Does the commands that planCommand (lib/cli.mjs) plans and that need no run: help, describe, completion, and the
// managing commands (check, preset, pack, run, doctor, mcp). Everything it needs from outside is passed in, so tests drive it
// with fakes. Results go to ctx.out (stdout), notes and errors to ctx.err (stderr). Returns the exit code.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { listPresets, loadPresets, presetsText } from './cli.mjs'
import { completionScript } from './completion.mjs'
import { doctorReport, doctorText } from './doctor.mjs'
import { installNpmTools, installPlanText, toolsReport, toolsText } from './tools.mjs'
import { allWords, commandHelp, describe, nameOf, overviewHelp } from './help.mjs'
import { saveProjectPreset, savePersonalPreset } from './menu.mjs'
import { discoverReport, discoverText } from './discover.mjs'
import { discoverRepos, reposText } from './repos.mjs'
import { listPacks, packListText, setPack } from './packs.mjs'
import { MEERKAT_DIR, repoRootOf } from './paths.mjs'
import { checkListText, checkRow, checkShow, checkShowText, loadProject, presetShow } from './projectchecks.mjs'
import { yourAppCommand } from './yourapp.mjs'
import { suiteList, suiteListText, suiteShow, suiteShowText } from './suitelist.mjs'
import { mcpInstall, mcpStatus } from './mcpinstall.mjs'
import { findConfig } from './config.mjs'
import { ABOUT_MAX, cleanAbout, cleanPurpose, parseGroups, PURPOSE_MAX, resolvePreset } from './presets.mjs'
import { findingsCommand } from './findingscmd.mjs'
import { promptCommand } from './promptcmd.mjs'
import { listRuns, listRunsText, openRun, runLog, showRun } from './runs.mjs'
import { stripControl } from './tui/safe.mjs'
import { clearRecent, readRecent, readUserConfig, writeUserConfig } from './userconfig.mjs'

const NAME = /^[a-z0-9][a-z0-9-]*$/
const TAKEN = ['describe', 'doctor', 'tools', 'completion', 'mcp', 'preset', 'list', 'this', 'here', 'version', 'menu']

async function defaultAsk(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

// Can we ask? Only with a terminal, and never with --yes, --no-input or --json.
const canAsk = (ctx, flags = {}) => Boolean(ctx.interactive) && !flags.yes && !flags.noInput && !flags.json

// true: go ahead. false: the person said no. null: it needs a yes and cannot ask, so the caller says to add --yes.
async function confirm(ctx, flags, question) {
  if (flags.yes) return true
  if (!canAsk(ctx, flags)) return null
  const answer = (await (ctx.ask ?? defaultAsk)(`${question} [y/N] `)).toLowerCase()
  return answer === 'y' || answer === 'yes'
}

const needYes = (ctx, what) => {
  ctx.err(`${what} Add --yes to go ahead (or --dry-run to see what it would do).`)
  return 2
}

function removeFromJson(file, key, name) {
  const text = readFileSync(file, 'utf8')
  const crlf = text.includes('\r\n')
  const raw = JSON.parse(text)
  const group = raw[key] && typeof raw[key] === 'object' ? { ...raw[key] } : {}
  delete group[name]
  const next = { ...raw }
  if (Object.keys(group).length) next[key] = group
  else delete next[key]
  let out = `${JSON.stringify(next, null, 2)}\n`
  if (crlf) out = out.replace(/\n/g, '\r\n')
  writeFileSync(file, out)
}

function setInJson(file, key, name, value) {
  const text = readFileSync(file, 'utf8')
  const crlf = text.includes('\r\n')
  const raw = JSON.parse(text)
  const group = raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key]) ? { ...raw[key] } : {}
  group[name] = value
  let out = `${JSON.stringify({ ...raw, [key]: group }, null, 2)}\n`
  if (crlf) out = out.replace(/\n/g, '\r\n')
  writeFileSync(file, out)
}

// The words for a description that is too long (null when both fit). Longer text belongs in --purpose.
function textError(about, purpose) {
  const len = (t) => stripControl(String(t)).trim().length
  if (about !== undefined && len(about) > ABOUT_MAX) return `--about is too long (${len(about)} characters, up to ${ABOUT_MAX}). Keep it to one line and put the rest in --purpose.`
  if (purpose !== undefined && len(purpose) > PURPOSE_MAX) return `--purpose is too long (${len(purpose)} characters, up to ${PURPOSE_MAX}).`
  return null
}

export async function execute(plan, ctx) {
  const { out, err, env = process.env, flags: _f } = ctx
  const json = (data) => out(JSON.stringify(data, null, 2))
  const version = ctx.version ?? ''
  const presets = ctx.presets ?? loadPresets({ cwd: ctx.cwd, env })
  const names = listPresets(presets).map((p) => p.name)
  switch (plan.kind) {
    case 'help': {
      out(plan.topic ? commandHelp(plan.topic) : overviewHelp(names))
      return 0
    }
    case 'describe': {
      json(describe({ version, presetNames: names }))
      return 0
    }
    case 'completion': {
      out(completionScript(plan.shell).trimEnd())
      return 0
    }
    case 'noun':
      return noun(plan, ctx, { json, presets, names })
    default:
      err(`Not a command I can do here: ${plan.kind}`)
      return 2
  }
}

async function noun(plan, ctx, { json, presets, names }) {
  const { out, err, env = process.env } = ctx
  const f = plan.flags ?? {}
  const wantJson = Boolean(f.json)
  const note = (project) => {
    for (const n of project.notes ?? []) err(`config: ${stripControl(n)}`)
  }
  const key = `${plan.noun} ${plan.verb}`
  switch (key) {
    case 'check new':
    case 'check edit':
    case 'check remove':
    case 'check mine':
    case 'recommend list':
      return yourAppCommand(key, plan, ctx, { canAsk, confirm, needYes, defaultAsk })
    case 'discover list': {
      const project = await loadProject(plan.folder, { env })
      note(project)
      const data = discoverReport(project, { env })
      out(wantJson ? JSON.stringify(data, null, 2) : discoverText(data, data.folder))
      return 0
    }
    case 'check list': {
      const project = await loadProject(plan.folder, { env })
      note(project)
      const rows = project.checks.map(checkRow)
      out(wantJson ? JSON.stringify(rows, null, 2) : checkListText(rows, { flat: Boolean(f.flat) }))
      return 0
    }
    case 'suite list': {
      const project = await loadProject(plan.folder, { env })
      note(project)
      const data = await suiteList(project, { env, home: ctx.home })
      out(wantJson ? JSON.stringify(data, null, 2) : suiteListText(data))
      return 0
    }
    case 'suite show': {
      const project = await loadProject(plan.folder, { env })
      note(project)
      const data = await suiteShow(plan.name, project, { env, home: ctx.home })
      out(wantJson ? JSON.stringify(data, null, 2) : suiteShowText(data))
      return 0
    }
    case 'check show': {
      const project = await loadProject(plan.folder, { env })
      note(project)
      // "suite/check" is accepted too; the suite part is only a way to say which check.
      const c = project.checks.find((x) => x.id === plan.id || x.id === String(plan.id).split('/')[1])
      if (!c) {
        err(`No check called "${stripControl(plan.id)}" here. See: meerkat check list`)
        return 2
      }
      const d = checkShow(c)
      out(wantJson ? JSON.stringify(d, null, 2) : checkShowText(d))
      return 0
    }
    case 'repos list': {
      if (plan.scan) {
        let ok = false
        try {
          ok = statSync(plan.scan).isDirectory()
        } catch {
          /* not there */
        }
        if (!ok) {
          err(`${stripControl(plan.scan)} is not a folder`)
          return 2
        }
      }
      const r = discoverRepos({ cwd: ctx.cwd ?? process.cwd(), env, ...(ctx.home ? { home: ctx.home } : {}), scan: plan.scan ? [plan.scan] : [], ...(ctx.discover ?? {}) })
      const rows = r.all.map((x) => ({ name: stripControl(x.name), path: stripControl(x.path), branch: x.branch }))
      if (r.truncated) err('Stopped looking after 400 repositories or 2 seconds. Narrow it with: meerkat repos --scan <folder>')
      out(wantJson ? JSON.stringify(rows, null, 2) : reposText(rows))
      return 0
    }
    case 'recent list': {
      const rows = readRecent(env, ctx.home).map((p) => ({ name: stripControl(basename(p)), path: stripControl(p) }))
      out(wantJson ? JSON.stringify(rows, null, 2) : rows.length ? rows.map((r) => `${r.name}  ${r.path}`).join('\n') : 'No recent projects yet.')
      return 0
    }
    case 'recent clear': {
      if (f.dryRun) {
        out('Dry run. Would clear the recent projects list.')
        return 0
      }
      clearRecent(env, ctx.home)
      out(wantJson ? JSON.stringify({ cleared: true }) : 'Cleared the recent projects list.')
      return 0
    }
    case 'preset list': {
      const rows = listPresets(presets)
      out(wantJson ? JSON.stringify(rows.map((r) => ({ ...r, about: stripControl(r.about) })), null, 2) : presetsText(presets))
      return 0
    }
    case 'preset show': {
      if (!names.includes(plan.name)) {
        err(`No preset called "${stripControl(plan.name)}". Presets: ${names.join(', ')}`)
        return 2
      }
      const r = await presetShow(plan.name, plan.folder, { env })
      if (!r.ok) {
        err(r.text)
        return 2
      }
      out(wantJson ? JSON.stringify(r.data, null, 2) : r.text)
      return 0
    }
    case 'preset new':
      return presetNew(plan, ctx)
    case 'preset edit':
      return presetEdit(plan, ctx, presets)
    case 'preset delete':
      return presetDelete(plan, ctx, presets)
    case 'pack list': {
      const r = await listPacks(plan.folder ?? ctx.cwd, { env })
      out(wantJson ? JSON.stringify(r, null, 2) : packListText(r))
      return 0
    }
    case 'pack enable':
    case 'pack disable': {
      const enable = plan.verb === 'enable'
      const dry = setPack(plan.folder, plan.name, enable, { env, dryRun: true })
      if (!dry.ok) {
        err(dry.text)
        return dry.code ?? 1
      }
      if (f.dryRun || (dry.changed === false && !dry.dryRun)) {
        if (f.json) json({ ok: true, changed: false, dryRun: Boolean(f.dryRun), file: dry.file, packs: dry.packs })
        else out(dry.text)
        return 0
      }
      if (!enable) {
        const go = await confirm(ctx, f, `Turn off the ${plan.name} pack in ${dry.file}?`)
        if (go === null) return needYes(ctx, `Turning off a pack changes ${dry.file}.`)
        if (!go) {
          err('Left it as it was.')
          return 0
        }
      }
      const r = setPack(plan.folder, plan.name, enable, { env })
      if (f.json) json({ ok: r.ok, changed: r.changed, file: r.file, packs: r.packs })
      else out(r.text)
      return r.ok ? 0 : r.code ?? 1
    }
    case 'doctor run': {
      const r = await doctorReport(plan.folder, { env, find: ctx.find })
      out(wantJson ? JSON.stringify(r, null, 2) : doctorText(r))
      return r.notRun.length ? 1 : 0
    }
    case 'tools run': {
      const project = await loadProject(plan.folder, { env })
      const extra = project.checks.flatMap((c) => [...(c.needs ?? []), ...(c.optionalNeeds ?? [])].map((bin) => ({ bin, install: c.install })))
      const r = toolsReport({ env, dirs: [project.appDir, project.repoRoot], find: ctx.find, extra })
      out(wantJson ? JSON.stringify(r, null, 2) : toolsText(r))
      return 0
    }
    case 'tools install': {
      const project = await loadProject(plan.folder, { env })
      const r = toolsReport({ env, dirs: [project.appDir, project.repoRoot], find: ctx.find })
      const planText = installPlanText(r)
      if (!planText) {
        out('No npm-based tool is missing.')
        return 0
      }
      out(planText)
      if (f.dryRun) return 0
      const ok = await confirm(ctx, f, 'Install them now?')
      if (ok === null) return needYes(ctx, 'Installing needs a yes.')
      if (!ok) {
        out('Nothing was installed.')
        return 0
      }
      const done = installNpmTools(r, { env, run: ctx.npmRunner })
      ;(done.ok ? out : err)(done.text)
      return done.ok ? 0 : done.code || 1
    }
    case 'findings list':
    case 'finding show':
      return findingsCommand(plan, ctx)
    case 'prompt create':
      return promptCommand(plan, ctx)
    case 'run list': {
      const rows = listRuns(env, { limit: Number(f.limit) > 0 ? Number(f.limit) : 20, project: typeof f.project === 'string' ? f.project : null })
      out(wantJson ? JSON.stringify(rows, null, 2) : listRunsText(rows, env))
      return 0
    }
    case 'run show': {
      const r = showRun(env, plan.id, { json: wantJson })
      if (!r.ok) {
        err(r.text)
        return 1
      }
      out(wantJson ? JSON.stringify(r.data, null, 2) : r.text)
      return 0
    }
    case 'run log': {
      const r = runLog(env, plan.check, plan.id)
      if (!r.ok) {
        err(r.text)
        return 1
      }
      out(r.text)
      return 0
    }
    case 'run open': {
      const r = openRun(env, plan.id)
      if (!r.ok) {
        err(r.text)
        return 1
      }
      out(wantJson ? JSON.stringify({ runDir: r.dir }) : r.dir)
      return 0
    }
    case 'mcp install': {
      const r = mcpInstall({ dryRun: Boolean(f.dryRun), runner: ctx.runner, find: ctx.find, env })
      ;(r.ok ? out : err)(r.text)
      return r.code
    }
    case 'mcp status': {
      const r = mcpStatus({ runner: ctx.runner, find: ctx.find, env })
      if (wantJson) out(JSON.stringify({ registered: r.registered }, null, 2))
      else (r.ok ? out : err)(r.text)
      return r.code
    }
    case 'mcp serve': {
      const r = spawnSync(process.execPath, [join(MEERKAT_DIR, 'bin', 'meerkat-mcp.mjs')], { stdio: 'inherit', env })
      return r.status ?? 1
    }
    default:
      err(`Not a command I know: ${key}`)
      return 2
  }
}

async function presetNew(plan, ctx) {
  const { out, err, env = process.env } = ctx
  const f = { ...(plan.flags ?? {}) }
  if (!f.name && canAsk(ctx, f)) {
    const ask = ctx.ask ?? defaultAsk
    f.name = await ask('Name for the preset (lowercase letters, numbers, dashes): ')
    f.tier = (await ask('Which checks? fast or thorough [fast]: ')) || 'fast'
    f.group = await ask('Which kinds? security, functionality, ui, performance, refactor (comma separated, blank for all): ')
    f.about = await ask('One line about it (optional, Enter skips): ')
    f.purpose = await ask('What it is for and when to run it, a few sentences (optional, Enter skips): ')
    const where = (await ask('Save for you in every project, or in this project? personal or project [personal]: ')) || 'personal'
    if (where === 'project') f.project = true
  }
  const name = String(f.name ?? '')
  if (!name) {
    err('Give the preset a name: meerkat preset new --name pre-push --tier fast --group security,ui')
    return 2
  }
  if (!NAME.test(name) || nameOf(name) || TAKEN.includes(name) || allWords().includes(name)) {
    err(`"${stripControl(name)}" cannot be a preset name. Use lowercase letters, numbers and dashes, and not a command word.`)
    return 2
  }
  const tier = f.tier ?? 'fast'
  if (!['fast', 'thorough'].includes(tier)) {
    err('--tier must be fast or thorough')
    return 2
  }
  const wanted = String(f.group ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const groups = parseGroups(f.group)
  if (groups.length !== wanted.length) {
    err(`--group has a kind I do not know. Kinds: security, functionality, ui, performance, refactor`)
    return 2
  }
  const packs = String(f.pack ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  if (packs.some((p) => !/^[a-z0-9-]+$/.test(p))) {
    err('--pack must be pack names such as rust or security')
    return 2
  }
  if (f.personal && f.project) {
    err('Choose one: --personal or --project')
    return 2
  }
  const tooLong = textError(f.about, f.purpose)
  if (tooLong) {
    err(tooLong)
    return 2
  }
  const purpose = cleanPurpose(f.purpose)
  const preset = { tier, groups, ...(packs.length ? { packs } : {}), about: cleanAbout(f.about), ...(purpose ? { purpose } : {}) }
  const where = f.project ? 'project' : 'personal'
  const user = readUserConfig(env).presets
  const exists = (user && typeof user === 'object' && name in user) || (listPresets(ctx.presets ?? loadPresets({ cwd: ctx.cwd, env })).find((p) => p.name === name)?.source !== undefined)
  if (exists && !f.yes && !f.dryRun) {
    err(`A preset called "${name}" already exists. Pick another name, or delete it first: meerkat preset delete ${name}`)
    return 2
  }
  if (f.dryRun) {
    out(`Dry run. Would save the ${where} preset "${name}": ${JSON.stringify(preset)}`)
    return 0
  }
  if (f.project) {
    const r = saveProjectPreset(plan.folder ?? ctx.cwd, name, preset)
    if (!r.ok) {
      err(r.text)
      return 2
    }
    out(`Saved the preset "${name}" in ${r.file}. Run it: meerkat ${name}`)
  } else {
    savePersonalPreset(name, preset, env)
    out(`Saved your preset "${name}". Run it: meerkat ${name}`)
  }
  return 0
}

async function presetEdit(plan, ctx, presets) {
  const { out, err, env = process.env } = ctx
  const f = { ...(plan.flags ?? {}) }
  const name = plan.name
  const inProject = name in (presets.project ?? {})
  const inUser = name in (presets.user ?? {})
  if (!inProject && !inUser) {
    const bundled = listPresets(presets).some((p) => p.name === name)
    err(bundled ? `"${stripControl(name)}" is a bundled preset, so it cannot be changed. Make your own copy instead: meerkat preset new --name my-${stripControl(name)} --about "..." --purpose "..."` : `No preset of yours called "${stripControl(name)}". See: meerkat preset list`)
    return 2
  }
  if (f.personal && f.project) {
    err('Choose one: --personal or --project')
    return 2
  }
  const target = f.project ? (inProject ? 'project' : null) : f.personal ? (inUser ? 'personal' : null) : inProject ? 'project' : 'personal'
  if (!target) {
    err(`"${stripControl(name)}" is not a ${f.project ? 'project' : 'personal'} preset.`)
    return 2
  }
  for (const k of ['about', 'purpose']) {
    if (k in f && typeof f[k] !== 'string') {
      err(`--${k} needs some text, for example: meerkat preset edit ${stripControl(name)} --${k} "..."`)
      return 2
    }
  }
  const entry = (target === 'project' ? presets.project : presets.user)[name]
  const current = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
  const now = resolvePreset(name, { [name]: current }).preset
  if (!('about' in f) && !('purpose' in f)) {
    if (!canAsk(ctx, f)) {
      err(`Say what to change: meerkat preset edit ${stripControl(name)} --about "one line" --purpose "what it is for and when to run it"`)
      return 2
    }
    const ask = ctx.ask ?? defaultAsk
    const a = await ask(`One line about it [${now.about || 'none'}] (Enter keeps it, - clears it): `)
    const p = await ask(`What it is for and when to run it [${now.purpose ? 'set' : 'none'}] (Enter keeps it, - clears it): `)
    if (a) f.about = a === '-' ? '' : a
    if (p) f.purpose = p === '-' ? '' : p
    if (!('about' in f) && !('purpose' in f)) {
      err('Left it as it was.')
      return 0
    }
  }
  const tooLong = textError(f.about, f.purpose)
  if (tooLong) {
    err(tooLong)
    return 2
  }
  const next = { ...current }
  for (const [k, clean] of [['about', cleanAbout], ['purpose', cleanPurpose]]) {
    if (!(k in f)) continue
    const v = clean(f[k])
    if (v) next[k] = v
    else delete next[k]
  }
  const appDir = resolve(plan.folder ?? ctx.cwd)
  const file = target === 'project' ? findConfig({ appDir, repoRoot: repoRootOf(appDir) }) : null
  if (target === 'project' && !file) {
    err("Could not find this project's meerkat.config.json.")
    return 2
  }
  const changed = { ...('about' in f ? { about: next.about ?? '' } : {}), ...('purpose' in f ? { purpose: next.purpose ?? '' } : {}) }
  if (f.dryRun) {
    out(`Dry run. Would change the ${target} preset "${name}"${file ? ` in ${file}` : ''}: ${JSON.stringify(changed)}`)
    return 0
  }
  if (target === 'personal') {
    const all = readUserConfig(env).presets
    writeUserConfig({ presets: { ...(all && typeof all === 'object' && !Array.isArray(all) ? all : {}), [name]: next } }, env)
  } else {
    try {
      setInJson(file, 'presets', name, next)
    } catch {
      err(`${file} could not be read as JSON, so nothing was changed.`)
      return 2
    }
  }
  out(f.json ? JSON.stringify({ ok: true, name, source: target, ...changed }, null, 2) : `Updated the ${target} preset "${name}". See it: meerkat preset show ${name}`)
  return 0
}

async function presetDelete(plan, ctx, presets) {
  const { out, err, env = process.env } = ctx
  const f = plan.flags ?? {}
  const name = plan.name
  const inProject = name in (presets.project ?? {})
  const inUser = name in (presets.user ?? {})
  if (!inProject && !inUser) {
    err(name in (listPresets(presets).reduce((o, p) => ({ ...o, [p.name]: 1 }), {})) ? `"${stripControl(name)}" is a bundled preset. Only your own presets can be deleted.` : `No preset of yours called "${stripControl(name)}". See: meerkat preset list`)
    return 2
  }
  const target = f.project ? (inProject ? 'project' : null) : inUser ? 'personal' : 'project'
  if (!target) {
    err(`"${stripControl(name)}" is not a project preset here.`)
    return 2
  }
  const appDir = resolve(plan.folder ?? ctx.cwd)
  const file = target === 'project' ? findConfig({ appDir, repoRoot: repoRootOf(appDir) }) : null
  if (f.dryRun) {
    out(`Dry run. Would delete the ${target} preset "${name}"${file ? ` from ${file}` : ''}.`)
    return 0
  }
  const go = await confirm(ctx, f, `Delete your ${target} preset "${name}"?`)
  if (go === null) return needYes(ctx, 'Deleting a preset cannot be undone.')
  if (!go) {
    err('Left it as it was.')
    return 0
  }
  if (target === 'personal') {
    const rest = { ...(readUserConfig(env).presets ?? {}) }
    delete rest[name]
    writeUserConfig({ presets: Object.keys(rest).length ? rest : null }, env)
  } else if (file && existsSync(file)) removeFromJson(file, 'presets', name)
  out(`Deleted the ${target} preset "${name}".`)
  return 0
}
