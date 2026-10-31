// Shared helpers for the zero-dependency check scripts (hygiene, perf, ai). A script is run as
//   node <script> <check> [--root <dir>] [--fixtures]
// Exit codes: 0 = clean, 1 = findings (fails the run), 75 = cannot run here (reported as NOT RUN, never as a pass).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

export const NOT_RUN = 75
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
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 2 ** 20 })
    return out.split('\0').filter(Boolean).filter((f) => existsSync(join(root, f)))
  } catch {
    const files = []
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target') continue
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
  if (findings.length > 25) console.log(`  ... and ${findings.length - 25} more`)
  return 1
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
