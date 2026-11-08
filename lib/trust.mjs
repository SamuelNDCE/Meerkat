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

export const trustFile = (env = process.env, home = homedir()) => join(env.MEERKAT_LOG_DIR ? resolve(env.MEERKAT_LOG_DIR) : join(home, '.meerkat'), 'trust.json')

const CODE = /\.(mjs|js|cjs)$/

function walk(dir, out, depth = 0) {
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const n of names.sort()) {
    if (n === 'node_modules' || n.startsWith('.git')) continue
    const p = join(dir, n)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (depth < 4) walk(p, out, depth + 1)
    } else if (CODE.test(n)) out.push(p)
  }
}

// The project's own check files: every script under each extraChecks folder and under .meerkat/checks. Sorted, absolute.
export function projectCodeFiles({ projectDir, where, extraChecks = [] }) {
  const files = []
  for (const d of extraChecks) walk(resolve(where ?? projectDir ?? '.', String(d)), files)
  if (projectDir) walk(join(projectDir, '.meerkat', 'checks'), files)
  return [...new Set(files)].sort()
}

export function hashFiles(files, base) {
  const h = createHash('sha256')
  for (const f of files) {
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
    const hash = hashFiles(files, path)
    if (isTrusted(env, path, hash)) return { trusted: true, note: '' }
    const can = (interactive ?? (Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY))) && !env.CI
    const list = files.map((f) => `  ${relative(path, f).replace(/\\/g, '/') || f}`).join('\n')
    if (!can) {
      const note = `this project's own check code was NOT run: ${files.length} file(s) (extraChecks or .meerkat/checks) have not been trusted yet, and without a terminal Meerkat will not ask. Run meerkat once in a terminal in ${path} and answer the question to trust them.`
      say(`meerkat: ${note}`)
      return { trusted: false, note }
    }
    say(`This project wants to run its own code inside Meerkat (${files.length} file(s)):\n${list}\n${path}`)
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

