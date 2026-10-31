// Run a tool over the tracked files that match a pattern, for tools that take file names and not a folder (shellcheck, hadolint).
//   node thorough/on-files.mjs --match '\.sh$' -- shellcheck [options]
// No matching file is a pass ("no files"). The tool not being installed is exit 75 (NOT RUN). Any file the tool rejects is exit 1.
import { spawnSync } from 'node:child_process'
import { trackedFiles } from './kit.mjs'

const argv = process.argv
const dash = argv.indexOf('--')
const mi = argv.indexOf('--match')
if (dash < 0 || mi < 0 || !argv[mi + 1]) {
  console.log('usage: node on-files.mjs --match <regex> [--root <dir>] -- <tool> [options]')
  process.exit(2)
}
const pattern = new RegExp(argv[mi + 1])
const ri = argv.indexOf('--root')
const root = ri >= 0 ? argv[ri + 1] : process.cwd()
const [cmd, ...opts] = argv.slice(dash + 1)
const files = trackedFiles(root).filter((f) => pattern.test(f))
if (!files.length) {
  console.log(`${cmd}: no files match ${pattern}`)
  process.exit(0)
}
let worst = 0
for (let i = 0; i < files.length; i += 50) {
  const r = spawnSync(cmd, [...opts, ...files.slice(i, i + 50)], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.error?.code === 'ENOENT') {
    console.log(`NOT RUN: ${cmd} is not installed`)
    process.exit(75)
  }
  worst = Math.max(worst, r.status ?? 1)
}
console.log(`${cmd}: ${files.length} file(s) checked`)
process.exit(worst ? 1 : 0)
