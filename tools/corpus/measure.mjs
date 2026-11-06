#!/usr/bin/env node
// Measures recall and false alarms on the planted-defect corpus written by tools/corpus/gen-planted.mjs.
//
//   node tools/corpus/measure.mjs [--corpus corpus/planted] [--limit N] [--offset N] [--batch 40] [--jobs 6] [--timeout 30] [--family f] [--out file.json]
//
// For each defect: copy the defective file (alone) into a fresh temp folder, run ONLY the check that should catch it, and record caught when that
// check reports the planted rule as FAIL. Then do the same with the clean twin: a FAIL of the same rule is a false alarm, a FAIL of any other
// rule of that check is an "other-rule alarm" (counted apart). A rule reported NA is "not evaluated" (off by default or not applicable) and
// counts as a miss, listed with that reason. Defects run in batches of --batch, --jobs at a time, and each temp folder is removed at once.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const CORPUS = resolve(arg('corpus', join(REPO, 'corpus', 'planted')))
const LIMIT = Number(arg('limit', '0')) || Infinity
const OFFSET = Number(arg('offset', '0'))
const BATCH = Number(arg('batch', '40'))
const JOBS = Number(arg('jobs', '6'))
const TIMEOUT = Number(arg('timeout', '30')) * 1000
const ONLY_FAMILY = arg('family', '')
const OUT_JSON = arg('out', '')
// --all turns on the pedantic rules (MEERKAT_FINDINGS=all), which are off in a normal run.
const ENV = { ...process.env, ...(process.argv.includes('--all') ? { MEERKAT_FINDINGS: 'all' } : {}) }

const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8'))
let defects = manifest.defects.filter((d) => !ONLY_FAMILY || d.family === ONLY_FAMILY)
// A limit takes an even slice across the whole corpus (every k-th defect), so a small run still covers every family.
if (Number.isFinite(LIMIT) && LIMIT < defects.length) {
  const step = defects.length / LIMIT
  defects = Array.from({ length: LIMIT }, (_, i) => defects[Math.floor(i * step)])
} else defects = defects.slice(OFFSET)

const ELECTRON_PKG = '{\n  "name": "sample",\n  "devDependencies": { "electron": "41.0.0" }\n}\n'

function runCheck(d, side) {
  return new Promise((resolveRun) => {
    const dir = mkdtempSync(join(tmpdir(), 'planted-'))
    const copy = readFileSync(join(CORPUS, d[side === 'bad' ? 'defect' : 'twin']))
    // A bare package.json fragment is the sample of a rule, not the project's manifest: keep it one folder down, beside a real Electron manifest.
    const rel = d.family === 'electron-plus' && d.file === 'package.json' ? 'sample/package.json' : d.file
    const target = join(dir, ...rel.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, copy)
    if (d.family === 'electron-plus') writeFileSync(join(dir, 'package.json'), ELECTRON_PKG)
    const child = spawn(process.execPath, [join(REPO, 'thorough', d.script), d.check, '--root', dir], { stdio: ['ignore', 'pipe', 'pipe'], env: ENV })
    let out = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT)
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (out += b))
    child.on('close', () => {
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      const subs = {}
      for (const m of out.matchAll(/^MEERKAT-SUB (PASS|FAIL|NA) (\S+)/gm)) subs[m[2]] = m[1]
      resolveRun({ subs, timedOut, tail: out.slice(-300) })
    })
  })
}

async function one(d) {
  const bad = await runCheck(d, 'bad')
  const good = await runCheck(d, 'good')
  const status = bad.timedOut ? 'timeout' : bad.subs[d.rule] === 'FAIL' ? 'caught' : bad.subs[d.rule] === 'NA' ? 'not-evaluated' : bad.subs[d.rule] === 'PASS' ? 'missed' : 'no-output'
  const falseAlarm = good.subs[d.rule] === 'FAIL'
  const otherAlarms = Object.entries(good.subs).filter(([r, s]) => s === 'FAIL' && r !== d.rule).map(([r]) => r)
  return { d, status, falseAlarm, otherAlarms, goodTimedOut: good.timedOut, tail: status === 'no-output' || status === 'timeout' ? bad.tail : '' }
}

const t0 = Date.now()
const results = []
for (let i = 0; i < defects.length; i += BATCH) {
  const batch = defects.slice(i, i + BATCH)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(JOBS, batch.length) }, async () => {
    while (next < batch.length) results.push(await one(batch[next++]))
  }))
  process.stderr.write(`\r${Math.min(i + BATCH, defects.length)}/${defects.length} defects, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
process.stderr.write('\n')

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a')
function table(title, keyOf) {
  const g = {}
  for (const r of results) {
    const k = keyOf(r.d)
    const x = (g[k] ??= { n: 0, caught: 0, notEval: 0, fa: 0, other: 0 })
    x.n++
    if (r.status === 'caught') x.caught++
    if (r.status === 'not-evaluated') x.notEval++
    if (r.falseAlarm) x.fa++
    if (r.otherAlarms.length) x.other++
  }
  console.log(`\n${title}\n${'key'.padEnd(34)} ${'defects'.padStart(8)} ${'caught'.padStart(7)} ${'recall'.padStart(7)} ${'not-eval'.padStart(8)} ${'false-al'.padStart(8)} ${'other-al'.padStart(8)}`)
  for (const [k, x] of Object.entries(g).sort()) console.log(`${k.padEnd(34)} ${String(x.n).padStart(8)} ${String(x.caught).padStart(7)} ${pct(x.caught, x.n).padStart(7)} ${String(x.notEval).padStart(8)} ${String(x.fa).padStart(8)} ${String(x.other).padStart(8)}`)
  return g
}
table('By family', (d) => d.family)
table('By check', (d) => d.check)
table('Canonical sample (variant 0, what selfTest already proves) vs varied', (d) => (d.canonical ? 'canonical' : 'varied'))
const total = results.length
const caught = results.filter((r) => r.status === 'caught').length
const fa = results.filter((r) => r.falseAlarm).length
const other = results.filter((r) => r.otherAlarms.length).length
console.log(`\nTOTAL ${total} defects, caught ${caught} (recall ${pct(caught, total)}), false alarms on the same rule ${fa} (${pct(fa, total)}), other-rule alarms on clean twins ${other} (${pct(other, total)}), timeouts ${results.filter((r) => r.status === 'timeout' || r.goodTimedOut).length}`)
console.log(`time ${((Date.now() - t0) / 1000).toFixed(0)}s for ${total} defects (2 check runs each), batch ${BATCH}, jobs ${JOBS}`)

const missed = results.filter((r) => r.status !== 'caught')
console.log(`\nMissed defects: ${missed.length}`)
for (const r of missed.slice(0, Number(arg('show', '60')))) console.log(`  [${r.status}] ${r.d.id}  ${r.d.file}:${r.d.line}  ${r.d.description}`)
if (missed.length > Number(arg('show', '60'))) console.log(`  ... ${missed.length - Number(arg('show', '60'))} more (use --out to write them all)`)
const tally = {}
for (const r of results) for (const o of r.otherAlarms) tally[`${r.d.check}: ${o}`] = (tally[`${r.d.check}: ${o}`] ?? 0) + 1
console.log('\nOther-rule alarms on clean twins, by rule (a rule of the same check fired on a file made for a different rule):')
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(3)}  ${k}`)
const fas = results.filter((r) => r.falseAlarm)
console.log(`\nFalse alarms (clean twin flagged for the same rule): ${fas.length}`)
for (const r of fas.slice(0, 30)) console.log(`  ${r.d.id}  ${r.d.description}`)
if (OUT_JSON) writeFileSync(OUT_JSON, JSON.stringify({ total, caught, falseAlarms: fa, results: results.map((r) => ({ id: r.d.id, check: r.d.check, family: r.d.family, rule: r.d.rule, status: r.status, falseAlarm: r.falseAlarm, otherAlarms: r.otherAlarms, ops: r.d.ops, description: r.d.description })) }, null, 1) + '\n')
process.exit(0)
