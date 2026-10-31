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
// Pids of every child this process started and has not yet seen end. The run sweeps them before it exits (run.mjs).
export const spawnedPids = new Set()

// Kill a process and its children. Windows: taskkill /T (with /F to force). Elsewhere the child is its own process group
// (detached), so the group gets the signal; the plain pid is the fallback.
export function killTreeOf(pid, force = true) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, timeout: 5000 })
    return
  }
  const sig = force ? 'SIGKILL' : 'SIGTERM'
  try {
    process.kill(-pid, sig)
  } catch {
    try {
      process.kill(pid, sig)
    } catch {
      /* already gone */
    }
  }
}

// Kill every process this run still has running (end-of-run sweep).
export function sweepSpawned() {
  for (const pid of [...spawnedPids]) killTreeOf(pid, true)
  spawnedPids.clear()
}

// `idleKillMs` > 0: a child with no output for that long is stopped (reason 'idle'). `onSpawn(entry)` gets a handle the runner
// uses to stop the check from outside (entry.kill(reason), entry.lastOutputAt). Every stop is gentle first and forced after 5 s.
// stdin is closed for every child, so a program that reads input gets end-of-file instead of waiting. Output past the 200 KB
// window is dropped. A child whose pipes stay open after it exits is settled 3 s after its exit.
export function runCommand({ cmd, args = [], cwd, env = {}, timeoutMs = 600_000, onLine, onProgress, extendWhileActive = false, idleMs = 30_000, idleKillMs = 0, onSpawn }) {
  return new Promise((resolve) => {
    const started = Date.now()
    let out = ''
    let settled = false
    let timedOut = false
    let killedBy = null
    let idleTimer = null
    // npm, npx and tsc are .cmd shims on Windows, which only spawn through a shell.
    const direct = ['bash', 'node', 'git'].includes(cmd) || /\.exe$/i.test(cmd)
    const useShell = process.platform === 'win32' && !direct
    const opts = { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }
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
      clearInterval(idleTimer)
      if (child.pid) spawnedPids.delete(child.pid)
      const note = timedOut ? `
timed out after ${Math.round((Date.now() - started) / 1000)} s (limit is ${Math.round(timeoutMs / 1000)} s; raise it with --timeout-scale 2 or "timeouts": {"<check>": 1800} in .meerkat-budgets.json)` : ''
      const stopNote = killedBy ? `\n[meerkat] stopped: ${killedBy}` : ''
      resolve({ code, output: out + extra + note + stopNote, killed: killedBy, ms: Date.now() - started, timedOut, subs: collector.subs, subsDropped: collector.dropped, findings: findingCollector.findings, findingsDropped: findingCollector.dropped })
    }
    // Stop the whole tree: gentle now, forced 5 s later if it is still there. The result settles on exit, or 0.5 s after the forced kill.
    const killFrom = (reason) => {
      if (settled || killedBy) return
      killedBy = reason
      killTreeOf(child.pid, false)
      setTimeout(() => killTreeOf(child.pid, true), 5000).unref?.()
      setTimeout(() => finish(137), 5500).unref?.()
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
      killTreeOf(child.pid, true)
      // Do not wait for 'close': a wedged child may never close its pipes.
      setTimeout(() => finish(124), 500)
    }
    timer = setTimeout(onTimer, timeoutMs)
    // Idle: no output for idleKillMs (a stuck check). Output of any kind, progress lines included, resets it.
    const entry = {
      pid: child.pid,
      startedAt: started,
      get lastOutputAt() {
        return lastOutputAt
      },
      kill: killFrom,
    }
    if (child.pid) spawnedPids.add(child.pid)
    if (idleKillMs > 0) idleTimer = setInterval(() => { if (Date.now() - lastOutputAt >= idleKillMs) killFrom('idle') }, Math.min(1000, idleKillMs))
    try {
      onSpawn?.(entry)
    } catch {
      /* a registry problem never stops a check */
    }
    child.on('error', (e) => finish(127, `\n${e.message}`))
    child.on('close', (code) => finish(code ?? 1))
    // Pipes held open by a grandchild would never close: settle 3 s after the child itself exits.
    child.on('exit', (code) => setTimeout(() => finish(code ?? 1), 3000).unref?.())
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
