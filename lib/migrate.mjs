// Migration help: recommend only, never edits the project. Data lives in migrations/*.json (one file per framework),
// each item taken from the framework's official upgrade guide, with the guide URL. The project's own test suite is the judge.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url))

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// First number in a version range such as "^14.2.3" or "~15" or ">=14 <16"; null when none (for example "latest" or "workspace:*").
export function majorOf(range) {
  const m = /\d+/.exec(String(range ?? ''))
  return m ? Number(m[0]) : null
}

export function loadMigrations(dir = MIGRATIONS_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(dir, f))).filter((d) => d && d.framework && d.package && Array.isArray(d.guides))
}

// Small local reader (lib/advisory.mjs with detectStack was not on this branch): declared ranges from package.json.
export function detectVersions(folder) {
  const pkg = readJson(join(folder, 'package.json'))
  if (!pkg) return { pkg: null, deps: {} }
  return { pkg, deps: { ...pkg.devDependencies, ...pkg.dependencies } }
}

// The commands to run before and after: the project's own test script, run through its package manager. Nothing more.
export function testCommand(folder, pkg) {
  const script = pkg?.scripts?.test
  if (!script || /no test specified/i.test(script)) return null
  const pm = existsSync(join(folder, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(folder, 'yarn.lock')) ? 'yarn' : 'npm'
  return `${pm} test`
}

// Plan an upgrade of one framework to a target major. Returns a plain object; the caller prints it.
export function planMigration({ folder, framework, target, dir = MIGRATIONS_DIR }) {
  const data = loadMigrations(dir).find((d) => d.framework === framework)
  if (!data) return { ok: false, framework, reason: `no migration data for "${framework}" (nothing is listed from memory; add migrations/${framework}.json from the official guide)` }
  const { pkg, deps } = detectVersions(folder)
  if (!pkg) return { ok: false, framework, reason: 'no package.json found' }
  const range = deps[data.package]
  if (!range) return { ok: false, framework, reason: `${data.package} is not a dependency of this project` }
  const current = majorOf(range)
  const to = majorOf(target)
  if (current == null) return { ok: false, framework, reason: `cannot read a major version from "${range}"` }
  if (to == null) return { ok: false, framework, reason: `target "${target}" is not a version number` }
  if (to <= current) return { ok: false, framework, current, target: to, reason: `target ${to} is not newer than the current major ${current}` }
  const guides = data.guides.filter((g) => g.from >= current && g.to <= to).sort((a, b) => a.from - b.from)
  const missing = []
  for (let v = current; v < to; v++) if (!guides.some((g) => g.from === v)) missing.push(`${v} to ${v + 1}`)
  const checklist = guides.flatMap((g) => g.items.map((i) => ({ id: `${g.from}-${g.to}/${i.id}`, title: i.title, guide: g.url, url: i.anchor ? g.url + i.anchor : g.url, files: i.files, pattern: i.pattern, change: i.change })))
  const cmd = testCommand(folder, pkg)
  return {
    ok: true,
    framework: data.framework,
    name: data.name,
    package: data.package,
    declared: range,
    current,
    target: to,
    checklist,
    missingGuides: missing,
    judge: cmd ? { before: cmd, after: cmd } : { before: null, after: null, note: 'no test script in package.json: there is no judge for this upgrade' },
  }
}

export function formatMigration(r) {
  if (!r.ok) return `Migration help: ${r.reason}`
  const out = [`${r.name} ${r.current} to ${r.target} (declared ${r.package}@${r.declared}). Recommendations only; nothing was changed.`]
  for (const i of r.checklist) out.push(`- [ ] ${i.title}\n    guide: ${i.url}\n    look in: ${i.files.join(', ')}  for: /${i.pattern}/\n    change: ${i.change}`)
  if (r.missingGuides.length) out.push(`No guide data for: ${r.missingGuides.join(', ')}. Read the official guide; nothing is listed from memory.`)
  out.push(r.judge.before ? `Judge: run "${r.judge.before}" before and again after. Same result means the upgrade held.` : `Judge: ${r.judge.note}`)
  return out.join('\n')
}
