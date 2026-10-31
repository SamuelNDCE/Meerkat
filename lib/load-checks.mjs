// Loads every checks/*.mjs. A file that fails to import, or exports something that is not an array of
// well-formed checks, becomes one synthetic failing check naming the file: it never crashes the run.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const GROUPS = ['security', 'functionality', 'ui', 'performance', 'refactor']
const TIERS = ['fast', 'thorough']
const LANES = ['free', 'cargo', 'electron']

export function validateCheck(c) {
  if (!c || typeof c !== 'object') return 'not an object'
  if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) return 'id must be kebab-case'
  if (!GROUPS.includes(c.group)) return `${c.id}: bad group`
  if (!TIERS.includes(c.tier)) return `${c.id}: bad tier`
  if (!LANES.includes(c.lane)) return `${c.id}: bad lane`
  if (c.weight !== undefined && !['tiny', 'light', 'medium', 'heavy', 'alone'].includes(c.weight)) return `${c.id}: weight must be tiny, light, medium, heavy or alone`
  if (typeof c.title !== 'string') return `${c.id}: missing title`
  if (typeof c.run !== 'function' && !(c.run && typeof c.run.cmd === 'string')) return `${c.id}: bad run`
  return null
}

function brokenFile(file, why) {
  return {
    id: `bad-check-file-${file.replace(/\.mjs$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    group: 'functionality',
    tier: 'fast',
    lane: 'free',
    title: `Check file ${file} loads`,
    estSeconds: 0,
    run: () => ({ ok: false, detail: `checks/${file}: ${why}` }),
    selfTest: () => ({ ok: false, detail: 'synthetic: always fails' }),
    source: file,
  }
}

export async function loadChecks(checksDir) {
  let files = []
  try {
    files = readdirSync(checksDir).filter((f) => f.endsWith('.mjs')).sort()
  } catch {
    return []
  }
  const all = []
  const seen = new Set()
  for (const file of files) {
    let mod
    try {
      mod = await import(pathToFileURL(join(checksDir, file)).href)
    } catch (e) {
      all.push(brokenFile(file, `import failed: ${String(e?.message ?? e).split('\n')[0]}`))
      continue
    }
    const list = mod.default
    if (!Array.isArray(list)) {
      all.push(brokenFile(file, 'default export is not an array'))
      continue
    }
    for (const c of list) {
      const bad = validateCheck(c)
      if (bad) all.push(brokenFile(file, bad))
      else if (seen.has(c.id)) all.push(brokenFile(file, `duplicate id ${c.id}`))
      else {
        seen.add(c.id)
        all.push({ ...c, source: file })
      }
    }
  }
  return all
}
