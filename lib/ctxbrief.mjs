// `meerkat context [folder] [--json]` (roadmap C1): a short project brief an AI reads first. Sections, always in this order:
//   what it is, how to verify it, which checks apply, the folders and what each holds, the rules files that exist.
// Prints to stdout only and writes nothing into the project (no run folder, no cache). Every path it names is checked on disk first.
// Size: 4000 characters by default. Over the cap, the long lists (folders, checks) lose their last items and say "[truncated]"; the section
// headings, the "what it is" text, the verify commands and the rules files are never cut. If those alone are over the cap, the brief is longer
// than the cap rather than missing a fixed section.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { readCommands } from './repocommands.mjs'
import { loadProjectChecks } from './gate.mjs'
import { filesUnder } from './applies.mjs'
import { matchesAny } from './glob.mjs'

export const DEFAULT_CAP = 4000
export const RULES_FILES = ['PROJECT.md', 'CLAUDE.md', 'AGENTS.md', 'DESIGN.md']
const VERIFY_SCRIPTS = ['test', 'build', 'typecheck', 'lint']
const DESC_CAP = 160
const USAGE = 'Use: meerkat context [folder] [--json]'
const oneLine = (s, n) => {
  const t = String(s).replace(/`/g, "'").replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 3)}...` : t
}
const readText = (p) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}
const readJson = (p) => {
  const t = readText(p)
  if (t === null) return null
  try {
    const j = JSON.parse(t)
    return j && typeof j === 'object' ? j : null
  } catch {
    return null
  }
}

// The first paragraph of a README, skipping the title, badges and html lines.
export function readmeParagraph(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const para = []
  for (const raw of lines) {
    const l = raw.trim()
    if (!l) {
      if (para.length) break
      continue
    }
    if (/^(#|!\[|\[!\[|<|---|===|>|\|)/.test(l)) {
      if (para.length) break
      continue
    }
    para.push(l)
  }
  return oneLine(para.join(' '), 300)
}

function whatSection(dir) {
  const pkg = readJson(join(dir, 'package.json'))
  const readme = readText(join(dir, 'README.md'))
  const para = readme ? readmeParagraph(readme) : ''
  const name = pkg && typeof pkg.name === 'string' ? pkg.name : null
  const desc = pkg && typeof pkg.description === 'string' && pkg.description.trim() ? oneLine(pkg.description, 300) : null
  if (name && desc) return { source: 'package.json', text: `${name}: ${desc}` }
  if (name && para) return { source: 'package.json (name) and README.md (first paragraph)', text: `${name}: ${para}` }
  if (para) return { source: 'README.md (first paragraph)', text: para }
  if (name) return { source: 'package.json (name only)', text: name }
  return { source: null, text: 'No package.json name or description and no README.md paragraph found.' }
}

function verifySection(dir) {
  const r = readCommands(dir)
  const names = Object.keys(r.commands)
  if (names.length) {
    const rel = r.file ? basename(r.file) : 'meerkat.config.json'
    return { source: `${rel} commands block`, commands: names.map((n) => ({ name: n, command: r.commands[n] })) }
  }
  const scripts = readJson(join(dir, 'package.json'))?.scripts
  const found = []
  if (scripts && typeof scripts === 'object') for (const n of VERIFY_SCRIPTS) if (typeof scripts[n] === 'string') found.push({ name: n, command: `npm run ${n}` })
  return found.length ? { source: 'package.json scripts', commands: found } : { source: null, commands: [] }
}

async function checksSection(dir) {
  try {
    const { checks } = await loadProjectChecks(dir, dir)
    const files = filesUnder(dir)
    const apply = checks.filter((c) => !Array.isArray(c.appliesTo) || !c.appliesTo.length || matchesAny(c.appliesTo, files))
    const byGroup = new Map()
    for (const c of apply) byGroup.set(c.group ?? 'other', (byGroup.get(c.group ?? 'other') ?? 0) + 1)
    const groups = [...byGroup].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count || (a.group < b.group ? -1 : 1))
    return { loaded: checks.length, apply: apply.length, groups }
  } catch (e) {
    return { loaded: 0, apply: 0, groups: [], error: oneLine(e?.message ?? e, 100) }
  }
}

function foldersSection(dir) {
  const map = readText(join(dir, 'MAP.md'))
  const rows = []
  if (map) {
    for (const m of map.replace(/\r\n?/g, '\n').matchAll(/^\|\s*`([^`|]+)`\s*\|\s*([^|]*?)\s*\|/gm)) {
      const p = m[1].trim()
      if (!p || p.startsWith('/') || p.includes('..')) continue
      try {
        if (statSync(join(dir, p)).isDirectory() && !rows.some((r) => r.path === p)) rows.push({ path: p.endsWith('/') ? p : `${p}/`, text: oneLine(m[2], DESC_CAP) })
      } catch {
        // listed in MAP.md but not on disk: never named
      }
    }
    if (rows.length) return { source: 'MAP.md', items: rows }
  }
  const counts = new Map()
  for (const f of filesUnder(dir)) if (f.includes('/') && !f.startsWith('.')) counts.set(f.split('/')[0], (counts.get(f.split('/')[0]) ?? 0) + 1)
  const items = [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, c]) => ({ path: `${n}/`, text: `${c} file${c === 1 ? '' : 's'} (no description: this project has no MAP.md)` }))
  return { source: map ? 'folders on disk (MAP.md has no usable folder table)' : 'folders on disk (no MAP.md)', items }
}

const rulesSection = (dir) => RULES_FILES.filter((f) => existsSync(join(dir, f))).map((path) => ({ path }))

// The pure core: the facts as data.
export async function buildBrief(dir) {
  return { folder: basename(dir), what: whatSection(dir), verify: verifySection(dir), checks: await checksSection(dir), folders: foldersSection(dir), rules: rulesSection(dir) }
}

// Text of the brief. Trims the last items of the longest list until it fits the cap; the marker says how many were left out.
export function renderBrief(b, cap = DEFAULT_CAP) {
  const trim = { checks: 0, folders: 0 }
  const render = () => {
    const L = [`# Project brief: ${b.folder}`, '']
    L.push('## What it is', `From ${b.what.source ?? 'nothing found'}.`, b.what.text, '')
    L.push('## Verify with')
    if (b.verify.commands.length) {
      L.push(`From ${b.verify.source}.`)
      for (const c of b.verify.commands) L.push(`- ${c.name}: ${oneLine(c.command, 200)}`)
    } else L.push('No commands block in meerkat.config.json and no test, build, typecheck or lint script in package.json.')
    L.push('')
    L.push('## Checks that apply')
    if (b.checks.error) L.push(`Could not list the checks: ${b.checks.error}`)
    else {
      L.push(`${b.checks.apply} of ${b.checks.loaded} loaded checks apply here. List them: meerkat list`)
      const g = b.checks.groups.slice(0, b.checks.groups.length - trim.checks)
      for (const x of g) L.push(`- ${x.group}: ${x.count}`)
      if (trim.checks) L.push(`[truncated] ${trim.checks} more group${trim.checks === 1 ? '' : 's'} not shown`)
    }
    L.push('')
    L.push('## Folders', `From ${b.folders.source}.`)
    if (!b.folders.items.length) L.push('No folders found.')
    for (const x of b.folders.items.slice(0, b.folders.items.length - trim.folders)) L.push(`- \`${x.path}\`: ${x.text}`)
    if (trim.folders) L.push(`[truncated] ${trim.folders} more folder${trim.folders === 1 ? '' : 's'} not shown`)
    L.push('')
    L.push('## Rules files')
    if (b.rules.length) for (const r of b.rules) L.push(`- \`${r.path}\``)
    else L.push('None of PROJECT.md, CLAUDE.md, AGENTS.md, DESIGN.md exists.')
    return `${L.join('\n')}\n`
  }
  let text = render()
  while (text.length > cap) {
    const fLeft = b.folders.items.length - trim.folders
    const cLeft = b.checks.error ? 0 : b.checks.groups.length - trim.checks
    if (fLeft <= 0 && cLeft <= 0) break
    if (fLeft >= cLeft) trim.folders++
    else trim.checks++
    text = render()
  }
  return text
}

// `meerkat context [folder] [--json]`. Exit 0 done, 2 usage.
export async function runContext(argv, { cwd = process.cwd(), out = (l) => process.stdout.write(`${l}\n`), err = (l) => process.stderr.write(`${l}\n`) } = {}) {
  let json = false
  let folder = null
  for (const a of argv) {
    if (a === '--json') json = true
    else if (String(a).startsWith('-')) {
      err(`context: unknown option ${String(a).slice(0, 60)}. ${USAGE}`)
      return 2
    } else if (folder === null) folder = a
    else {
      err(`context: one folder at most. ${USAGE}`)
      return 2
    }
  }
  const dir = resolve(cwd, folder ?? '.')
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    err(`context: ${folder ?? '.'} is not a folder`)
    return 2
  }
  const b = await buildBrief(dir)
  if (json) {
    out(JSON.stringify({ schemaVersion: 1, folder: b.folder, sections: { what: b.what, verify: b.verify, checks: b.checks, folders: b.folders, rules: b.rules } }, null, 2))
    return 0
  }
  out(renderBrief(b).replace(/\n$/, ''))
  return 0
}
