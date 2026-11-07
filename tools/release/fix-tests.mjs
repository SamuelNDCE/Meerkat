// Regression-test gate: every commit in the release range whose subject starts with "fix" must also touch a test file. A fix with no test
// can come back unseen, so each one is listed. By default this only warns (exit 0); --strict makes it fail (exit 1).
//   node tools/release/fix-tests.mjs [--range <a..b>] [--strict] [--root <dir>]
//   default range: the newest tag up to HEAD (no tag at all: every commit). Merge commits are skipped; their parents are checked.
//   a test file: *.test.* or *.spec.* anywhere, or any file inside a tests/, test/ or __tests__/ folder
// Exit 0 clean or warnings only, 1 --strict and a fix without a test, 75 git could not answer.
import { ROOT, first, isMain, run } from './common.mjs'

export const isTestFile = (p) => /\.(test|spec)\.[^/]+$/i.test(p) || /(^|\/)(tests?|__tests__)\//i.test(p)
export const isFixSubject = (s) => /^fix/i.test(s.trim())

// commits: [{ sha, subject, files }]. Returns the fix commits that touch no test file.
export const fixesWithoutTests = (commits) => commits.filter((c) => isFixSubject(c.subject) && !c.files.some(isTestFile))

// Parses `git log --format=%x1e%H%x1f%s --name-only` output.
export function parseLog(out) {
  return out
    .split('\x1e')
    .map((rec) => rec.trim())
    .filter(Boolean)
    .map((rec) => {
      const [head, ...files] = rec.split('\n')
      const [sha, subject = ''] = head.split('\x1f')
      return { sha, subject, files: files.map((f) => f.trim()).filter(Boolean) }
    })
}

export function releaseRange(root) {
  const t = run('git', ['describe', '--tags', '--abbrev=0'], { cwd: root })
  return t.code === 0 && t.stdout.trim() ? `${t.stdout.trim()}..HEAD` : 'HEAD'
}

export function commitsIn(root, range) {
  const r = run('git', ['log', '--no-merges', '--name-only', '--format=%x1e%H%x1f%s', range], { cwd: root })
  if (r.code !== 0) return { error: `git log ${range} failed (exit ${r.code}): ${first(r.stderr)}` }
  return { commits: parseLog(r.stdout) }
}

function main(argv) {
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const root = opt('--root') ?? ROOT
  const strict = argv.includes('--strict')
  const range = opt('--range') ?? releaseRange(root)
  const { commits, error } = commitsIn(root, range)
  if (error) {
    console.log(`fix-tests: NOT RUN. ${error}`)
    return 75
  }
  const fixes = commits.filter((c) => isFixSubject(c.subject))
  const bad = fixesWithoutTests(commits)
  console.log(`fix-tests: ${commits.length} commit(s) in ${range}, ${fixes.length} start with "fix", ${bad.length} of those touch no test file`)
  for (const c of bad) console.log(`  ${strict ? 'FAIL' : 'warning'}: ${c.sha.slice(0, 9)} ${c.subject}`)
  return strict && bad.length ? 1 : 0
}
if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2))
