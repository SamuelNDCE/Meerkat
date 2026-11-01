// npm audit for every dependency (the npm-audit-all check). A folder with no package.json has no npm dependencies, so the check does not
// apply there and passes with a note; everywhere else it is `npm audit --audit-level=high` and its exit code.
//   node thorough/npm-audit.mjs [--root <dir>]
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const i = process.argv.indexOf('--root')
const root = i > 0 ? process.argv[i + 1] : process.cwd()
if (!existsSync(join(root, 'package.json'))) {
  console.log('npm-audit-all: not applicable, there is no package.json here (no npm dependencies)')
  process.exit(0)
}
const r = spawnSync('npm', ['audit', '--audit-level=high'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
process.stdout.write(r.stdout ?? '')
process.stderr.write(r.stderr ?? '')
// An unreachable registry means nothing was checked: NOT RUN, not a failure.
if (r.status !== 0 && /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|audit endpoint returned an error|network/i.test(`${r.stdout}${r.stderr}`) && !/vulnerabilit(y|ies)/i.test(r.stdout ?? '')) {
  console.log('NOT RUN: the npm registry could not be reached; nothing was checked')
  process.exit(75)
}
process.exit(r.status ?? 1)
