// Run one command with a hard timeout; kills the whole process tree on timeout. Never throws.
import { spawn, spawnSync } from 'node:child_process'
import { isProgressLine } from './progress-files.mjs'
import { createSubCollector, isSubLine } from './subchecks.mjs'
import { createFindingCollector, isFindingLine } from './findings.mjs'

function quote(a) {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a
}

// `onLine` (optional) is called with the newest non-empty line of output as it arrives, so a display can show what a check is
// doing right now. It never changes the result.
//
// Lines of the file-progress protocol (lib/progress-files.mjs: `MEERKAT-FILE <path>` and `MEERKAT-FILES <done>/<total>`) are taken out of the
// output: they go to `onProgress` (one raw line at a time) and never into the returned output, the saved log or `onLine`.
// Lines of the sub-check protocol (lib/subchecks.mjs: `MEERKAT-SUB <PASS|FAIL|NA> <rule-id> <reason>`), on STDOUT only, are taken out the same way
// (also across chunk boundaries) and returned as `subs` (valid, first of each id, at most 2000) and `subsDropped`; they never reach `output` or `onLine`.
// Lines of the finding protocol (lib/findings.mjs: `MEERKAT-FINDING <severity> <rule-id> <path>:<line> <message>`, stdout only) are taken out the same way
// and returned as `findings` (valid ones, at most 5000) and `findingsDropped`.
export function runCommand({ cmd, args = [], cwd, env = {}, timeoutMs = 600_000, onLine, onProgress, extendWhileActive = false, idleMs = 30_000 }) {
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
    // Per stream: `held` is the start of a line that might still turn out to be a progress line; `mid` is true while the text
    // so far is the middle of an ordinary line (so what follows is not the start of a progress line).
    const streams = { stdout: { held: '', mid: false }, stderr: { held: '', mid: false } }
    const collector = createSubCollector()
    const findingCollector = createFindingCollector()
    const couldBeProgress = (s, stream) => s.length < 1000 && (s.startsWith('MEERKAT-FILE') || 'MEERKAT-FILES '.startsWith(s) || (stream === 'stdout' && (s.startsWith('MEERKAT-SUB') || 'MEERKAT-SUB'.startsWith(s) || s.startsWith('MEERKAT-FINDING') || 'MEERKAT-FINDING'.startsWith(s))))
    const split = (s, chunk, flush = false, stream = 'stderr') => {
      const parts = (s.held + chunk).split('\n')
      const rest = parts.pop()
      const startsMid = s.mid && s.held === ''
      s.held = ''
      let plain = ''
      parts.forEach((line, i) => {
        if (!(i === 0 && startsMid) && stream === 'stdout' && isSubLine(line)) collector.add(line)
        else if (!(i === 0 && startsMid) && stream === 'stdout' && isFindingLine(line)) findingCollector.add(line)
        else if (!(i === 0 && startsMid) && isProgressLine(line)) {
          try {
            onProgress?.(line.replace(/\r$/, ''))
          } catch {
            /* a display problem never stops a check */
          }
        } else plain += `${line}\n`
      })
      const atStart = parts.length > 0 || !startsMid
      if (rest) {
        if (!flush && atStart && couldBeProgress(rest, stream)) s.held = rest
        else plain += rest
        s.mid = !s.held
      } else s.mid = false
      return plain
    }
    const feed = (stream, b, flush = false) => {
      const text = split(streams[stream], b.toString(), flush, stream)
      if (text) append(text)
    }
    let lastOutputAt = Date.now()
    const append = (text) => {
      lastOutputAt = Date.now()
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
    child.stdout?.on('data', (b) => {
      lastOutputAt = Date.now()
      feed('stdout', b)
    })
    child.stderr?.on('data', (b) => {
      lastOutputAt = Date.now()
      feed('stderr', b)
    })
    let timer
    const finish = (code, extra = '') => {
      if (settled) return
      settled = true
      for (const k of ['stdout', 'stderr']) feed(k, '', true)
      clearTimeout(timer)
      const note = timedOut ? `
timed out after ${Math.round((Date.now() - started) / 1000)} s (limit is ${Math.round(timeoutMs / 1000)} s; raise it with --timeout-scale 2 or "timeouts": {"<check>": 1800} in .meerkat-budgets.json)` : ''
      resolve({ code, output: out + extra + note, ms: Date.now() - started, timedOut, subs: collector.subs, subsDropped: collector.dropped, findings: findingCollector.findings, findingsDropped: findingCollector.dropped })
    }
    // A compile or test run that is still printing (or printing progress lines) within the last idleMs is not stuck: the limit moves
    // out a little at a time, but never past twice the limit.
    const onTimer = () => {
      const now = Date.now()
      if (extendWhileActive && now - lastOutputAt < idleMs && now - started < timeoutMs * 2) {
        timer = setTimeout(onTimer, Math.min(idleMs, timeoutMs * 2 - (now - started)))
        return
      }
      timedOut = true
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      else child.kill('SIGKILL')
      // Do not wait for 'close': a wedged child may never close its pipes.
      setTimeout(() => finish(124), 500)
    }
    timer = setTimeout(onTimer, timeoutMs)
    child.on('error', (e) => finish(127, `\n${e.message}`))
    child.on('close', (code) => finish(code ?? 1))
  })
}

// The last non-empty line of output, trimmed: the one plain line a failure shows.
export function lastLine(text, max = 200) {
  // Tools such as cargo-audit colour their output; strip it so the "error" match below still works.
  const plain = String(text).replace(/\u001b\[[0-9;]*m/g, '')
  const all = plain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // Advice a tool prints at the end ("npm audit fix --force", "Run `x`") and "... and N more" lines are not the result.
  const lines = all.filter((x) => !/^(npm audit fix|run `|to address |\.\.\. and \d+ more)/i.test(x))
  if (!lines.length) lines.push(...all)
  // Prefer the last line that says it is an error (cargo prints warnings after the error line, and a window driver ends with
  // routine log lines after "VERIFICATION ERRORED"), so the one line a failure shows is the cause, not the noise after it.
  const err = [...lines].reverse().find((x) => /^(error\b|verification errored|fatal\b|failed\b)|\bError: /i.test(x))
  const l = err ?? (lines.length ? lines[lines.length - 1] : '')
  return l.length > max ? `${l.slice(0, max)}...` : l
}
