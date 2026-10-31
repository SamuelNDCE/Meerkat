// Web-hardening and supply-chain checks that read config and markup as text, so no tool has to be installed. Four checks:
//   wh-headers       HTTP headers and TLS settings in server, framework and hosting config (OWASP ZAP passive, Mozilla Observatory,
//                    Nikto and testssl.sh ideas, written as Meerkat's own rules)
//   wh-html          structural and security audits on page templates (session ids in URLs, private IPs, password fields, iframes)
//   wh-publish-root  files that should never sit in a published folder (.git, .env, dumps, phpinfo, source maps, repo-root publish)
//   wh-supply        vendored library versions (a small verified table), lockfile and manifest hygiene, SBOM readiness
// The rule tables live in thorough/rules-web-hardening.mjs. Run one by hand:
//   node thorough/web-hardening.mjs <check> [--root <dir>]      node thorough/web-hardening.mjs <check> --fixtures   (must exit 1)
// Each rule prints one "MEERKAT-SUB <PASS|FAIL|NA> <id> <reason>" line. NA means the rule does not apply to this folder.
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { isFixture, main, readText, trackedFiles, withFixture } from './kit.mjs'
import { HEADERS, HTML, PUBLISH, SUPPLY } from './rules-web-hardening.mjs'

const NOISE = /(^|\/)(node_modules|target)\//
// The rule tables and this runner hold the bad samples as literal text, and tests hold deliberately bad snippets: neither is read as code.
const SELF = /(^|\/)(rules-web-hardening|web-hardening)\.mjs$|(^|\/)webhardening\.test\.ts$|(^|\/)packs\/web-hardening\/|(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i

// Files git tracks (or a plain walk outside git), without dependency folders, fixtures and the rule sources themselves.
export const contentFiles = (root) => trackedFiles(root).filter((f) => !NOISE.test(f) && !isFixture(f) && !SELF.test(f))

// Accepted findings: one "<rule-id> <path>" per line in .meerkat-webhardening-allow (# for comments). A path accepts the whole file.
const allowSet = (root) => new Set(readText(root, '.meerkat-webhardening-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))

// Every path in the folder, including ignored build output (a deployed folder is what matters here). A nested .git is reported
// as its config and HEAD files, so it can be matched. Walk depth and size are capped so a huge tree cannot hang the check.
export function allPaths(root) {
  const out = []
  const walk = (dir, rel, depth) => {
    if (depth > 12 || out.length > 200000) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'target') continue
        if (e.name === '.git') {
          for (const g of ['config', 'HEAD']) if (existsSync(join(dir, e.name, g))) out.push(`${rel ? `${rel}/` : ''}.git/${g}`)
          continue
        }
        walk(join(dir, e.name), r, depth + 1)
      } else out.push(r)
    }
  }
  walk(root, '', 0)
  return out
}

// Where one content rule fires in one file. null = the file is not in scope (its `when` gate failed), [] = clean, otherwise the hits.
// Markup that is a comment or documentation, not live HTML: blanked (newlines kept, so line numbers stay true) before the page rules read it.
const COMMENTS = /<!--[\s\S]*?-->|\{%-?\s*(comment|doc)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}|\{#[\s\S]*?#\}|\{\{!--[\s\S]*?--\}\}/g
const blank = (t) => t.replace(COMMENTS, (m) => m.replace(/[^\r\n]/g, ' '))

// Express's helmet() sets these headers by default, so a project that calls it is not missing them.
const HELMET_SETS = new Set(['hsts-missing', 'xfo-missing', 'frame-ancestors-missing', 'xcto-missing', 'referrer-policy-missing', 'coop-missing', 'corp-missing'])

export function hitsIn(rule, file, text) {
  if (rule.when && !rule.when.test(text)) return null
  if (rule.sample === 'index.html' && !rule.id.startsWith('comment-') && /<!--|\{%-?\s*(comment|doc)|\{#|\{\{!--/.test(text)) text = blank(text)
  if (rule.test || rule.re) {
    const out = []
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (rule.skipLine && rule.skipLine.test(line)) continue
      const hit = rule.test ? rule.test(line) : rule.re.test(line)
      if (hit) out.push(`${file}:${i + 1}`)
    }
    return out
  }
  if (rule.whole) return rule.whole(text, file) ? [file] : []
  if (rule.lacks) return rule.lacks.test(text) ? [] : [file]
  return []
}

// Runs one table over a folder and prints the sub-check lines and findings. Returns the exit code (0 clean, 1 findings).
export function runTable(name, root, rules, { walk = false } = {}) {
  const files = contentFiles(root)
  const paths = walk ? allPaths(root) : []
  const cache = new Map()
  const read = (f) => {
    if (!cache.has(f)) cache.set(f, readText(root, f))
    return cache.get(f)
  }
  const rows = []
  for (const r of rules) {
    if (r.path) {
      rows.push({ r, na: false, found: paths.filter((p) => r.path.test(p) && !(r.notIn && r.notIn.test(p))) })
      continue
    }
    const cands = files.filter((f) => r.files.test(f) && !(r.notIn && r.notIn.test(f)))
    if (!cands.length) {
      rows.push({ r, na: true, found: [] })
      continue
    }
    let applicable = 0
    const found = []
    for (const f of cands) {
      const hits = hitsIn(r, f, read(f))
      if (hits === null) continue
      applicable++
      found.push(...hits)
    }
    // A header that one config file sets (or helmet sets) is set: only a project where NO config file has it is missing it.
    if (r.lacks && found.length) {
      const set = cands.some((f) => { const t = read(f); return typeof t === 'string' && (r.when ? r.when.test(t) : true) && (r.lacks.test(t) || (HELMET_SETS.has(r.id) && /\bhelmet\s*\(/.test(t))) })
      if (set) found.length = 0
    }
    rows.push({ r, na: applicable === 0, found })
  }
  let total = 0
  const lines = []
  const allow = allowSet(root)
  for (const row of rows) {
    const { r, na } = row
    const found = row.found.filter((h) => !allow.has(`${r.id} ${h.replace(/:\d+$/, '')}`))
    const reason = String(r.title).replace(/[\r\n]+/g, ' ').slice(0, 120)
    if (na) console.log(`MEERKAT-SUB NA ${r.id} ${reason}`)
    else if (found.length) {
      total += found.length
      console.log(`MEERKAT-SUB FAIL ${r.id} ${found.length} found: ${reason}`)
      for (const f of found) lines.push(`${f} ${r.title}`)
    } else console.log(`MEERKAT-SUB PASS ${r.id} ${reason}`)
  }
  if (!total) {
    console.log(`${name}: nothing found`)
    return 0
  }
  console.log(`${name}: found ${total}`)
  for (const l of lines.slice(0, 25)) console.log(`  ${l}`)
  if (lines.length > 25) console.log(`  ... and ${lines.length - 25} more`)
  return 1
}

// The proof every rule carries: its bad sample is a finding, its good sample is not. Returns problems (empty = all proven).
export function selfProve(rules) {
  const problems = []
  const seen = new Set()
  for (const r of rules) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(r.id ?? '')) problems.push(`bad id "${r.id}"`)
    if (seen.has(r.id)) problems.push(`duplicate id "${r.id}"`)
    seen.add(r.id)
    if (!r.title || r.title.length < 8) problems.push(`${r.id}: missing title`)
    if (typeof r.bad !== 'string' || typeof r.good !== 'string') {
      problems.push(`${r.id}: needs bad and good samples`)
      continue
    }
    if (r.path) {
      if (!r.path.test(r.bad)) problems.push(`${r.id}: its bad sample path is not found`)
      if (r.path.test(r.good) && !(r.notIn && r.notIn.test(r.good))) problems.push(`${r.id}: its good sample path is found (false positive)`)
      continue
    }
    const file = r.sample
    if (!file || !r.files.test(file)) {
      problems.push(`${r.id}: sample "${file}" is not read by its files pattern`)
      continue
    }
    const bad = hitsIn(r, file, r.bad)
    if (!bad || bad.length === 0) problems.push(`${r.id}: its bad sample is not found`)
    const good = hitsIn(r, file, r.good)
    if (good && good.length) problems.push(`${r.id}: its good sample is found (false positive)`)
  }
  return problems
}

const FIXTURES = {
  'wh-headers': { 'nginx.conf': 'server {\n  listen 443 ssl;\n  server_tokens on;\n  ssl_protocols TLSv1 TLSv1.2;\n  add_header Content-Security-Policy "script-src \'self\' \'unsafe-inline\'";\n}\n' },
  'wh-html': { 'index.html': '<!doctype html>\n<html><body>\n<a href="/cart?sid=8f3a">Cart</a>\n<input type="password" name="pw">\n</body></html>\n' },
  'wh-publish-root': { 'dist/.git/config': '[core]\n', 'public/.env': 'SECRET=1\n' },
  'wh-supply': { 'public/jquery.min.js': '/*! jQuery v3.4.1 | (c) JS Foundation */\n', 'package.json': '{"name":"x","version":"1.0.0","dependencies":{"a":"*"}}\n' },
}

const check = (name, rules, opts) => ({
  run: (root) => runTable(name, root, rules, opts),
  fixture: () => withFixture(FIXTURES[name], (dir) => runTable(name, dir, rules, opts)),
})

// Only run the CLI when this file is the entry point, so the test can import the engine without starting it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({
    'wh-headers': check('wh-headers', HEADERS),
    'wh-html': check('wh-html', HTML),
    'wh-publish-root': check('wh-publish-root', PUBLISH, { walk: true }),
    'wh-supply': check('wh-supply', SUPPLY),
  })
}
