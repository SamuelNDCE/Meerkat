// The release gate: every pre-release check in one command. Nothing is published, tagged or pushed.
//   node tools/release/gate.mjs [--strict] [--smoke] [--skip-audit] [--range <a..b>]
//   steps, in order:
//     changelog   CHANGELOG.md has Unreleased, dated versions, newest version = package.json   (tools/release/changelog-check.mjs)
//     pack-list   the files `npm pack` would ship are inside the allow rule                    (tools/release/pack-list.mjs)
//     counts      README, docs/checks.md, docs/coverage.md and the badges equal the checks: the three generators in --check mode (they
//                 write nothing), then tests/count-audit.test.ts -t "generated documents". Exit 1 a document drifted, 75 a generator cannot run
//     audit       npm audit --audit-level=high --omit=dev: fails on a HIGH or CRITICAL advisory in a shipped dependency; low and
//                 moderate are reported by npm but do not fail. Needs the registry: an unreachable registry is NOT RUN, never a pass
//     secrets     Meerkat's own secret scan over the tracked files                              (thorough/secret-scan.mjs)
//     fix-tests   each "fix" commit in the release range touches a test; a warning, a failure with --strict (tools/release/fix-tests.mjs)
//     smoke       with --smoke only: the tarball install test (tools/release/tarball-smoke.mjs, about 1.5 minutes)
// Exit 0 all steps passed, 1 a step failed, 75 a step could not run and none failed.
import { ROOT, first, isMain, run } from './common.mjs'

const node = (args) => run(process.execPath, args, { cwd: ROOT, timeout: 600000 })
const T = (f) => `${ROOT}/tools/release/${f}`

// Decides what an `npm audit` result means. The registry being unreachable is "not run", a non-zero exit with advisories is a failure.
export function judgeAudit({ code, stdout, stderr }) {
  const text = `${stdout}\n${stderr}`
  if (code === 0) return { status: 'pass', note: 'no high or critical advisory in the shipped dependencies' }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|audit endpoint returned an error|request to .* failed|code E(?:404|50\d)|offline/i.test(text) || code === 127) return { status: 'notrun', note: `the registry could not be reached: ${first(stderr || stdout, 200)}` }
  return { status: 'fail', note: first(stdout || stderr, 500) }
}

export const AUDIT_ARGS = ['audit', '--audit-level=high', '--omit=dev']

// The three generators run in --check mode (they write nothing), then the fast document-only count tests.
export const COUNT_GENERATORS = ['gen-checks', 'gen-coverage', 'make-badges']
export const COUNT_TEST_ARGS = ['vitest', 'run', 'tests/count-audit.test.ts', '-t', 'generated documents']

// Decides what the `counts` step's results mean. Each result is { name, code, stdout, stderr }; name is a generator or 'count-audit'.
//   0 / pass    every document is current
//   1 / fail    a document drifted (a generator exited 1 in --check mode, or a count test failed); the note names the file and the fix
//   75 / notrun a generator could not run (any other exit code, 127 included) and nothing drifted
// A drift wins over a generator that could not run, like every other step: "1 a step failed, 75 could not run and none failed".
export function judgeCounts(results) {
  const drift = results.filter((r) => r.code === 1)
  const broken = results.filter((r) => r.code !== 0 && r.code !== 1)
  const fixFor = (r) => `run node tools/${COUNT_GENERATORS.includes(r.name) ? r.name : 'gen-checks'}.mjs to fix`
  if (drift.length) {
    const lines = drift.map((r) => {
      const named = `${r.stdout}\n${r.stderr}`.split('\n').map((l) => l.trim()).filter((l) => / is out of date/.test(l))
      return `${named.length ? named.map((l) => l.replace(/;.*$/, '')).join('\n') : `${r.name} reported a difference:\n${first(`${r.stdout}\n${r.stderr}`, 400)}`}\n${fixFor(r)}`
    })
    return { status: 'fail', exit: 1, note: `\n${lines.join('\n')}` }
  }
  if (broken.length) return { status: 'notrun', exit: 75, note: broken.map((r) => `${r.name} could not run (exit ${r.code}): ${first(r.stderr || r.stdout, 200)}`).join('; ') }
  return { status: 'pass', exit: 0, note: 'README, docs/checks.md, docs/coverage.md and the badges equal the checks' }
}

function main(argv) {
  const strict = argv.includes('--strict')
  const ri = argv.indexOf('--range')
  const results = []
  const add = (name, status, note) => {
    results.push({ name, status })
    const tag = { pass: 'PASS   ', fail: 'FAIL   ', notrun: 'NOT RUN' }[status]
    console.log(`${tag} ${name}${note ? `: ${note}` : ''}`)
  }
  const fromExit = (name, r, passNote) => {
    if (r.code === 0) return add(name, 'pass', passNote ?? first(r.stdout.split('\n').filter(Boolean).pop() ?? '', 200))
    if (r.code === 75) return add(name, 'notrun', first(r.stdout, 300))
    return add(name, 'fail', `\n${first(r.stdout + r.stderr, 1200)}`)
  }
  fromExit('changelog', node([T('changelog-check.mjs')]))
  fromExit('pack-list', node([T('pack-list.mjs')]))
  {
    const results = COUNT_GENERATORS.map((name) => ({ name, ...node([`${ROOT}/tools/${name}.mjs`, '--check']) }))
    results.push({ name: 'count-audit', ...run('npx', COUNT_TEST_ARGS, { cwd: ROOT, timeout: 300000 }) })
    const c = judgeCounts(results)
    add('counts', c.status, c.note)
  }
  if (argv.includes('--skip-audit')) add('audit', 'notrun', 'skipped by --skip-audit (the release is not fully gated)')
  else {
    const a = judgeAudit(run('npm', AUDIT_ARGS, { cwd: ROOT, timeout: 180000 }))
    add('audit', a.status, a.note)
  }
  fromExit('secrets', node([`${ROOT}/thorough/secret-scan.mjs`, '--root', ROOT]))
  fromExit('fix-tests', node([T('fix-tests.mjs'), ...(strict ? ['--strict'] : []), ...(ri >= 0 ? ['--range', argv[ri + 1]] : [])]))
  if (argv.includes('--smoke')) fromExit('smoke', node([T('tarball-smoke.mjs')]))
  const failed = results.filter((r) => r.status === 'fail').length
  const notRun = results.filter((r) => r.status === 'notrun').length
  console.log(`release gate: ${results.length - failed - notRun} passed, ${failed} failed, ${notRun} not run`)
  return failed ? 1 : notRun ? 75 : 0
}
if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2))
