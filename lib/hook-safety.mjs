// What makes a git pre-push hook safe to install, and the hook block itself. Nothing here runs a check.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const START = '# >>> meerkat pre-push >>>'
export const END = '# <<< meerkat pre-push <<<'
export const blockRe = /# >>> meerkat pre-push >>>[\s\S]*?# <<< meerkat pre-push <<<\r?\n?/

export const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`

// The block FAILS CLOSED (changed in the gate-output release): if node or run.mjs is missing, or the run times out, the push is blocked
// and stderr says how to push anyway on purpose: MEERKAT_ALLOW_HOOK_FAIL=1. When that variable is set the push goes
// ahead and a line is appended to hook.log in the Meerkat log folder (MEERKAT_LOG_DIR, else ~/.meerkat/logs), so a
// bypass leaves a record. A real Meerkat failure blocks with its own exit code. The run is time-boxed with `timeout`
// when a working one exists; a timeout is also a tool fault.
export const BYPASS_VAR = 'MEERKAT_ALLOW_HOOK_FAIL'
export const prePushBlock = (runFile, args = '--preset quick --ratchet --plain') =>
  [
    START,
    `MEERKAT_RUN=${shq(runFile)}`,
    'meerkat_fault() {',
    '  echo "TOOL FAULT: $1. The push is BLOCKED because the check could not run." >&2',
    `  if [ "$${BYPASS_VAR}" = "1" ]; then`,
    '    MEERKAT_HOOKLOG="${MEERKAT_LOG_DIR:-$HOME/.meerkat/logs}"',
    '    mkdir -p "$MEERKAT_HOOKLOG" 2>/dev/null',
    `    echo "$(date '+%Y-%m-%d %H:%M:%S') pre-push fault bypassed with ${BYPASS_VAR}=1: $1" >> "$MEERKAT_HOOKLOG/hook.log" 2>/dev/null`,
    `    echo "${BYPASS_VAR}=1 is set, so the push goes ahead unchecked (logged in hook.log)." >&2`,
    '    exit 0',
    '  fi',
    `  echo "To push anyway, on purpose: ${BYPASS_VAR}=1 git push" >&2`,
    '  exit 1',
    '}',
    'if ! command -v node >/dev/null 2>&1 || [ ! -f "$MEERKAT_RUN" ]; then',
    '  meerkat_fault "meerkat not found"',
    'fi',
    'if command -v timeout >/dev/null 2>&1 && timeout 5 true >/dev/null 2>&1; then',
    `  timeout 600 node "$MEERKAT_RUN" ${args}`,
    'else',
    `  node "$MEERKAT_RUN" ${args}`,
    'fi',
    'MEERKAT_RC=$?',
    'if [ "$MEERKAT_RC" -eq 124 ]; then',
    '  meerkat_fault "meerkat timed out"',
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
  // A repository's own config can point core.hooksPath anywhere. The hook must land inside the repository or its git directory, never in a folder the project chose elsewhere.
  if (root) {
    const inside = (base) => {
      if (!base) return false
      const rel = relative(resolve(base), resolve(hookPath))
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
    }
    const common = git(target, ['rev-parse', '--git-common-dir'], env)
    if (!inside(root) && !inside(common ? resolve(target, common) : '')) why.push(`the hook path (${hookPath}) is outside the repository, set by core.hooksPath`)
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

// ---- the --gate variant, install and remove ----
// `hook install --gate` checks only what is being pushed: `meerkat gate --base <upstream>` (origin/HEAD when the branch has no upstream yet).
export const GATE_ARGS = (appDir) => `gate --app ${shq(appDir)} --base "$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo origin/HEAD)" --plain`
export const NO_EOL = '# meerkat: the hook file had no final newline before this block'

// Writes the block. A new file gets a shebang; an existing hook keeps its content and the block is appended (or replaced in place).
export function installHookFile(file, block) {
  try {
    if (!existsSync(file)) {
      writeFileSync(file, `#!/bin/sh\n${block}\n`, { mode: 0o755 })
      return { ok: true, detail: 'created' }
    }
    const text = readFileSync(file, 'utf8')
    if (blockRe.test(text)) {
      writeFileSync(file, text.replace(blockRe, () => `${block}\n`))
      return { ok: true, detail: 'replaced' }
    }
    // Remember a missing final newline inside the block, so remove can give the file back byte for byte.
    const mark = text && !text.endsWith('\n') ? `\n${block.replace(START, `${START}\n${NO_EOL}`)}` : block
    writeFileSync(file, `${text}${mark}\n`)
    return { ok: true, detail: 'appended' }
  } catch (e) {
    return { ok: false, detail: String(e?.message ?? e) }
  }
}

// Takes the block out. What was there before is restored exactly; a file that holds nothing but the shebang Meerkat wrote is deleted.
export function removeHookFile(file) {
  try {
    if (!existsSync(file)) return { ok: true, detail: 'no hook file' }
    const text = readFileSync(file, 'utf8')
    const m = blockRe.exec(text)
    if (!m) return { ok: true, detail: 'no meerkat block' }
    let rest = text.replace(blockRe, '')
    if (m[0].includes(NO_EOL) && rest.endsWith('\n')) rest = rest.slice(0, -1)
    if (!rest.replace(/^#!.*$/m, '').trim()) {
      rmSync(file)
      return { ok: true, detail: 'removed (the hook file held only the Meerkat block, so it was deleted)' }
    }
    writeFileSync(file, rest)
    return { ok: true, detail: 'removed' }
  } catch (e) {
    return { ok: false, detail: String(e?.message ?? e) }
  }
}
