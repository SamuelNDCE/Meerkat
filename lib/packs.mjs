// `meerkat pack list|enable|disable`: which packs of checks exist, which are on for a folder, and whether their tools are installed.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { CONFIG_NAME, findConfig } from './config.mjs'
import { detect } from './init.mjs'
import { loadChecks } from './load-checks.mjs'
import { MEERKAT_DIR, repoRootOf } from './paths.mjs'
import { readUserConfig } from './userconfig.mjs'
import { stripControl } from './tui/safe.mjs'
import { findBinary, localPath } from './which.mjs'

const subfolders = (dir) => {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith('.') && /^[a-z0-9-]+$/.test(n) && statSync(join(dir, n)).isDirectory()).sort()
  } catch {
    return []
  }
}

// Every pack Meerkat can find: bundled (packs/), examples/, ~/.meerkat/packs and the folders from `meerkat pack add`.
export function availablePacks(env = process.env, home = homedir()) {
  const dirs = readUserConfig(env, home).packDirs
  const extra = Array.isArray(dirs) ? dirs.filter((d) => typeof d === 'string') : []
  const sources = [['bundled', join(MEERKAT_DIR, 'packs')], ['example', join(MEERKAT_DIR, 'examples')], ['personal', join(home, '.meerkat', 'packs')], ...extra.map((d) => ['folder', d])]
  const seen = new Set()
  const out = []
  for (const [source, dir] of sources) {
    for (const name of subfolders(dir)) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push({ name, source, dir: join(dir, name) })
    }
  }
  return out
}

// Is a tool there? The project's own node_modules/.bin counts, as it does for a real run.
export function toolFound(bin, { env = process.env, dirs = [], find = findBinary } = {}) {
  return Boolean(find(bin, { ...env, ...localPath(env, dirs) }))
}

export function enabledPacks(folder, env = process.env) {
  const appDir = resolve(folder)
  const file = findConfig({ appDir, repoRoot: repoRootOf(appDir) })
  if (!file) return { file: null, packs: detect(appDir).config.packs, detected: true }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return { file, packs: Array.isArray(raw?.packs) ? raw.packs.filter((p) => typeof p === 'string') : [], detected: false }
  } catch {
    return { file, packs: [], detected: false }
  }
}

export async function listPacks(folder, { env = process.env, find = findBinary, load = loadChecks, home = homedir() } = {}) {
  const appDir = resolve(folder)
  const on = enabledPacks(appDir, env)
  const dirs = [appDir, repoRootOf(appDir)]
  const rows = []
  for (const p of availablePacks(env, home)) {
    const checks = await load(p.dir)
    const tools = []
    for (const c of checks) for (const bin of c.needs ?? []) tools.push({ check: stripControl(c.id), tool: stripControl(bin), found: toolFound(bin, { env, dirs, find }), install: c.install ? stripControl(c.install) : null })
    rows.push({ name: p.name, source: p.source, enabled: on.packs.includes(p.name), checks: checks.length, tools })
  }
  return { folder: appDir, configFile: on.file, detected: on.detected, packs: rows }
}

export function packListText(r) {
  const w = Math.max(4, ...r.packs.map((p) => p.name.length))
  const lines = [`Packs for ${r.folder}${r.detected ? ' (no meerkat.config.json yet: the packs that fit this folder are on)' : ''}`, '', `  ${'pack'.padEnd(w)}  ${'on?'.padEnd(4)} checks  tools`]
  for (const p of r.packs) {
    const missing = [...new Set(p.tools.filter((t) => !t.found).map((t) => t.tool))]
    const tools = !p.tools.length ? 'none needed' : missing.length ? `missing: ${missing.join(', ')}` : 'all installed'
    lines.push(`  ${p.name.padEnd(w)}  ${(p.enabled ? 'on' : 'off').padEnd(4)} ${String(p.checks).padStart(6)}  ${tools}`)
  }
  lines.push('', 'Switch one: meerkat pack enable <name>   meerkat pack disable <name>')
  return lines.join('\n')
}

// Edit meerkat.config.json: create it if missing, keep every other key, 2-space JSON, keep CRLF if the file had it.
export function setPack(folder, name, enable, { env = process.env, dryRun = false, home = homedir(), write = writeFileSync, read = (f) => readFileSync(f, 'utf8'), exists = existsSync } = {}) {
  const appDir = resolve(folder)
  if (!/^[a-z0-9-]+$/.test(String(name))) return { ok: false, code: 2, text: `"${stripControl(name)}" is not a pack name. See: meerkat pack list` }
  const known = availablePacks(env, home).map((p) => p.name)
  if (enable && !known.includes(name)) return { ok: false, code: 2, text: `No pack called "${name}". Packs: ${known.join(', ')}` }
  const found = findConfig({ appDir, repoRoot: repoRootOf(appDir), exists })
  const file = found ?? join(appDir, CONFIG_NAME)
  let raw = {}
  let crlf = false
  if (found) {
    const text = read(file)
    crlf = text.includes('\r\n')
    try {
      raw = JSON.parse(text)
    } catch {
      return { ok: false, code: 2, text: `${file} is not valid JSON, so nothing was changed. Fix it, then try again.` }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 2, text: `${file} is not a JSON object, so nothing was changed.` }
  }
  const current = Array.isArray(raw.packs) ? raw.packs.filter((p) => typeof p === 'string') : found ? [] : detect(appDir).config.packs
  const has = current.includes(name)
  if (enable === has) return { ok: true, changed: false, file, packs: current, text: `The ${name} pack is already ${enable ? 'on' : 'off'} (${file})` }
  const packs = enable ? [...current, name] : current.filter((p) => p !== name)
  const verb = enable ? 'Turn on' : 'Turn off'
  if (dryRun) return { ok: true, changed: false, dryRun: true, file, packs, text: `Dry run. ${verb} the ${name} pack in ${file}${found ? '' : ' (new file)'}:\n  packs: ${JSON.stringify(packs)}` }
  let out = `${JSON.stringify({ ...raw, packs }, null, 2)}\n`
  if (crlf) out = out.replace(/\n/g, '\r\n')
  write(file, out)
  return { ok: true, changed: true, file, packs, text: `${enable ? 'Turned on' : 'Turned off'} the ${name} pack in ${file}\n  packs: ${JSON.stringify(packs)}` }
}
