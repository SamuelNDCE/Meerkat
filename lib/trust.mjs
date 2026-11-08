// A one-time trust step for a project's own code. A project's `extraChecks` folders and `.meerkat/checks/*.mjs` are JavaScript that runs
// inside Meerkat's process, so a repository you only cloned must not get to run it unasked.
//
// The record lives in the Meerkat data folder (trust.json, beside the logs), keyed by the project's path and holding a hash of the check
// files. A changed file changes the hash, so the question is asked again. Without a terminal (no TTY, --no-input, CI) nothing is asked and
// nothing is trusted: the project's code is left out and Meerkat says so.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { checkFilesIn } from './load-checks.mjs'
import { stripControl } from './tui/safe.mjs'

export const trustFile = (env = process.env, home = homedir()) => join(env.MEERKAT_LOG_DIR ? resolve(env.MEERKAT_LOG_DIR) : join(home, '.meerkat'), 'trust.json')

// The check files: exactly the list the loader imports (checkFilesIn, lib/load-checks.mjs), never a wider or narrower one.
export function projectCodeFiles({ projectDir, where, extraChecks = [] }) {
  const files = []
  const dirs = [...extraChecks.map((d) => resolve(where ?? projectDir ?? '.', String(d))), ...(projectDir ? [join(projectDir, '.meerkat', 'checks')] : [])]
  for (const d of dirs) for (const f of checkFilesIn(d)) files.push(join(d, f))
  return [...new Set(files)].sort()
}

function allFilesUnder(dir, out, depth = 0) {
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const n of names.sort()) {
    if (n === 'node_modules') continue
    const p = join(dir, n)
    try {
      if (statSync(p).isDirectory()) {
        if (depth < 6) allFilesUnder(p, out, depth + 1)
      } else out.push(p)
    } catch {
      /* unreadable entry: left out */
    }
  }
}

// Everything the trust hash covers: the union of (a) every file in each check folder, whatever its name or how it is reached, (b) the
// import closure of the check files (relative imports, which may leave the folder), and (c) the project's package.json.
export function trustedFiles({ projectDir, where, extraChecks = [] }) {
  const checks = projectCodeFiles({ projectDir, where, extraChecks })
  if (!checks.length) return []
  const dirs = [...extraChecks.map((d) => resolve(where ?? projectDir ?? '.', String(d))), ...(projectDir ? [join(projectDir, '.meerkat', 'checks')] : [])]
  const all = [...checks]
  for (const d of dirs) allFilesUnder(d, all)
  if (projectDir) all.push(join(projectDir, 'package.json'))
  return [...new Set(all)].sort()
}

// Relative imports a script makes (static, dynamic with a literal, require): './x', '../y/z.mjs'. Bare names (packages) are not followed.
const REL = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]*)['"]/g
const TRY = ['', '.mjs', '.js', '.cjs', '.json', '/index.mjs', '/index.js']
function resolveRel(from, spec) {
  const base = resolve(dirname(from), spec)
  for (const t of TRY) {
    const p = base + t
    try {
      if (statSync(p).isFile()) return p
    } catch {
      /* try the next spelling */
    }
  }
  return null
}

// The files a check can pull in by relative import, followed all the way (the import closure), the check files included.
export function importClosure(files) {
  const seen = new Set()
  const todo = [...files]
  while (todo.length) {
    const f = todo.pop()
    if (seen.has(f)) continue
    seen.add(f)
    let text = ''
    try {
      text = readFileSync(f, 'utf8')
    } catch {
      continue
    }
    if (!/\.(mjs|js|cjs)$/.test(f)) continue
    for (const m of text.matchAll(REL)) {
      const r = resolveRel(f, m[1])
      if (r) todo.push(r)
    }
  }
  return [...seen].sort()
}

// Trust covers the whole closure: changing a helper that a check imports changes the hash. Packages from node_modules are not covered.
export function hashFiles(files, base) {
  const h = createHash('sha256')
  for (const f of importClosure(files)) {
    h.update(relative(base, f).replace(/\\/g, '/'))
    h.update('\0')
    try {
      h.update(readFileSync(f))
    } catch {
      h.update('unreadable')
    }
    h.update('\0')
  }
  return h.digest('hex')
}

// What the prompt prints: every path and the project path with control characters removed, so a name cannot rewrite the screen.
export function promptText(files, path) {
  const list = files.map((f) => `  ${stripControl(relative(path, f).replace(/\\/g, '/') || f)}`).join('\n')
  return `This project wants to run its own code inside Meerkat (${files.length} file(s), and the files they import):\n${list}\n${stripControl(path)}`
}

function readRecords(env) {
  try {
    const j = JSON.parse(readFileSync(trustFile(env), 'utf8'))
    return j && typeof j === 'object' && j.projects && typeof j.projects === 'object' ? j : { projects: {} }
  } catch {
    return { projects: {} }
  }
}

export function isTrusted(env, projectPath, hash) {
  return readRecords(env).projects[projectPath]?.hash === hash
}

function saveTrust(env, projectPath, hash) {
  const doc = readRecords(env)
  doc.projects[projectPath] = { hash, at: new Date().toISOString() }
  const f = trustFile(env)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  writeFileSync(f, JSON.stringify(doc, null, 2))
}

const defaultAsk = async (question) => {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

// makeTrust(env, { interactive, ask, say }) -> async ({ projectDir, where, extraChecks }) => { trusted, note }
//   interactive: true/false, or undefined to mean "a terminal on stdin and stderr, and not CI"
//   ask(question) -> the typed answer; say(line) -> where the refusal is printed (stderr)
export function makeTrust(env = process.env, { interactive, ask = defaultAsk, say = (l) => process.stderr.write(`${l}\n`) } = {}) {
  return async ({ projectDir, where, extraChecks = [] }) => {
    const files = projectCodeFiles({ projectDir, where, extraChecks })
    if (!files.length) return { trusted: true, note: '' }
    // An explicit, documented choice by whoever runs Meerkat (a CI job that owns its repository): not silent, and a repository cannot set it.
    if (env.MEERKAT_TRUST_PROJECT === '1') return { trusted: true, note: '' }
    const path = resolve(projectDir ?? where ?? '.').replace(/\\/g, '/')
    const hash = hashFiles(trustedFiles({ projectDir, where, extraChecks }), path)
    if (isTrusted(env, path, hash)) return { trusted: true, note: '' }
    const can = (interactive ?? (Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY))) && !env.CI
    if (!can) {
      const note = `this project's own check code was NOT run: ${files.length} file(s) (extraChecks or .meerkat/checks) have not been trusted yet, and without a terminal Meerkat will not ask. Run meerkat once in a terminal in ${stripControl(path)} and answer the question to trust them.`
      say(`meerkat: ${note}`)
      return { trusted: false, note }
    }
    say(promptText(files, path))
    const answer = String(await ask('Trust this project and run that code? [y/N] ')).toLowerCase()
    if (answer === 'y' || answer === 'yes') {
      try {
        saveTrust(env, path, hash)
      } catch {
        /* an unwritable record only means the question is asked again next time */
      }
      return { trusted: true, note: '' }
    }
    const note = "this project's own check code was not trusted, so it was left out of this run"
    say(`meerkat: ${note}`)
    return { trusted: false, note }
  }
}

