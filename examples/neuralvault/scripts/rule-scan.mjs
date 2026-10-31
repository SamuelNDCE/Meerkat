// Failure-derived rule scan. Zero dependencies. Rules live in rules/*.json.
// Usage: node rule-scan.mjs [--fixtures] [--changed] [files...]
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appDirOf } from '../../../lib/paths.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = appDirOf()
const rulesDir = join(here, '..', 'rules')

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c
    else re += c
  }
  return new RegExp('^' + re + '$')
}

export function loadRules() {
  const rules = []
  const allow = []
  for (const f of readdirSync(rulesDir).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(rulesDir, f), 'utf8'))
    for (const r of j.rules ?? []) {
      if (!r.id || !r.message || !r.pattern || !r.origin) throw new Error(`rule in ${f} is missing id/message/pattern/origin`)
      rules.push({
        ...r,
        re: new RegExp(r.pattern),
        globs: r.glob.map(globToRegExp),
        excl: (r.exclude ?? []).map(globToRegExp),
        skipLine: r.skipLineIf ? new RegExp(r.skipLineIf) : null,
        stop: r.stopAt ? new RegExp(r.stopAt) : null,
      })
    }
    for (const a of j.allowlist ?? []) {
      if (!a.rule || !a.path || !a.reason) throw new Error(`allowlist entry in ${f} needs rule, path and reason`)
      allow.push(a)
    }
  }
  return { rules, allow }
}

export function scanText(rule, text) {
  const hits = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (rule.stop && rule.stop.test(line)) break
    if (rule.skipComments && /^\s*(\/\/|\*|\/\*|#)/.test(line)) continue
    if (!rule.re.test(line)) continue
    if (rule.skipLine && rule.skipLine.test(line)) continue
    hits.push({ line: i + 1, text: line.trim().slice(0, 120) })
  }
  return hits
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export function scan({ root, files, rules, allow }) {
  const found = []
  for (const rel of files) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue
    const applicable = rules.filter((r) => r.globs.some((g) => g.test(rel)) && !r.excl.some((g) => g.test(rel)))
    if (!applicable.length) continue
    const text = readFileSync(abs, 'utf8')
    for (const r of applicable) {
      const mine = allow.filter((a) => a.rule === r.id && a.path === rel)
      for (const h of scanText(r, text)) {
        if (mine.some((a) => !a.contains || h.text.includes(a.contains))) continue
        found.push({ rule: r.id, message: r.message, file: rel, ...h })
      }
    }
  }
  return found
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function main() {
  const args = process.argv.slice(2)
  const { rules, allow } = loadRules()
  let root
  let files
  if (args.includes('--fixtures')) {
    root = join(here, '..', 'fixtures', 'rule-scan')
    files = walk(root).map((p) => relative(root, p).split(sep).join('/'))
  } else {
    root = git(appDir, ['rev-parse', '--show-toplevel'])[0]
    const explicit = args.filter((a) => !a.startsWith('--'))
    if (explicit.length) files = explicit
    else if (args.includes('--changed')) {
      files = [...new Set([...git(root, ['diff', '--name-only', 'origin/dev...HEAD']), ...git(root, ['diff', '--name-only', 'HEAD'])])]
    } else files = git(root, ['ls-files'])
  }
  const found = scan({ root, files, rules, allow })
  for (const f of found) console.log(`${f.file}:${f.line} [${f.rule}] ${f.message}`)
  if (found.length) {
    console.log(`rule-scan: ${found.length} problem(s)`)
    process.exit(1)
  }
  console.log(`rule-scan: clean (${files.length} files, ${rules.length} rules)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
