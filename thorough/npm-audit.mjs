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
process.exit(r.status ?? 1)
