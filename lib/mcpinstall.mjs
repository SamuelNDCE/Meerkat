// `meerkat mcp install|serve|status`: register Meerkat's tool server with Claude Code (user scope) without typing the command.
// Commands run through an injectable runner, so tests never start a real claude.
import { execFileSync } from 'node:child_process'
import { MEERKAT_DIR } from './paths.mjs'
import { findBinary } from './which.mjs'

export const serverPath = () => `${MEERKAT_DIR}/bin/meerkat-mcp.mjs`
export const addArgs = () => ['mcp', 'add', '--scope', 'user', 'meerkat', '--', 'node', serverPath()]
const SPECIAL = /[&|<>^%!"\r\n]/

// The real runner: an argument array, never a shell string. A Windows .cmd or .bat shim goes through cmd.exe /c, and only
// when no argument holds a character that cmd.exe treats specially.
export function defaultRunner(cmd, args) {
  let file = cmd
  let list = args
  if (/\.(cmd|bat)$/i.test(cmd)) {
    const bad = [cmd, ...args].find((a) => SPECIAL.test(a))
    if (bad !== undefined) return { status: 2, stdout: '', stderr: `Refused to run through cmd.exe: an argument has a special character (${JSON.stringify(bad)}).` }
    file = process.env.ComSpec || 'cmd.exe'
    list = ['/c', cmd, ...args]
  }
  try {
    const stdout = execFileSync(file, list, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false, timeout: 60000 })
    return { status: 0, stdout, stderr: '' }
  } catch (e) {
    return { status: typeof e.status === 'number' ? e.status : 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message ?? '') }
  }
}

const shown = () => `claude ${addArgs().join(' ')}`
const registered = (text) => /^\s*meerkat\b/m.test(String(text ?? ''))

export function mcpInstall({ dryRun = false, runner = defaultRunner, find = findBinary, env = process.env } = {}) {
  if (dryRun) return { ok: true, code: 0, text: `Dry run. Would run:\n  ${shown()}` }
  const claude = find('claude', env)
  if (!claude) return { ok: false, code: 1, text: `Claude Code (the claude command) was not found on your PATH.\nInstall it, or run this yourself:\n  ${shown()}` }
  const list = runner(claude, ['mcp', 'list'])
  if (list.status === 0 && registered(list.stdout)) return { ok: true, code: 0, text: 'Meerkat is already registered with Claude Code. Nothing to do. Check: meerkat mcp status' }
  const r = runner(claude, addArgs())
  if (r.status !== 0) return { ok: false, code: 1, text: `Claude Code could not add Meerkat (exit ${r.status}).\n${String(r.stderr || r.stdout).trim().split('\n').slice(0, 3).join('\n')}\nYou can run it yourself:\n  ${shown()}` }
  return { ok: true, code: 0, text: 'Registered Meerkat with Claude Code (user scope). Restart Claude Code to use it.' }
}

export function mcpStatus({ runner = defaultRunner, find = findBinary, env = process.env } = {}) {
  const claude = find('claude', env)
  if (!claude) return { ok: false, code: 1, registered: false, text: 'Claude Code was not found on your PATH, so the registration cannot be checked.' }
  const list = runner(claude, ['mcp', 'list'])
  if (list.status !== 0) return { ok: false, code: 1, registered: false, text: 'Claude Code could not list its servers.' }
  const yes = registered(list.stdout)
  return { ok: yes, code: yes ? 0 : 1, registered: yes, text: yes ? 'Meerkat is registered with Claude Code.' : 'Meerkat is not registered with Claude Code. Register it: meerkat mcp install' }
}
