// Runs the real-window click-through (electron/verify-click-through.cts) as several Electron windows at once.
//
//   node click-shards.mjs   (from the app folder, or with NV_APP_DIR set)
//
// The gate walks about thirty independent targets (pages, Settings sections, named surfaces) in one window,
// one after another. Each window is a separate process with its own throwaway profile, vault and backend,
// so the targets can be split across windows: shard k of n takes every n-th target (NV_CLICKS_SHARD).
// The gate's other knobs (NV_CLICKS_CAP, NV_CLICKS_TARGET_MS, NV_CLICKS_ONLY) pass straight through.
//
// Settings, all from the environment:
//   NV_CLICKS_SHARDS  windows per cell: a number, or auto / auto:6 to size from this machine (default auto:6)
//   NV_CLICKS_JOBS    windows open at the same time across all cells (default: the shard count; also takes auto:N)
//   NV_CLICKS_CELLS   extra look-and-feel runs, separated by ";", each "theme=light,size=1024x720,motion=1".
//                     "default" is the normal look. Empty means just that one cell. The thorough tier uses this for themes and the
//                     smallest window.
//
// The Electron lock is taken once for the whole group (the machine runs one test-window job at a time);
// the windows inside the group do not take it again. Exit code: 0 only when every window passed.
import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appDirOf, importFromApp } from './lib/paths.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = appDirOf()

// A window count: a number, or "auto" / "auto:6" to size it from this machine (half the cores, 1.5 GB of free
// memory per window), never above the ceiling after the colon (default 6).
export function resolveWidth(raw, fallback, { cpus = os.cpus().length, freeBytes = os.freemem() } = {}) {
  const text = String(raw ?? '').trim()
  if (text === '') return fallback
  const auto = /^auto(?::(\d+))?$/.exec(text)
  if (auto) {
    const ceiling = auto[1] ? Number(auto[1]) : 6
    return Math.max(1, Math.min(ceiling, Math.floor(cpus / 2), Math.floor(freeBytes / (1.5 * 2 ** 30))))
  }
  const n = Number(text)
  if (!Number.isInteger(n) || n < 1) throw new Error(`a window count must be a whole number or auto, got "${text}"`)
  return n
}

export function parseCells(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return [{ label: 'default', env: {} }]
  const keys = { theme: 'NV_CLICKS_THEME', size: 'NV_CLICKS_SIZE', motion: 'NV_CLICKS_REDUCED_MOTION' }
  return text
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((cell) => {
      if (cell === 'default') return { label: 'default', env: {} }
      const env = {}
      for (const pair of cell.split(',')) {
        const [k, v] = pair.split('=').map((x) => x.trim())
        if (!keys[k] || !v) throw new Error(`NV_CLICKS_CELLS: "${pair}" in "${cell}" must be theme=, size= or motion=`)
        env[keys[k]] = v
      }
      return { label: cell.replace(/\s+/g, ''), env }
    })
}

// Pure planning step, tested without starting a window: one job per (cell, shard).
export function planJobs(cells, shards) {
  const jobs = []
  for (const cell of cells) for (let k = 1; k <= shards; k++) jobs.push({ cell, shard: k, shards })
  return jobs
}

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  else child.kill('SIGKILL')
}

function runJob(job, outDir, tag, results) {
  return new Promise((resolve) => {
    const prefix = `[${job.cell.label} ${job.shard}/${job.shards}]`
    const outFile = path.join(outDir, `${tag}-${job.cell.label.replace(/[^\w=.-]/g, '_')}-${job.shard}.json`)
    const env = {
      ...process.env,
      ...job.cell.env,
      NV_CLICKS_SHARD: `${job.shard}/${job.shards}`,
      NV_CLICKS_OUT: outFile,
      NV_ELECTRON_LOCK_HELD: '1',
    }
    const child = spawn(process.execPath, ['scripts/electron-run.mjs', 'dist-electron/verify-click-through.cjs'], { cwd: appDir, env, windowsHide: true })
    let buf = ''
    let passed = ''
    const lines = []
    const onData = (b) => {
      buf += b.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        lines.push(line)
        const m = /^(\d+)\/(\d+) checks passed/.exec(line)
        if (m) passed = line
        // Progress lines only; the findings are printed in full at the end.
        if (/^\s{2}[a-z]/.test(line) || /checks passed|VERIFICATION ERRORED|\bFAIL\b/.test(line)) process.stdout.write(`${prefix} ${line}\n`)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (e) => {
      results.push({ job, code: 127, passed, lines, note: e.message })
      resolve()
    })
    child.on('close', (code) => {
      results.push({ job, code: code ?? 1, passed, lines, outFile })
      resolve()
    })
    job.kill = () => killTree(child)
  })
}

export async function runGroup({ cells, shards, jobs: width, outDir, log = (l) => process.stdout.write(`${l}\n`) }) {
  const plan = planJobs(cells, shards)
  const results = []
  const queue = [...plan]
  const tag = `${process.pid}-${Date.now()}`
  const started = Date.now()
  const workers = Array.from({ length: Math.max(1, Math.min(width, plan.length)) }, async () => {
    while (queue.length) await runJob(queue.shift(), outDir, tag, results)
  })
  await Promise.all(workers)

  const bad = results.filter((r) => r.code !== 0)
  // Every NEW finding any window printed, once each.
  const findings = new Set()
  for (const r of results) for (const l of r.lines) if (/^\s+NEW\s/.test(l)) findings.add(l.trim())
  for (const f of findings) log(f)
  for (const r of bad) {
    const tail = r.lines.filter((l) => /FAIL|ERRORED|timed out/i.test(l)).slice(-3)
    log(`window ${r.job.cell.label} ${r.job.shard}/${r.job.shards} exited ${r.code}${tail.length ? ': ' + tail.join(' | ').trim() : ''}`)
  }
  let pressed = 0
  for (const r of results) {
    const line = r.lines.find((l) => /pressed \d+ elements/.test(l))
    const m = line && /pressed (\d+) elements/.exec(line)
    if (m) pressed += Number(m[1])
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  log(`click-through: ${plan.length} windows (${cells.length} cell(s) x ${shards} shard(s)), ${pressed} elements pressed, ${bad.length} failed, in ${secs}s`)
  return bad.length === 0 ? 0 : 1
}

async function main() {
  const shards = resolveWidth(process.env.NV_CLICKS_SHARDS, resolveWidth('auto:6', 4))
  const width = resolveWidth(process.env.NV_CLICKS_JOBS, shards)
  console.log(`click-through: ${shards} shard(s), ${width} window(s) at a time`)
  const cells = parseCells(process.env.NV_CLICKS_CELLS)
  if (process.env.NV_ELECTRON_LOCK_HELD !== '1' && process.env.NV_CLICK_SHARDS_INNER !== '1') {
    // Standalone: take the one-test-window-at-a-time lock once for the whole group, then run ourselves inside it.
    // The window lock belongs to the app's own drivers (scripts/electron-lock.mjs), so this and the drivers queue on one lock.
    const { runLocked } = await importFromApp(appDir, 'scripts/electron-lock.mjs')
    const code = await runLocked(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, NV_CLICK_SHARDS_INNER: '1' }, cwd: appDir })
    process.exit(code)
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-click-shards-'))
  let code = 1
  try {
    code = await runGroup({ cells, shards, jobs: width, outDir })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
  process.exit(code)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
