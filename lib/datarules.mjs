// Data-driven rules: a language is covered by a JSON file of regex rules, no JavaScript needed.
// Rule file shape: { "rules": [ { id, title, severity, glob, pattern, flags?, message, bad, good, comments? } ] }
import { readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { globToRegExp } from './glob.mjs'

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/
const MAX_PER_RULE = 25
const MAX_BYTES = 1024 * 1024

const globsOf = (rule) => (Array.isArray(rule.glob) ? rule.glob : [rule.glob])
const regexOf = (rule) => new RegExp(rule.pattern, (rule.flags ?? '').replace(/[gy]/g, ''))

function validateRule(r, i) {
  const where = `rule ${i + 1}${r && typeof r.id === 'string' ? ` (${r.id})` : ''}`
  if (!r || typeof r !== 'object') return `${where}: not an object`
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return `${where}: id must match ${ID_RE}`
  if (!SEVERITIES.includes(r.severity)) return `${where}: severity must be one of ${SEVERITIES.join('|')}`
  const globs = Array.isArray(r.glob) ? r.glob : [r.glob]
  if (!globs.length || globs.some((g) => typeof g !== 'string' || !g)) return `${where}: glob must be a non-empty string or array of strings`
  if (typeof r.pattern !== 'string' || !r.pattern) return `${where}: pattern must be a non-empty string`
  if (r.flags !== undefined && typeof r.flags !== 'string') return `${where}: flags must be a string`
  try {
    regexOf(r)
  } catch (e) {
    return `${where}: pattern does not compile (${e.message})`
  }
  if (typeof r.title !== 'string' || !r.title) return `${where}: title must be a non-empty string`
  if (typeof r.message !== 'string' || !r.message) return `${where}: message must be a non-empty string`
  if (typeof r.bad !== 'string' || !r.bad.trim()) return `${where}: bad must be a non-empty string`
  if (typeof r.good !== 'string' || !r.good.trim()) return `${where}: good must be a non-empty string`
  return null
}

export function loadRuleFile(file) {
  const errors = []
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return { rules: [], errors: [`${file}: cannot read rules (${e.message})`] }
  }
  if (!data || !Array.isArray(data.rules)) return { rules: [], errors: [`${file}: expected { "rules": [...] }`] }
  const rules = []
  const seen = new Set()
  data.rules.forEach((r, i) => {
    const err = validateRule(r, i)
    if (err) return errors.push(err)
    if (seen.has(r.id)) return errors.push(`rule ${i + 1} (${r.id}): duplicate id`)
    seen.add(r.id)
    rules.push(r)
  })
  return { rules, errors }
}

const lineHits = (re, text) => String(text).split(/\r?\n/).some((l) => re.test(l))

export function selfTestRule(rule) {
  let re
  try {
    re = regexOf(rule)
  } catch (e) {
    return { ok: false, detail: `pattern does not compile (${e.message})` }
  }
  if (!lineHits(re, rule.bad)) return { ok: false, detail: 'the bad sample is not matched by the pattern' }
  if (lineHits(re, rule.good)) return { ok: false, detail: 'the good sample is matched by the pattern' }
  return { ok: true, detail: 'bad sample caught, good sample clean' }
}

const isComment = (line) => /^\s*(\/\/|\*|#)/.test(line)

export function scanRules(rules, files, readText) {
  const findings = []
  for (const rule of rules) {
    let re
    try {
      re = regexOf(rule)
    } catch {
      continue
    }
    const globRes = globsOf(rule).map(globToRegExp)
    let count = 0
    for (const f of files) {
      if (count >= MAX_PER_RULE) break
      if (!globRes.some((g) => g.test(f.path))) continue
      let text = f.text
      if (typeof text !== 'string' && typeof readText === 'function') text = readText(f.path)
      if (typeof text !== 'string') continue
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length && count < MAX_PER_RULE; i++) {
        if (!rule.comments && isComment(lines[i])) continue
        if (re.test(lines[i])) {
          findings.push({ severity: rule.severity, rule: rule.id, file: f.path, line: i + 1, message: rule.message })
          count++
        }
      }
    }
  }
  return findings
}

export function trackedFiles(repoRoot) {
  try {
    const out = execFileSync('git', ['-C', String(repoRoot), 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/'))
  } catch {
    return []
  }
}

// Reads one repo-relative file as text; null when it is missing, unreadable or over 1 MB.
export function readText(repoRoot, rel) {
  try {
    const p = join(String(repoRoot), rel)
    if (statSync(p).size > MAX_BYTES) return null
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

export function dataRuleChecks(rules, { trackedFiles: tracked = trackedFiles, readText: read = readText } = {}) {
  return rules.map((rule) => ({
    id: rule.id,
    title: rule.title,
    group: rule.severity === 'high' || rule.severity === 'critical' ? 'security' : 'functionality',
    tier: 'fast',
    lane: 'free',
    weight: 'tiny',
    estSeconds: 1,
    paths: globsOf(rule),
    needs: [],
    run: (ctx) => {
      const root = ctx.repoRoot
      const globRes = globsOf(rule).map(globToRegExp)
      const files = tracked(root)
        .filter((p) => globRes.some((g) => g.test(p)))
        .map((p) => ({ path: p, text: read(root, p) }))
        .filter((f) => typeof f.text === 'string')
      const findings = scanRules([rule], files)
      return { ok: findings.length === 0, detail: findings.length ? `${findings.length} finding(s)` : 'clean', findings }
    },
    // The runner expects a FAIL here: the bad sample must be caught.
    selfTest: () => {
      const st = selfTestRule(rule)
      if (!st.ok) return { ok: true, detail: `self-test: sample was not caught (${st.detail})` }
      const ext = globsOf(rule)[0].replace(/^.*\*/, '') || '.txt'
      const findings = scanRules([rule], [{ path: `sample${ext}`, text: rule.bad }])
      if (findings.length === 0) return { ok: true, detail: 'self-test: sample was not caught' }
      return { ok: false, detail: `self-test: bad sample caught (${findings.length} finding(s))`, findings }
    },
  }))
}
