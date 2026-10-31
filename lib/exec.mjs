// Run one command with a hard timeout; kills the whole process tree on timeout. Never throws.
import { spawn, spawnSync } from 'node:child_process'

function quote(a) {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a
}

// `onLine` (optional) is called with the newest non-empty line of output as it arrives, so a display can show what a check is
// doing right now. It never changes the result.
export function runCommand({ cmd, args = [], cwd, env = {}, timeoutMs = 600_000, onLine }) {
  return new Promise((resolve) => {
    const started = Date.now()
    let out = ''
    let settled = false
    let timedOut = false
    // npm, npx and tsc are .cmd shims on Windows, which only spawn through a shell.
    const direct = ['bash', 'node', 'git'].includes(cmd) || /\.exe$/i.test(cmd)
    const useShell = process.platform === 'win32' && !direct
    const opts = { cwd, env: { ...process.env, ...env }, windowsHide: true }
    const child = useShell ? spawn([cmd, ...args].map(quote).join(' '), { ...opts, shell: true }) : spawn(cmd, args, opts)
    const append = (b) => {
      const text = b.toString()
      out += text
      if (out.length > 200_000) out = out.slice(-100_000)
      if (onLine) {
        const last = text.split(/\r\n|\n|\r/).map((l) => l.trim()).filter(Boolean).pop()
        if (last) {
          try {
            onLine(last)
          } catch {
            /* a display problem never stops a check */
          }
        }
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    let timer
    const finish = (code, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, output: out + extra, ms: Date.now() - started, timedOut })
    }
    timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      else child.kill('SIGKILL')
      // Do not wait for 'close': a wedged child may never close its pipes.
      setTimeout(() => finish(124, `\ntimed out after ${Math.round(timeoutMs / 1000)}s`), 500)
    }, timeoutMs)
    child.on('error', (e) => finish(127, `\n${e.message}`))
    child.on('close', (code) => finish(code ?? 1))
  })
}

// The last non-empty line of output, trimmed: the one plain line a failure shows.
export function lastLine(text, max = 200) {
  // Tools such as cargo-audit colour their output; strip it so the "error" match below still works.
  const plain = String(text).replace(/\u001b\[[0-9;]*m/g, '')
  const lines = plain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // Prefer the last line that says it is an error (cargo prints warnings after the error line, and a window driver ends with
  // routine log lines after "VERIFICATION ERRORED"), so the one line a failure shows is the cause, not the noise after it.
  const err = [...lines].reverse().find((x) => /^(error\b|verification errored|fatal\b|failed\b)|\bError: /i.test(x))
  const l = err ?? (lines.length ? lines[lines.length - 1] : '')
  return l.length > max ? `${l.slice(0, max)}...` : l
}
