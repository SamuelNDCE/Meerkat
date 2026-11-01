// Puts text on the clipboard with the system's own tool; false when there is none. Nothing is sent anywhere.
// Windows uses clip.exe at its System32 path (never a PATH lookup), macOS pbcopy, Linux wl-copy or xclip.
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function copyText(text, env = process.env) {
  const tools = process.platform === 'win32' ? [[join(env.SystemRoot || 'C:/Windows', 'System32', 'clip.exe'), []]] : process.platform === 'darwin' ? [['pbcopy', []]] : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']]]
  for (const [cmd, a] of tools) {
    const r = spawnSync(cmd, a, { input: text, timeout: 5000, windowsHide: true, cwd: tmpdir() })
    if (r.status === 0) return true
  }
  return false
}
