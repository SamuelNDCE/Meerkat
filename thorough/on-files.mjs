// Run a tool over the tracked files that match a pattern, for tools that take file names and not a folder (shellcheck, hadolint).
//   node thorough/on-files.mjs --match '\.sh$' -- shellcheck [options]
// No matching file is a pass ("no files"). The tool not being installed is exit 75 (NOT RUN). Any file the tool rejects is exit 1.
import { spawnSync } from 'node:child_process'
import { trackedFiles } from './kit.mjs'
import { findBinary } from '../lib/which.mjs'

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
// No shell: the tool's real program is found first. A Windows .cmd or .bat shim cannot be started without one, so for those a file name
// that cmd.exe would read as something other than a name is refused, and every name is passed with ./ so it can never look like an option.
const resolved = findBinary(cmd) ?? cmd
const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)
const unsafe = needsShell ? files.filter((f) => /[\s&|<>^%()"!`,;=]/.test(f)) : []
if (unsafe.length) {
  console.log(`${cmd}: refusing to start it through cmd.exe with these file names: ${unsafe.slice(0, 3).join(', ')}. Rename them.`)
  process.exit(1)
}
const named = files.map((f) => (/^([A-Za-z]:)?[\/]/.test(f) ? f : `./${f}`))
let worst = 0
for (let i = 0; i < named.length; i += 50) {
  const r = spawnSync(resolved, [...opts, ...named.slice(i, i + 50)], { cwd: root, stdio: 'inherit', shell: needsShell })
  if (r.error?.code === 'ENOENT') {
    console.log(`NOT RUN: ${cmd} is not installed`)
    process.exit(75)
  }
  worst = Math.max(worst, r.status ?? 1)
}
console.log(`${cmd}: ${files.length} file(s) checked`)
process.exit(worst ? 1 : 0)
