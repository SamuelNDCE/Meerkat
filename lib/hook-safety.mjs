// What makes a git pre-push hook safe to install, and the hook block itself. Nothing here runs a check.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export const START = '# >>> meerkat pre-push >>>'
export const END = '# <<< meerkat pre-push <<<'
export const blockRe = /# >>> meerkat pre-push >>>[\s\S]*?# <<< meerkat pre-push <<<\r?\n?/

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`

// The block is tool-fault safe: if node or run.mjs is missing it says so on stderr and lets the push go
// (exit 0), so a broken Meerkat never blocks a push. A real Meerkat failure still blocks with its own exit
// code. It is time-boxed with `timeout` when a working one exists; a timeout is also a tool fault.
export const prePushBlock = (runFile, args = '--preset quick --ratchet --plain') =>
  [
    START,
    `MEERKAT_RUN=${shq(runFile)}`,
    'if ! command -v node >/dev/null 2>&1 || [ ! -f "$MEERKAT_RUN" ]; then',
    '  echo "TOOL FAULT: meerkat not found, push not checked" >&2',
    '  exit 0',
    'fi',
    'if command -v timeout >/dev/null 2>&1 && timeout 5 true >/dev/null 2>&1; then',
    `  timeout 600 node "$MEERKAT_RUN" ${args}`,
    'else',
    `  node "$MEERKAT_RUN" ${args}`,
    'fi',
    'MEERKAT_RC=$?',
    'if [ "$MEERKAT_RC" -eq 124 ]; then',
    '  echo "TOOL FAULT: meerkat timed out, push not checked" >&2',
    '  exit 0',
    'fi',
    'if [ "$MEERKAT_RC" -ne 0 ]; then exit "$MEERKAT_RC"; fi',
    END,
  ].join('\n')

const git = (target, args, env) => {
  try {
    return execFileSync('git', ['-C', target, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const SH_SHEBANG = /^#!\s*(\/usr)?\/bin\/(env\s+)?(ba|da|a|k)?sh(\s|$)/
const STOPS = /^(exit|exec)(\s|$)/

// Why installing here would be unsafe. An empty list means it is safe.
export function hookRefusals(target, hookPath, env = process.env) {
  const why = []
  if (git(target, ['config', '--global', '--get', 'core.hooksPath'], env)) why.push("a global core.hooksPath is set, so git does not use this repository's hooks folder")
  const root = git(target, ['rev-parse', '--show-toplevel'], env)
  const local = git(target, ['config', '--local', '--get', 'core.hooksPath'], env)
  if (local && root) {
    const rel = relative(root, resolve(target, local))
    if (rel && !rel.startsWith('..')) why.push(`core.hooksPath points into the repository (${local}), a tracked hooks folder such as husky`)
  }
  if (root && existsSync(resolve(root, '.husky'))) why.push('the repository has a .husky folder (tracked hooks)')
  if (root) {
    const rel = relative(root, resolve(hookPath, '..')).split(sep).join('/')
    if (rel && !rel.startsWith('..') && !rel.startsWith('.git') && git(target, ['ls-files', '--', rel])) why.push(`the hooks folder (${rel}) is tracked by git`)
  }
  if (existsSync(hookPath)) {
    const lines = readFileSync(hookPath, 'utf8').replace(blockRe, '').split(/\r?\n/)
    if (lines[0].startsWith('#!') && !SH_SHEBANG.test(lines[0])) why.push(`the hook has a non-sh shebang (${lines[0]})`)
    const stop = lines.find((l) => STOPS.test(l))
    const last = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).pop()
    const hit = stop ?? (last && STOPS.test(last) ? last : null)
    if (hit) why.push(`the hook has an "${hit.trim()}" that would stop the Meerkat block from running`)
  }
  return why
}

export function hookStatus(hookPath) {
  if (!existsSync(hookPath)) return { exists: false, installed: false }
  return { exists: true, installed: blockRe.test(readFileSync(hookPath, 'utf8')) }
}
