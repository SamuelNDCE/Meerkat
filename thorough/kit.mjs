// Shared helpers for the zero-dependency check scripts (hygiene, perf, ai). A script is run as
//   node <script> <check> [--root <dir>] [--fixtures]
// Exit codes: 0 = clean, 1 = findings (fails the run), 75 = cannot run here (reported as NOT RUN, never as a pass).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createProgressEmitter } from '../lib/progress-files.mjs'
import { formatFindingLine } from '../lib/findings.mjs'

export const NOT_RUN = 75

// What this check is looking at, for the live board (lib/progress-files.mjs). Silent unless the runner sets MEERKAT_PROGRESS.
export { createProgressEmitter }
export const progress = createProgressEmitter()
export const BUDGET_FILE = '.meerkat-budgets.json'

export function parseArgs(argv) {
  const out = { check: argv[2], root: process.cwd(), fixtures: false, rest: [] }
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--root') out.root = argv[++i]
    else if (argv[i] === '--fixtures') out.fixtures = true
    else out.rest.push(argv[i])
  }
  return out
}

// The files git tracks (so ignored build output and node_modules are never scanned); a plain walk when the folder is not a repository.
export function trackedFiles(root) {
  const list = applyMeerkatIgnore(root, listTrackedFiles(root))
  progress.total(list.length)
  return list
}

// .meerkatignore: one pattern per line at the project root (# comments and blank lines ignored). Rules, in the style of .gitignore:
//   dir/        a folder and everything under it     *.min.js   no slash: matches at any depth
//   a/b/c.txt   a slash anchors it to the root        *  inside one path part     **  across parts     ?  one character
//   !pattern    re-includes what an earlier line ignored (the last matching line wins)
export const MEERKATIGNORE_FILE = '.meerkatignore'
// Never ignorable, so a typo in .meerkatignore cannot hide the supply-chain checks.
const NEVER_IGNORED = /(^|\/)(\.meerkatignore|package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|cargo\.toml|go\.mod|go\.sum|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|gemfile\.lock|composer\.(json|lock)|licen[cs]e[^/]*|copying[^/]*)$/i

export function parseMeerkatIgnore(text) {
  const rules = []
  for (let line of String(text).split(/\r?\n/)) {
    line = line.replace(/^\uFEFF/, '').trim()
    if (!line || line.startsWith('#')) continue
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    }
    const dirOnly = line.endsWith('/')
    line = line.replace(/\/+$/, '')
    if (!line) continue
    const anchored = line.startsWith('/') || line.includes('/')
    line = line.replace(/^\/+/, '')
    let body = ''
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '*' && line[i + 1] === '*') {
        i++
        if (line[i + 1] === '/') {
          i++
          body += '(?:.*/)?'
        } else body += '.*'
      } else if (c === '*') body += '[^/]*'
      else if (c === '?') body += '[^/]'
      else body += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    rules.push({ negate, re: new RegExp((anchored ? '^' : '(?:^|/)') + body + (dirOnly ? '/' : '(?:/|$)')) })
  }
  return rules
}

export function isMeerkatIgnored(rules, file) {
  const f = file.split('\\').join('/')
  if (NEVER_IGNORED.test(f)) return false
  let ignored = false
  for (const r of rules) if (r.re.test(f)) ignored = !r.negate
  return ignored
}

export function applyMeerkatIgnore(root, list) {
  let text
  try {
    text = readFileSync(join(root, MEERKATIGNORE_FILE), 'utf8')
  } catch {
    return list
  }
  const rules = parseMeerkatIgnore(text)
  if (!rules.length) return list
  const kept = list.filter((f) => !isMeerkatIgnored(rules, f))
  if (kept.length !== list.length) process.stderr.write(`ignored ${list.length - kept.length} files by ${MEERKATIGNORE_FILE}\n`)
  return kept
}

function listTrackedFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 2 ** 20 })
    return out.split('\0').filter(Boolean).filter((f) => existsSync(join(root, f)))
  } catch {
    const files = []
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        // With no git to say what is tracked, leave out what no project commits: dependency folders, virtual environments and tool caches.
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || /^(__pycache__|\.venv|venv|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox)$/.test(e.name)) continue
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else files.push(relative(root, p).split('\\').join('/'))
      }
    }
    walk(root)
    return files
  }
}

// Folders that hold deliberately broken files for tests: the hygiene checks leave them alone.
export const isFixture = (f) => /(^|\/)(fixtures?|testdata|__fixtures__|test-fixtures)\//i.test(f)

export const readText = (root, f) => {
  progress.file(f)
  try {
    return readFileSync(join(root, f), 'utf8')
  } catch {
    return ''
  }
}

export const readBudgets = (root) => {
  try {
    return JSON.parse(readFileSync(join(root, BUDGET_FILE), 'utf8'))
  } catch {
    return null
  }
}

export const isText = (f) => /\.(m?[jt]sx?|json|md|html?|css|scss|rs|toml|ya?ml|py|go|sh|ps1|txt|svelte|vue)$/i.test(f)

// Print findings (capped) and return the exit code.
export function finish(name, findings, okNote = 'nothing found') {
  if (!findings.length) {
    console.log(`${name}: ${okNote}`)
    return 0
  }
  console.log(`${name}: found ${findings.length}`)
  for (const f of findings.slice(0, 25)) console.log(`  ${f}`)
  if (findings.length > 25) {
    console.log(`  ... and ${findings.length - 25} more`)
    // The printed list stays short, but every finding beyond it is still reported to Meerkat (the finding protocol), so none is lost from findings.json.
    const sev = ['critical', 'high', 'medium', 'low', 'info'].includes(process.env.MEERKAT_DEFAULT_SEVERITY ?? '') ? process.env.MEERKAT_DEFAULT_SEVERITY : 'medium'
    for (const f of findings.slice(25)) {
      const m = /^(\S+?):(\d+)\s+(.+)$/s.exec(String(f))
      if (m) finding(sev, '-', m[1], Number(m[2]), m[3].replace(/\s+/g, ' ').slice(0, 280))
    }
  }
  return 1
}

// Tell Meerkat about one detection (the finding protocol, lib/findings.mjs). Pure addition to the usual output: a check still prints its own
// lines and returns its own exit code. Returns the line printed, or null when an argument was not valid (nothing is printed then).
export function finding(severity, ruleId, file, line, message) {
  const text = formatFindingLine(severity, ruleId, file, line, message)
  if (text) console.log(text)
  return text
}

export function notRun(message) {
  console.log(`NOT RUN: ${message}`)
  return NOT_RUN
}

// Fixtures mode: build a throwaway folder containing one deliberate violation, run the check on it, and return the check's own exit code.
// A check that finds nothing in its fixture returns 0 here, which the self-test reports as a check that has stopped working.
export async function withFixture(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fixture-'))
  try {
    for (const [name, body] of Object.entries(files)) {
      const p = join(dir, name)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, body)
    }
    return await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const sizeOf = (p) => {
  try {
    const s = statSync(p)
    if (!s.isDirectory()) return s.size
    return readdirSync(p).reduce((n, e) => n + sizeOf(join(p, e)), 0)
  } catch {
    return 0
  }
}

export async function main(checks, argv = process.argv) {
  const a = parseArgs(argv)
  const check = checks[a.check]
  if (!check) {
    console.log(`unknown check "${a.check}". Checks here: ${Object.keys(checks).join(', ')}`)
    process.exit(2)
  }
  const code = a.fixtures ? await check.fixture() : await check.run(a.root, a.rest)
  // Let the event loop drain instead of process.exit(): on Windows an exit with open sockets can abort with a libuv assertion (exit 127).
  process.exitCode = code
  setTimeout(() => process.exit(code), 3000).unref()
}
