// Runs each trap's named check on its trap project and reports which traps the check flags (a real false alarm of that check).
//   node tools/accuracy-corpus.mjs --out <dir>            writes the projects (no run)
//   node tools/trap-lang-verify.mjs <dir> [--work <dir>]  runs `run.mjs --preset thorough --only <check>` once per (project, check)
// It reads the traps from every tools/accuracy-extra-trap-lang-*.mjs (their exported TRAPS) and writes <work>/trap-lang-result.json.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const out = resolve(args[0] ?? '')
const work = resolve(args.includes('--work') ? args[args.indexOf('--work') + 1] : join(out, '.trap-work'))
mkdirSync(work, { recursive: true })

const traps = []
for (const f of readdirSync(join(ROOT, 'tools')).filter((n) => /^accuracy-extra-trap-lang-.+\.mjs$/.test(n)).sort()) {
  const mod = await import(pathToFileURL(join(ROOT, 'tools', f)).href)
  traps.push(...(mod.TRAPS ?? []))
}
const packs = readdirSync(join(ROOT, 'packs'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
const cfg = join(work, 'config.json')
writeFileSync(cfg, JSON.stringify({ packs, override: {}, presets: {} }))

const pairs = [...new Set(traps.map((t) => `${t.project}\t${t.check}`))].map((s) => s.split('\t'))
const runOne = ([project, check], n) =>
  new Promise((done) => {
    const logs = join(work, 'logs', `${project}__${check}`)
    mkdirSync(logs, { recursive: true })
    const json = join(work, `r${n}.json`)
    const env = { ...process.env, MEERKAT_FINDINGS: 'all', MEERKAT_PLAIN: '1', MEERKAT_LOG_DIR: logs, MEERKAT_USER_CONFIG: join(work, 'none.json'), MEERKAT_STATUS: join(work, `s${n}.json`), MEERKAT_HISTORY: join(work, `h${n}.json`), MEERKAT_TIMINGS: join(work, `t${n}.json`), MEERKAT_CHECK_TIMEOUT: '90' }
    const child = spawn(process.execPath, [join(ROOT, 'run.mjs'), '--app', join(out, project), '--config', cfg, '--preset', 'thorough', '--only', check, '--plain', '--json', json], { cwd: ROOT, env, windowsHide: true })
    let text = ''
    child.stdout.on('data', (b) => (text += b))
    child.stderr.on('data', (b) => (text += b))
    const timer = setTimeout(() => child.kill(), 150000)
    child.on('close', () => {
      clearTimeout(timer)
      let findings = []
      let status = 'no-findings-file'
      try {
        const runs = join(logs, 'runs')
        const latest = readdirSync(runs).sort().pop()
        findings = JSON.parse(readFileSync(join(runs, latest, 'findings.json'), 'utf8')).findings ?? []
        status = 'ok'
      } catch {
        /* no findings file */
      }
      done({ project, check, status, noCheck: /matches no check/.test(text), findings: findings.map((x) => ({ file: x.file, line: x.line, rule: x.rule, severity: x.severity, check: x.check })) })
    })
  })

const results = []
let next = 0
const worker = async () => {
  while (next < pairs.length) {
    const i = next++
    results.push(await runOne(pairs[i], i))
  }
}
await Promise.all(Array.from({ length: 4 }, worker))

const flagged = []
const unrun = []
for (const t of traps) {
  const r = results.find((x) => x.project === t.project && x.check === t.check)
  if (!r || r.noCheck || r.status !== 'ok') {
    unrun.push({ ...t, why: !r ? 'not run' : r.noCheck ? 'check id matches no check' : r.status })
    continue
  }
  const hits = r.findings.filter((f) => f.file === t.file)
  if (hits.length) flagged.push({ ...t, hits })
}
const sevOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
const bug = flagged.filter((f) => f.hits.some((h) => (sevOrder[h.severity] ?? 3) >= 2))
writeFileSync(join(work, 'trap-lang-result.json'), JSON.stringify({ traps: traps.length, unrun, flagged }, null, 2))
console.log(`traps ${traps.length}, not checkable ${unrun.length}, flagged ${flagged.length} (bug severity ${bug.length})`)
for (const u of unrun) console.log(`NOT-RUN  ${u.project} ${u.file} ${u.check}: ${u.why}`)
for (const f of flagged) console.log(`FLAGGED  ${f.check}  ${f.project.replace('trap-lang-', '').replace('-clean', '')}/${f.file}  ${f.name}  ${f.hits.map((h) => `${h.rule ?? h.check}@${h.line ?? '-'}(${h.severity})`).join(', ')}`)
