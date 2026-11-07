// The release gate: every pre-release check in one command. Nothing is published, tagged or pushed.
//   node tools/release/gate.mjs [--strict] [--smoke] [--skip-audit] [--range <a..b>]
//   steps, in order:
//     changelog   CHANGELOG.md has Unreleased, dated versions, newest version = package.json   (tools/release/changelog-check.mjs)
//     pack-list   the files `npm pack` would ship are inside the allow rule                    (tools/release/pack-list.mjs)
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
