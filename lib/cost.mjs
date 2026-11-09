// Token cost of Meerkat's own output. Every command run through bin/meerkat.mjs is measured (characters and bytes written to
// stdout and stderr, wall time) and one JSON line is appended to cost.jsonl in the Meerkat home folder (or MEERKAT_LOG_DIR).
// `meerkat cost [--last <n>] [--json]` reads that log back. The token count is an ESTIMATE: characters / 4, rounded up.
//
// Only the command word is stored (never the arguments), so a reason, a path or a token typed on the command line never reaches the log.
// A command that hands the terminal to a child process (a verify run, `meerkat test`) writes its output straight to the terminal, where
// this meter cannot see it: such a row is marked partial and `cost` prints it as "at least", never as an exact figure.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const COST_FILE = 'cost.jsonl'
export const ROTATE_AT = 2 * 1024 * 1024 // past this the log moves to cost.jsonl.1 (one generation) and a new one starts
export const estTokens = (chars) => Math.ceil(Math.max(0, chars) / 4)
export const costDir = (env = process.env, home = homedir()) => (env.MEERKAT_LOG_DIR ? resolve(env.MEERKAT_LOG_DIR) : join(home, '.meerkat'))
export const costPath = (env = process.env, home) => join(costDir(env, home), COST_FILE)

let partial = false
// Called by code that gives the terminal to a child process, so the row says the figure is a lower bound.
export function markPartial() {
  partial = true
}

// Starts measuring. Returns { finish(code) }: finish appends the row. It is also hooked to process exit, so every exit path records once.
export function startCostMeter(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr, hookExit = true } = {}) {
  const t0 = process.hrtime.bigint()
  let chars = 0
  let bytes = 0
  const wrap = (stream) => {
    const orig = stream.write
    stream.write = function (chunk, ...rest) {
      if (typeof chunk === 'string') {
        chars += chunk.length
        bytes += Buffer.byteLength(chunk)
      } else if (chunk && typeof chunk.length === 'number') {
        chars += chunk.length
        bytes += chunk.length
      }
      return orig.call(this, chunk, ...rest)
    }
    return () => {
      stream.write = orig
    }
  }
  const unwraps = [wrap(stdout), wrap(stderr)]
  let done = false
  const finish = (code = 0, { home } = {}) => {
    if (done) return null
    done = true
    for (const u of unwraps) u()
    const word = String(argv.find((a) => !a.startsWith('-')) ?? '(menu)').slice(0, 40)
    const row = { v: 1, at: new Date().toISOString(), cmd: word, bytes, chars, tokens: estTokens(chars), ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6), exit: code ?? 0, ...(partial ? { partial: true } : {}) }
    return appendRow(row, env, home)
  }
  if (hookExit) process.on('exit', (c) => finish(c))
  return { finish }
}

// One line, one appendFileSync: O_APPEND makes a line this short land whole even when two commands finish together.
export function appendRow(row, env = process.env, home) {
  const file = costPath(env, home)
  const line = `${JSON.stringify(row)}\n`
  try {
    try {
      appendFileSync(file, line)
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e
      mkdirSync(costDir(env, home), { recursive: true, mode: 0o700 })
      appendFileSync(file, line)
    }
    rotateIfBig(file)
    return { ok: true, file }
  } catch (e) {
    process.stderr.write(`meerkat: could not record this command's cost in ${file} (${e?.code ?? 'error'}); the command itself is unaffected\n`)
    return { ok: false, file }
  }
}

function rotateIfBig(file) {
  try {
    if (statSync(file).size > ROTATE_AT) renameSync(file, `${file}.1`)
  } catch {
    /* a rotation that fails leaves the log growing; the next row tries again */
  }
}

// { rows, skipped }: every parseable row, oldest first; a line that is not a cost row is counted, never dropped silently, never deleted.
export function readCost(env = process.env, home) {
  const file = costPath(env, home)
  if (!existsSync(file)) return { file, rows: [], skipped: 0, missing: true }
  const rows = []
  let skipped = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && typeof r === 'object' && typeof r.cmd === 'string' && Number.isFinite(r.bytes) && Number.isFinite(r.tokens) && Number.isFinite(r.ms)) rows.push(r)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { file, rows, skipped }
}

const fmtBytes = (n) => String(n)
const secs = (ms) => (ms / 1000).toFixed(2)

// `meerkat cost [--last <n>] [--json]`. Returns { ok, code, text }.
export function costCommand(args, { env = process.env, home } = {}) {
  let last = 20
  const i = args.indexOf('--last')
  if (i !== -1) {
    const v = args[i + 1]
    if (!/^\d+$/.test(String(v ?? '')) || Number(v) < 1) return { ok: false, code: 2, text: 'usage: meerkat cost [--last <n>] [--json]   (n is a whole number, 1 or more)' }
    last = Number(v)
  }
  const unknown = args.filter((a, k) => a.startsWith('-') && a !== '--last' && a !== '--json' && args[k - 1] !== '--last')
  if (unknown.length) return { ok: false, code: 2, text: `meerkat cost: unknown option ${unknown[0]}. usage: meerkat cost [--last <n>] [--json]` }
  const { file, rows, skipped, missing } = readCost(env, home)
  const shown = rows.slice(-last)
  const total = shown.reduce((a, r) => ({ bytes: a.bytes + r.bytes, tokens: a.tokens + r.tokens, ms: a.ms + r.ms }), { bytes: 0, tokens: 0, ms: 0 })
  const partialAny = shown.some((r) => r.partial)
  if (args.includes('--json')) {
    return { ok: true, code: 0, text: JSON.stringify({ schemaVersion: 1, file, estimate: 'tokens = characters / 4, rounded up (an estimate, not a model count)', skippedLines: skipped, count: shown.length, total: { ...total, seconds: Number(secs(total.ms)) }, rows: shown.map((r) => ({ at: r.at, command: r.cmd, bytes: r.bytes, estTokens: r.tokens, seconds: Number(secs(r.ms)), exit: r.exit, partial: Boolean(r.partial) })) }, null, 2) }
  }
  const lines = []
  if (!shown.length) lines.push(missing ? `No cost log yet (${file}). Every meerkat command adds one row to it; run any command and look again.` : `The cost log ${file} has no readable rows.`)
  else {
    const cmdW = Math.max(7, ...shown.map((r) => r.cmd.length))
    const cell = (r) => ({ b: `${r.partial ? '>=' : ''}${fmtBytes(r.bytes)}`, t: `${r.partial ? '>=' : ''}${r.tokens}`, s: secs(r.ms) })
    const cells = shown.map(cell)
    const bW = Math.max(5, ...cells.map((c) => c.b.length), String(total.bytes).length + 2)
    const tW = Math.max(11, ...cells.map((c) => c.t.length), String(total.tokens).length + 2)
    lines.push(`${'command'.padEnd(cmdW)}  ${'bytes'.padStart(bW)}  ${'est. tokens'.padStart(tW)}  ${'seconds'.padStart(7)}`)
    shown.forEach((r, k) => lines.push(`${r.cmd.padEnd(cmdW)}  ${cells[k].b.padStart(bW)}  ${cells[k].t.padStart(tW)}  ${cells[k].s.padStart(7)}`))
    lines.push(`${'total'.padEnd(cmdW)}  ${`${partialAny ? '>=' : ''}${total.bytes}`.padStart(bW)}  ${`${partialAny ? '>=' : ''}${total.tokens}`.padStart(tW)}  ${secs(total.ms).padStart(7)}`)
    lines.push(`Last ${shown.length} command(s). Tokens are an ESTIMATE: characters / 4, rounded up.`)
    if (partialAny) lines.push('>= means the command handed the terminal to a child process (a verify run, a repo test or build), whose output this meter cannot see: the figure is a lower bound.')
  }
  if (skipped) lines.push(`${skipped} line(s) in ${file} could not be read and were skipped (nothing was deleted; fix or remove them by hand).`)
  return { ok: true, code: 0, text: lines.join('\n') }
}
