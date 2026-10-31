// Performance checks that fit any project, driven by budgets in .meerkat-budgets.json under "perf". A check with no budget set is
// reported NOT RUN (exit 75) with the lines to add; it never passes quietly. Run through packs/performance, or by hand:
//   node thorough/perf.mjs <check> [--root <dir>]      node thorough/perf.mjs <check> --fixtures   (must exit 1)
// Example .meerkat-budgets.json:
//   { "perf": {
//       "sizes":   [{ "path": "dist", "maxKB": 2048 }, { "path": "target/release/app.exe", "maxMB": 40 }],
//       "startup": { "cmd": "node", "args": ["server.js"], "readyText": "listening", "maxMs": 3000, "runs": 3 },
//       "build":   { "cmd": "npm", "args": ["run", "build"], "maxSeconds": 120 },
//       "endpoints": [{ "url": "http://127.0.0.1:3000/health", "maxMs": 200, "runs": 20 }],
//       "load":    { "url": "http://127.0.0.1:3000/", "requests": 500, "concurrency": 20, "maxP95Ms": 500, "maxErrorRate": 0.01 },
//       "deps":    { "maxDirect": 80, "maxInstalledMB": 600 } } }
// The load check only targets this machine unless "allowRemote": true is set on it, so it can never hammer a live server by mistake.
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { finish, main, notRun, readBudgets, readText, sizeOf, withFixture } from './kit.mjs'

const perf = (root) => readBudgets(root)?.perf ?? {}
const need = (what, example) => notRun(`no "perf.${what}" in .meerkat-budgets.json. Add, for example: ${example}`)
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]
const isLocal = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(u)

const sizes = (root) => {
  const list = perf(root).sizes
  if (!Array.isArray(list) || !list.length) return need('sizes', '"sizes":[{"path":"dist","maxKB":2048}]')
  const f = []
  for (const s of list) {
    const p = resolve(root, s.path)
    if (!existsSync(p)) {
      f.push(`${s.path} does not exist (build it first)`)
      continue
    }
    const kb = sizeOf(p) / 1024
    const max = s.maxKB ?? (s.maxMB ?? Infinity) * 1024
    console.log(`  ${s.path}: ${(kb / 1024).toFixed(2)} MB (limit ${(max / 1024).toFixed(2)} MB)`)
    if (kb > max) f.push(`${s.path} is ${(kb / 1024).toFixed(2)} MB, over its ${(max / 1024).toFixed(2)} MB budget`)
  }
  return finish('size-budget', f, 'every output is inside its size budget')
}

// Start a command and time it until it prints readyText (or exits). Returns milliseconds; rejects on a crash or a timeout.
const timeStart = (root, cfg) =>
  new Promise((ok, bad) => {
    const t0 = Date.now()
    const child = spawn(cfg.cmd, cfg.args ?? [], { cwd: root, shell: process.platform === 'win32' && cfg.cmd !== process.execPath, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    const done = (err, ms) => {
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      err ? bad(err) : ok(ms)
    }
    const timer = setTimeout(() => done(new Error(`not ready after ${(cfg.timeoutMs ?? 60000) / 1000}s`)), cfg.timeoutMs ?? 60000)
    const feed = (b) => {
      out += b
      if (cfg.readyText && out.includes(cfg.readyText)) done(null, Date.now() - t0)
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', (e) => done(e))
    child.on('exit', (code) => (cfg.readyText ? done(new Error(`exited (${code}) before printing "${cfg.readyText}"`)) : done(code ? new Error(`exited with ${code}`) : null, Date.now() - t0)))
  })

const startup = async (root) => {
  const c = perf(root).startup
  if (!c?.cmd) return need('startup', '"startup":{"cmd":"node","args":["server.js"],"readyText":"listening","maxMs":3000}')
  const runs = []
  try {
    for (let i = 0; i < (c.runs ?? 3); i++) runs.push(await timeStart(root, c))
  } catch (e) {
    return finish('startup-time', [`the app did not start: ${e.message}`])
  }
  const med = pct(runs, 50)
  console.log(`  start times ms: ${runs.join(', ')}`)
  return finish('startup-time', med > c.maxMs ? [`median start ${med} ms is over the ${c.maxMs} ms budget`] : [], `median start ${med} ms, inside ${c.maxMs} ms`)
}

// Memory in use by a process and everything it started, in MB.
const treeMB = (pid) => {
  try {
    if (process.platform === 'win32') {
      const ps = `$p=Get-CimInstance Win32_Process;$s=@{};$s[${pid}]=$true;do{$n=0;foreach($x in $p){if($s[[int]$x.ParentProcessId] -and -not $s[[int]$x.ProcessId]){$s[[int]$x.ProcessId]=$true;$n++}}}while($n);($p|Where-Object{$s[[int]$_.ProcessId]}|Measure-Object WorkingSetSize -Sum).Sum`
      return Number(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 20000, windowsHide: true })) / 2 ** 20
    }
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number))
    const mine = new Set([pid])
    for (let grew = true; grew; ) {
      grew = false
      for (const [id, parent] of rows) if (mine.has(parent) && !mine.has(id)) (mine.add(id), (grew = true))
    }
    return rows.filter(([id]) => mine.has(id)).reduce((n, r) => n + r[2], 0) / 1024
  } catch {
    return 0
  }
}

const memory = async (root) => {
  const c = perf(root).memory
  if (!c?.cmd) return need('memory', '"memory":{"cmd":"node","args":["server.js"],"readyText":"listening","maxIdleMB":200,"maxPeakMB":400}')
  const child = spawn(c.cmd, c.args ?? [], { cwd: root, shell: process.platform === 'win32' && c.cmd !== process.execPath, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let out = ''
  let exited = false
  child.on('exit', () => (exited = true))
  child.on('error', () => (exited = true))
  const feed = (b) => (out += b)
  child.stdout.on('data', feed)
  child.stderr.on('data', feed)
  const stop = () => {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
  try {
    const t0 = Date.now()
    while (!exited && (c.readyText ? !out.includes(c.readyText) : Date.now() - t0 < 2000) && Date.now() - t0 < (c.timeoutMs ?? 60000)) await new Promise((r) => setTimeout(r, 200))
    if (exited || (c.readyText && !out.includes(c.readyText))) return finish('memory', ['the app did not reach ready, so its memory could not be measured'])
    await new Promise((r) => setTimeout(r, (c.settleSeconds ?? 3) * 1000))
    let idle = treeMB(child.pid)
    let peak = idle
    const until = Date.now() + (c.sampleSeconds ?? 8) * 1000
    while (Date.now() < until && !exited) {
      peak = Math.max(peak, treeMB(child.pid))
      await new Promise((r) => setTimeout(r, 500))
    }
    idle = Math.min(idle, peak)
    console.log(`  after settling: ${idle.toFixed(0)} MB; peak while watched: ${peak.toFixed(0)} MB (limits ${c.maxIdleMB ?? '-'} / ${c.maxPeakMB ?? '-'} MB)`)
    const f = []
    if (c.maxIdleMB && idle > c.maxIdleMB) f.push(`idle memory ${idle.toFixed(0)} MB is over ${c.maxIdleMB} MB`)
    if (c.maxPeakMB && peak > c.maxPeakMB) f.push(`peak memory ${peak.toFixed(0)} MB is over ${c.maxPeakMB} MB`)
    return finish('memory', f, 'memory is inside its budgets')
  } finally {
    stop()
  }
}

const build = async (root) => {
  const c = perf(root).build
  if (!c?.cmd) return need('build', '"build":{"cmd":"npm","args":["run","build"],"maxSeconds":120}')
  const t0 = Date.now()
  const code = await new Promise((ok) => {
    const ch = spawn(c.cmd, c.args ?? [], { cwd: root, shell: process.platform === 'win32', stdio: 'ignore', windowsHide: true })
    ch.on('error', () => ok(-1))
    ch.on('exit', (x) => ok(x ?? -1))
  })
  const s = (Date.now() - t0) / 1000
  const f = []
  if (code !== 0) f.push(`the build command failed (exit ${code})`)
  else if (s > c.maxSeconds) f.push(`build took ${s.toFixed(0)}s, over the ${c.maxSeconds}s budget`)
  return finish('build-time', f, `build took ${s.toFixed(0)}s, inside ${c.maxSeconds}s`)
}

const get = async (url) => {
  const t0 = performance.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  await res.arrayBuffer()
  return { ms: performance.now() - t0, ok: res.status < 500 }
}

const endpoints = async (root) => {
  const list = perf(root).endpoints
  if (!Array.isArray(list) || !list.length) return need('endpoints', '"endpoints":[{"url":"http://127.0.0.1:3000/health","maxMs":200}]')
  const f = []
  for (const e of list) {
    const times = []
    try {
      for (let i = 0; i < (e.runs ?? 20); i++) {
        const r = await get(e.url)
        if (!r.ok) throw new Error('server error response')
        times.push(r.ms)
      }
    } catch (err) {
      f.push(`${e.url}: ${err.cause?.code ?? err.message}`)
      continue
    }
    const p95 = pct(times, 95)
    console.log(`  ${e.url}: p50 ${pct(times, 50).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms (limit ${e.maxMs} ms)`)
    if (p95 > e.maxMs) f.push(`${e.url} p95 ${p95.toFixed(0)} ms is over ${e.maxMs} ms`)
  }
  return finish('endpoint-latency', f, 'every endpoint answers inside its budget')
}

const load = async (root) => {
  const c = perf(root).load
  if (!c?.url) return need('load', '"load":{"url":"http://127.0.0.1:3000/","requests":500,"concurrency":20,"maxP95Ms":500,"maxErrorRate":0.01}')
  if (!isLocal(c.url) && !c.allowRemote) return notRun(`load.url ${c.url} is not on this machine; set "allowRemote": true on it if you really mean to load that server`)
  const total = c.requests ?? 200
  const times = []
  let errors = 0
  let next = 0
  const worker = async () => {
    while (next++ < total) {
      try {
        const r = await get(c.url)
        times.push(r.ms)
        if (!r.ok) errors++
      } catch {
        errors++
      }
    }
  }
  const t0 = performance.now()
  await Promise.all(Array.from({ length: c.concurrency ?? 10 }, worker))
  const secs = (performance.now() - t0) / 1000
  const rate = errors / total
  const p95 = times.length ? pct(times, 95) : Infinity
  console.log(`  ${total} requests, ${(total / secs).toFixed(0)} per second, p95 ${p95.toFixed(0)} ms, ${(rate * 100).toFixed(1)}% errors`)
  const f = []
  if (rate > (c.maxErrorRate ?? 0.01)) f.push(`error rate ${(rate * 100).toFixed(1)}% is over ${((c.maxErrorRate ?? 0.01) * 100).toFixed(1)}%`)
  if (p95 > (c.maxP95Ms ?? 1000)) f.push(`p95 ${p95.toFixed(0)} ms is over ${c.maxP95Ms ?? 1000} ms`)
  return finish('load-burst', f, 'the server held up under the burst')
}

const deps = (root) => {
  const b = perf(root).deps ?? {}
  const maxDirect = b.maxDirect ?? 100
  const maxMB = b.maxInstalledMB ?? 800
  let pkg
  try {
    pkg = JSON.parse(readText(root, 'package.json'))
  } catch {
    return finish('perf-deps', [], 'not applicable: no readable package.json here (no npm dependencies)')
  }
  const direct = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length
  const f = []
  if (direct > maxDirect) f.push(`${direct} direct dependencies, over the ${maxDirect} budget`)
  const nm = join(root, 'node_modules')
  if (existsSync(nm)) {
    const mb = sizeOf(nm) / 2 ** 20
    if (mb > maxMB) f.push(`node_modules is ${mb.toFixed(0)} MB, over the ${maxMB} MB budget`)
  }
  return finish('dependency-weight', f, `${direct} direct dependencies, inside the budget`)
}

// A throwaway local server for the network fixtures.
const withServer = async (handler, fn) => {
  const srv = createServer(handler)
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}/`)
  } finally {
    srv.closeAllConnections?.()
    srv.close()
  }
}

main({
  sizes: { run: sizes, fixture: () => withFixture({ 'dist/a.bin': 'x'.repeat(4096), '.meerkat-budgets.json': JSON.stringify({ perf: { sizes: [{ path: 'dist', maxKB: 1 }] } }) }, sizes) },
  startup: { run: startup, fixture: () => withFixture({ '.meerkat-budgets.json': JSON.stringify({ perf: { startup: { cmd: process.execPath, args: ['-e', 'setTimeout(()=>{},400)'], maxMs: 20, runs: 1 } } }) }, startup) },
  memory: { run: memory, fixture: () => withFixture({ '.meerkat-budgets.json': JSON.stringify({ perf: { memory: { cmd: process.execPath, args: ['-e', "const b=Buffer.alloc(300*2**20,1);console.log('ready');setInterval(()=>b[0]++,1000)"], readyText: 'ready', settleSeconds: 1, sampleSeconds: 2, maxIdleMB: 50, maxPeakMB: 50 } } }) }, memory) },
  build: { run: build, fixture: () => withFixture({ '.meerkat-budgets.json': JSON.stringify({ perf: { build: { cmd: process.execPath, args: ['-e', 'process.exit(3)'], maxSeconds: 60 } } }) }, build) },
  endpoints: { run: endpoints, fixture: () => withServer((q, s) => setTimeout(() => s.end('ok'), 60), (url) => withFixture({ '.meerkat-budgets.json': JSON.stringify({ perf: { endpoints: [{ url, maxMs: 5, runs: 3 }] } }) }, endpoints)) },
  load: { run: load, fixture: () => withServer((q, s) => { s.statusCode = 500; s.end('x') }, (url) => withFixture({ '.meerkat-budgets.json': JSON.stringify({ perf: { load: { url, requests: 20, concurrency: 4 } } }) }, load)) },
  deps: { run: deps, fixture: () => withFixture({ 'package.json': JSON.stringify({ dependencies: { a: '1', b: '1', c: '1' } }), '.meerkat-budgets.json': JSON.stringify({ perf: { deps: { maxDirect: 1 } } }) }, deps) },
})
