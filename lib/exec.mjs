// Run one command with a hard timeout; kills the whole process tree on timeout. Never throws.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { inprocPlan, startInproc } from './inproc.mjs'
import { installStopCleanup, killOwnChildren, killTree, registerChild, unregisterChild } from './childreg.mjs'
import { isProgressLine } from './progress-files.mjs'
import { createSubCollector, isSubLine } from './subchecks.mjs'
import { createFindingCollector, isFindingLine } from './findings.mjs'

// Quote one word for cmd.exe (the shell Node uses on Windows for .cmd shims such as npm). cmd.exe has no backslash escape: inside double
// quotes & | < > ^ are plain text and a doubled "" is a literal quote. A newline, a NUL and % (expanded even inside quotes)
// cannot be made safe, so they are refused with an error rather than passed on.
export function quote(a) {
  const s = String(a)
  // ! is passed through: ignore globs such as !node_modules/** (htmlhint) need it. It is only safe while delayed expansion is off, which
  // runCommand confirms from the registry before a shell-bound command containing ! runs (bangRefusal below).
  if (/[%\r\n\0]/.test(s)) throw new Error(`refusing to pass an argument with a character cmd.exe would act on (% or newline): ${JSON.stringify(s.slice(0, 80))}`)
  return /[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ! is safe to pass to cmd.exe only while delayed expansion is OFF. It is switched on by `cmd /v:on` or by the registry value DelayedExpansion = 1
// under HKCU or HKLM \Software\Microsoft\Command Processor. Meerkat starts a shell it does not configure, so before a shell-bound command that
// contains ! runs, the two registry values are read (reg.exe, 3 s limit each). A value of 1 refuses the command; a read that fails, times out or
// cannot be understood refuses it too (fail closed). An absent value is the normal case (off). Other platforms: always allowed.
export const REG_KEYS = ['HKCU\\Software\\Microsoft\\Command Processor', 'HKLM\\Software\\Microsoft\\Command Processor']
export const REG_TIMEOUT_MS = 3000

// Reads one value with reg.exe. Returns { ok: true, value: string | null } (null = the value is not set) or { ok: false, why }.
export function readDelayedExpansionValue(key, { run = spawnSync } = {}) {
  const r = run('reg', ['query', key, '/v', 'DelayedExpansion'], { encoding: 'utf8', timeout: REG_TIMEOUT_MS, windowsHide: true })
  if (r.error) return { ok: false, why: r.error.code === 'ETIMEDOUT' ? `reading ${key} timed out after ${REG_TIMEOUT_MS / 1000} s` : `reading ${key} failed: ${r.error.message}` }
  if (r.signal || r.status === null) return { ok: false, why: `reading ${key} was stopped` }
  if (r.status === 0) {
    const m = /DelayedExpansion\s+REG_\w+\s+(\S+)/i.exec(String(r.stdout ?? ''))
    return m ? { ok: true, value: m[1] } : { ok: false, why: `${key} gave output that was not understood` }
  }
  // reg.exe exits 1 when the key or the value does not exist (the usual case) and prints nothing on stdout.
  return r.status === 1 && !String(r.stdout ?? '').trim() ? { ok: true, value: null } : { ok: false, why: `reading ${key} exited with code ${r.status}` }
}

// null when a shell-bound command with these words may run; otherwise the message that says why it is refused.
export function bangRefusal(words, { platform = process.platform, readRegistry = readDelayedExpansionValue } = {}) {
  if (platform !== 'win32' || !words.some((w) => String(w).includes('!'))) return null
  for (const key of REG_KEYS) {
    let r
    try {
      r = readRegistry(key)
    } catch (e) {
      r = { ok: false, why: `reading ${key} threw: ${String(e?.message ?? e)}` }
    }
    if (!r?.ok) return `refusing to pass an argument with ! to cmd.exe: could not confirm that delayed expansion is off (${r?.why ?? 'unknown error'}). Remove the ! or run the command without a shell.`
    if (r.value !== null && /^(0x0*1|1)$/i.test(String(r.value).trim())) return `refusing to pass an argument with ! to cmd.exe: delayed expansion is switched on (${key}, DelayedExpansion = 1), so cmd.exe would expand !NAME! inside it. Set the value to 0 or remove the !.`
  }
  return null
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
  killTree(pid, force) // lib/childreg.mjs: the one tree-kill
}

// Stop a child: a process tree, or the worker thread a check is running in.
function stopChild(child, force) {
  if (child.inproc) child.terminate()
  else killTreeOf(child.pid, force)
}

// Kill every process this run still has running (end-of-run sweep).
export function sweepSpawned() {
  for (const pid of [...spawnedPids]) killTreeOf(pid, true)
  spawnedPids.clear()
  killOwnChildren()
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
    let line = null
    if (useShell) {
      const refused = bangRefusal([cmd, ...args])
      if (refused) return resolve({ code: 127, output: `
${refused}`, killed: null, ms: 0, timedOut: false, subs: [], subsDropped: 0, findings: [], findingsDropped: 0 })
      try {
        line = [cmd, ...args].map(quote).join(' ')
      } catch (e) {
        // runCommand never throws: a refused argument is a failed run that says why.
        return resolve({ code: 127, output: `\n${e.message}`, killed: null, ms: 0, timedOut: false, subs: [], subsDropped: 0, findings: [], findingsDropped: 0 })
      }
    }
    // MEERKAT_SPAWN_LOG=<file>: one line per child process started, so a run's process count can be measured (a counter only, it changes nothing).
    if (process.env.MEERKAT_SPAWN_LOG && !inprocPlan(cmd, args, cwd)) {
      try {
        appendFileSync(process.env.MEERKAT_SPAWN_LOG, `${Date.now()}	${[cmd, ...args].join(' ').slice(0, 300)}
`)
      } catch {
        /* a counter problem never stops a check */
      }
    }
    // A plain thorough/*.mjs check runs in a worker thread (lib/inproc.mjs) instead of a process of its own; it looks like a child process from here on.
    const plan = useShell ? null : inprocPlan(cmd, args, cwd)
    if (plan && process.env.MEERKAT_SPAWN_LOG) {
      try {
        appendFileSync(process.env.MEERKAT_SPAWN_LOG, `${Date.now()}	INPROC ${[cmd, ...args].join(' ').slice(0, 300)}
`)
      } catch {
        /* a counter problem never stops a check */
      }
    }
    const child = plan ? startInproc(plan, opts.env) : useShell ? spawn(line, { ...opts, shell: true }) : spawn(cmd, args, opts)
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
      if (out.length > 4_000_000) out = out.slice(-2_000_000)
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
      if (child.pid) {
        spawnedPids.delete(child.pid)
        unregisterChild(child.pid)
      }
      const note = timedOut ? `
timed out after ${Math.round((Date.now() - started) / 1000)} s (limit is ${Math.round(timeoutMs / 1000)} s; raise it with --timeout-scale 2 or "timeouts": {"<check>": 1800} in .meerkat-budgets.json)` : ''
      const stopNote = killedBy ? `\n[meerkat] stopped: ${killedBy}` : ''
      resolve({ code, output: out + extra + note + stopNote, killed: killedBy, ms: Date.now() - started, timedOut, subs: collector.subs, subsDropped: collector.dropped, findings: findingCollector.findings, findingsDropped: findingCollector.dropped })
    }
    // Stop the whole tree: gentle now, forced 5 s later if it is still there. The result settles on exit, or 0.5 s after the forced kill.
    const killFrom = (reason) => {
      if (settled || killedBy) return
      killedBy = reason
      stopChild(child, false)
      setTimeout(() => stopChild(child, true), 5000).unref?.()
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
      stopChild(child, true)
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
    if (child.pid && !plan) {
      installStopCleanup()
      registerChild(child.pid, [cmd, ...args].join(' '), { env: process.env })
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
