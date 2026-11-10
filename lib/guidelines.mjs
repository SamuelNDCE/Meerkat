// The AI working guidelines: the rules an assistant coding in a project is held to, each checked from git alone (read-only).
// Advisory: a finding here is printed and recorded by `meerkat guide` and never changes the exit code of any other command.
// To add a guideline: add one object to GUIDELINES below and one fixture test in tests/guidelines.test.ts (see docs/guide-expert.md).
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { redact } from '../thorough/redact.mjs'
import { latestRunDirForFolder } from './runlog.mjs'

export const MAX_FILES = 15
export const MAX_LINES = 800
const MAX_TEXT_BYTES = 1_000_000

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(tests?|__tests__)\/|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/
const CODE_FILE = /\.(mjs|cjs|js|jsx|ts|tsx|py|rs|go|java|kt|rb|php|cs|c|cc|cpp|h|hpp|swift|dart|svelte|vue)$/
const SOURCE_DIR = /^(lib|src)\//
const DOC_FILE = /^(docs\/.+|README[^/]*\.md|CHANGELOG\.md|[^/]+\.md)$/i
// Built from pieces so this source file does not contain the pattern it looks for.
const HOME_PATH = new RegExp(String.raw`(?:\b[A-Za-z]:\\+${'Users'}\\+|(?:^|[\s"'\`=(:])/${'home'}/)[A-Za-z0-9._-]+`)

const git = (cwd, args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}

// A text file (no NUL in its first bytes, not huge). Returns its text or null.
export function textOf(path) {
  try {
    if (statSync(path).size > MAX_TEXT_BYTES) return null
    const buf = readFileSync(path)
    if (buf.subarray(0, 8000).includes(0)) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}

const pass = (detail = '') => ({ status: 'PASS', detail })
const advise = (detail) => ({ status: 'ADVISORY', detail })
const skip = (detail) => ({ status: 'NOT CHECKED', detail })
const list = (xs, n = 3) => `${xs.slice(0, n).join(', ')}${xs.length > n ? `, and ${xs.length - n} more` : ''}`

export const GUIDELINES = [
  {
    id: 'g-small-change',
    rule: `Keep one change small: at most ${MAX_FILES} files and ${MAX_LINES} changed lines.`,
    why: 'Small changes are reviewed properly and are easy to undo; big ones hide mistakes.',
    how: 'Counts the files in git diff --name-only and the added plus deleted lines in git diff --numstat, against the merge base.',
    fix: 'Split it: commit the part that stands alone first, then do the rest as a second change.',
    run: (c) => {
      if (!c.files.length) return skip('no changed files')
      return c.files.length > MAX_FILES || c.lines > MAX_LINES
        ? advise(`${c.files.length} files and ${c.lines} lines changed (limit ${MAX_FILES} files, ${MAX_LINES} lines)`)
        : pass(`${c.files.length} files, ${c.lines} lines`)
    },
  },
  {
    id: 'g-tests-with-code',
    rule: 'When you change code in lib/ or src/, add or update a test in the same change.',
    why: 'A change with no test cannot show it works, and the next change can break it unnoticed.',
    how: 'Looks for changed code files under lib/ or src/ and for any changed test file (*.test.*, *.spec.*, a tests/ folder).',
    fix: 'Add or update a test that fails without your change, then run it.',
    run: (c) => {
      const code = c.files.filter((f) => SOURCE_DIR.test(f) && CODE_FILE.test(f) && !TEST_FILE.test(f))
      if (!code.length) return skip('no code changed under lib/ or src/')
      return c.files.some((f) => TEST_FILE.test(f)) ? pass('a test file changed') : advise(`code changed (${list(code)}) and no test file changed`)
    },
  },
  {
    id: 'g-no-secrets',
    rule: 'Never put a token, key or private key in a file.',
    why: 'Anything committed stays in history and can be read by anyone with the repository.',
    how: 'Runs Meerkat\'s existing secret patterns (thorough/redact.mjs) over the text of each changed file.',
    fix: 'Remove the value, load it from an environment variable, and rotate it: it is already exposed.',
    run: (c) => {
      const hits = []
      let scanned = 0
      for (const f of c.files) {
        const text = c.read(f)
        if (text === null) continue
        scanned++
        const r = redact(text)
        if (!r.long && r.hard > 0) hits.push(f)
      }
      if (!scanned) return skip('no changed text files')
      return hits.length ? advise(`secret-shaped value in ${list(hits)}`) : pass(`${scanned} files scanned`)
    },
  },
  {
    id: 'g-no-machine-paths',
    rule: 'Never write an absolute home-folder path (a Windows user folder or a Linux home folder) into a file.',
    why: 'It works only on one computer and leaks the account name.',
    how: 'Looks for a drive-letter Users path or a /home/ path in the text of each changed file.',
    fix: 'Use a path relative to the project, or read it from an environment variable.',
    run: (c) => {
      const hits = []
      let scanned = 0
      for (const f of c.files) {
        const text = c.read(f)
        if (text === null) continue
        scanned++
        if (HOME_PATH.test(text)) hits.push(f)
      }
      if (!scanned) return skip('no changed text files')
      return hits.length ? advise(`home-folder path in ${list(hits)}`) : pass(`${scanned} files scanned`)
    },
  },
  {
    id: 'g-commit-message',
    rule: 'Write a commit message that says what changed: more than one word, and not "wip" or "fix stuff".',
    why: 'The history is how everyone, including the next assistant, learns why a change was made.',
    how: 'Reads the latest commit message with git log -1 when the branch has commits of its own.',
    fix: 'Reword it: git commit --amend -m "what changed and why" (only if it is not pushed yet).',
    run: (c) => {
      if (!c.committed) return skip('no commit of its own on this branch yet')
      const subject = String(c.subject ?? '').trim()
      if (!subject) return advise('the latest commit message is empty')
      if (!/\s/.test(subject)) return advise(`the latest commit message is one word ("${subject.slice(0, 40)}")`)
      if (/^(wip\b|fix stuff)/i.test(subject)) return advise(`the latest commit message starts with "${subject.split(/\s+/).slice(0, 2).join(' ')}"`)
      return pass('latest commit message is descriptive')
    },
  },
  {
    id: 'g-verify-before-done',
    rule: 'Run meerkat verdict (or gate) after your last edit and before you say the work is done.',
    why: 'A check that ran before your last edit says nothing about the code as it is now.',
    how: 'Compares the newest run in the Meerkat run log folder for this project with the newest modification time of the changed files.',
    fix: 'Run: meerkat verdict   (then read its first line).',
    run: (c) => {
      if (!c.files.length) return skip('no changed files')
      let newest = 0
      for (const f of c.files) {
        try {
          newest = Math.max(newest, statSync(join(c.repo, f)).mtimeMs)
        } catch {
          /* a deleted file has no time */
        }
      }
      if (!newest) return skip('changed files have no modification time')
      const dir = c.lastRunDir
      if (!dir) return advise('no verdict or gate run is recorded for this project')
      let at = 0
      try {
        at = statSync(dir).mtimeMs
      } catch {
        /* handled below */
      }
      return at >= newest ? pass('a run was recorded after the last edit') : advise('the newest recorded run is older than the last edit')
    },
  },
  {
    id: 'g-no-generated-edits',
    rule: 'Do not edit a generated file by hand: change its generator and regenerate it.',
    why: 'The next regeneration overwrites a hand edit, so the fix silently disappears.',
    how: 'Finds changed files that say "generated by" in their first 3 lines and checks that the generator they name changed too.',
    fix: 'Revert the hand edit, change the generator, and run it again.',
    run: (c) => {
      const gen = []
      for (const f of c.files) {
        const text = c.read(f)
        if (text === null) continue
        const head = text.split(/\r?\n/, 3).join('\n')
        const m = head.match(/generated by[:\s]+([^\s'"`<>()]+)/i)
        if (m || /generated by/i.test(head)) gen.push({ f, generator: m ? m[1].replace(/[.,;:]+$/, '') : '' })
      }
      if (!gen.length) return skip('no changed file says it is generated')
      const bad = gen.filter((g) => !(g.generator && c.files.some((f) => f === g.generator || f.endsWith(`/${g.generator}`) || g.generator.endsWith(f))))
      return bad.length ? advise(`generated file changed without its generator: ${list(bad.map((b) => b.f))}`) : pass('the generator changed too')
    },
  },
  {
    id: 'g-docs-with-behaviour',
    rule: 'When you change a command or a flag, update the docs in the same change.',
    why: 'Docs that disagree with the program mislead the next person and the next assistant.',
    how: 'Flags a changed lib/cli.mjs, or a changed flag that README.md or docs/ mention, when no docs file changed.',
    fix: 'Update the README or the page under docs/ that describes it.',
    run: (c) => {
      const docsChanged = c.files.some((f) => DOC_FILE.test(f))
      const cli = c.files.includes('lib/cli.mjs')
      const flags = (c.codeFlags ?? []).filter((fl) => c.docText.includes(fl))
      if (!cli && !flags.length) return skip('no command or documented flag changed')
      if (docsChanged) return pass('a docs file changed too')
      return advise(cli ? 'lib/cli.mjs changed and no docs file changed' : `documented flag changed (${list(flags)}) and no docs file changed`)
    },
  },
]

export const byId = (id) => GUIDELINES.find((g) => g.id === id) ?? null

// Reads the facts every guideline needs, once. Never writes.
export function gatherContext(repo, { files, base = null, env = process.env, folder = repo } = {}) {
  const mb = base?.mb ?? null
  const numstat = mb ? git(repo, ['diff', '--numstat', mb]) : git(repo, ['diff', '--numstat', 'HEAD'])
  let lines = 0
  for (const row of (numstat ?? '').split('\n')) {
    const [a, d] = row.split('\t')
    lines += (Number(a) || 0) + (Number(d) || 0)
  }
  const head = git(repo, ['rev-parse', 'HEAD'])?.trim()
  const committed = Boolean(head && mb && head !== mb)
  const subject = committed ? (git(repo, ['log', '-1', '--format=%B'])?.trim().split('\n')[0] ?? '') : ''
  const cache = new Map()
  const read = (f) => {
    if (!cache.has(f)) cache.set(f, textOf(join(repo, f)))
    return cache.get(f)
  }
  // Long options added or removed in changed code files, to compare with what the docs mention.
  const codeFiles = files.filter((f) => /\.(mjs|cjs|js|ts)$/.test(f) && !TEST_FILE.test(f))
  const flags = new Set()
  if (codeFiles.length) {
    const d = git(repo, ['diff', '-U0', mb ?? 'HEAD', '--', ...codeFiles]) ?? ''
    for (const row of d.split('\n')) if (/^[+-][^+-]/.test(row)) for (const m of row.matchAll(/['"`](--[a-z][a-z0-9-]{2,})['"`]/g)) flags.add(m[1])
  }
  let docText = ''
  for (const f of ['README.md', ...(git(repo, ['ls-files', 'docs'])?.split('\n').filter((x) => x.endsWith('.md')) ?? [])]) docText += `\n${textOf(join(repo, f)) ?? ''}`
  let lastRunDir = null
  try {
    lastRunDir = latestRunDirForFolder(env, folder)
  } catch {
    /* no run log */
  }
  return { repo, files, lines, committed, subject, read, codeFlags: [...flags], docText, lastRunDir }
}

// Runs every guideline (except the disabled ones) on a context. Returns [{ id, status, detail, fix }].
export function evaluate(ctx, { disable = [] } = {}) {
  return GUIDELINES.map((g) => {
    if (disable.includes(g.id)) return { id: g.id, status: 'NOT CHECKED', detail: 'turned off in meerkat.config.json (guidelines.disable)', fix: g.fix }
    let r
    try {
      r = g.run(ctx)
    } catch (e) {
      r = skip(`could not be checked (${String(e?.message ?? e).split('\n')[0].slice(0, 80)})`)
    }
    return { id: g.id, ...r, fix: g.fix }
  })
}

// The list of ids a project turned off: meerkat.config.json { "guidelines": { "disable": ["g-..."] } }. Anything else is ignored.
export function disabledIn(repo) {
  try {
    const j = JSON.parse(readFileSync(join(repo, 'meerkat.config.json'), 'utf8'))
    const d = j?.guidelines?.disable
    return Array.isArray(d) ? d.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
