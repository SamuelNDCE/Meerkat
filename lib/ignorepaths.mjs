// `ignorePaths` in meerkat.config.json: files left out of the checks. A top-level list applies to every preset; "presets": { "quick": { "ignorePaths": [...] } }
// applies to that preset only. Patterns are written like .meerkatignore lines (a folder: "apps/desktop-web/**" or "supabase/"). The patterns reach Meerkat's own
// file-walking checks through MEERKAT_IGNORE_PATHS (thorough/kit.mjs trackedFiles); an outside tool (eslint, tsc, cargo) still reads the whole project.
import { isMeerkatIgnored, listTrackedFiles, parseMeerkatIgnore } from '../thorough/kit.mjs'

export const MAX_PATTERNS = 200
// A list of safe pattern lines from a value, or null when it is not a list of text.
export function cleanPatterns(v) {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null
  return v.map((x) => x.replace(/[\u0000-\u001f\u007f]/g, '').trim()).filter((x) => x && !x.startsWith('#') && !x.startsWith('!') && x.length <= 300).slice(0, MAX_PATTERNS)
}

// [{ key, patterns }] for a run: the top-level list, then the chosen preset's own.
export function ignoreSources(config, presetName) {
  const out = []
  const top = cleanPatterns(config?.ignorePaths) ?? []
  if (top.length) out.push({ key: 'ignorePaths', patterns: top })
  const own = presetName ? cleanPatterns(config?.presets?.[presetName]?.ignorePaths) ?? [] : []
  if (own.length) out.push({ key: `presets.${presetName}.ignorePaths`, patterns: own })
  return out
}

// { total, byKey: [{ key, count }], patterns } for the files git tracks in a folder.
export function ignoreSummary(appDir, sources) {
  const patterns = sources.flatMap((s) => s.patterns)
  if (!patterns.length) return { total: 0, byKey: [], patterns }
  const files = listTrackedFiles(appDir)
  const seen = new Set()
  const byKey = sources.map((s) => {
    const rules = parseMeerkatIgnore(s.patterns.join('\n'))
    let count = 0
    for (const f of files) if (!seen.has(f) && isMeerkatIgnored(rules, f)) (seen.add(f), count++)
    return { key: s.key, count }
  })
  return { total: seen.size, byKey, patterns }
}

export const ignoreLine = (sum) => (sum.patterns.length ? `ignorePaths: ${sum.total} file(s) left out (${sum.byKey.map((k) => `${k.key}: ${k.count}`).join(', ')})` : null)
