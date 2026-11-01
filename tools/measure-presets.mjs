// Runs every bundled preset three times on a project and writes a table of what each runs and how long it takes into docs/reference.md, between the
// presets markers:   node tools/measure-presets.mjs [folder]      (the folder defaults to Meerkat's own repository)
// The times are real wall-clock times on this PC for that project. A preset that selects no checks there is shown as "none here".
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MEERKAT_DIR } from '../lib/paths.mjs'
import { PRESETS } from '../lib/presets.mjs'

const folder = resolve(process.argv[2] ?? MEERKAT_DIR)
const logs = mkdtempSync(join(tmpdir(), 'meerkat-measure-'))
const env = { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_PLAIN: '1', NO_COLOR: '1' }

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function measure(name) {
  const runs = []
  let line = ''
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    const r = spawnSync(process.execPath, [join(MEERKAT_DIR, 'run.mjs'), '--app', folder, '--preset', name, '--all'], { env, encoding: 'utf8', timeout: 20 * 60 * 1000 })
    const out = String(r.stdout ?? '')
    if (/no checks to run/.test(out)) return null
    line = out.split('\n').reverse().find((l) => /^MEERKAT .*: \d+ passed/.test(l)) ?? line
    runs.push((Date.now() - t0) / 1000)
  }
  const m = /: (\d+) passed, (\d+) failed, (\d+) not run/.exec(line)
  const checks = m ? Number(m[1]) + Number(m[2]) + Number(m[3]) : 0
  return { seconds: median(runs), checks }
}

const time = (s) => (s < 1 ? '<1 s' : s < 60 ? `${s.toFixed(1)} s` : `${(s / 60).toFixed(1)} min`)

const SECTIONS = [
  ['Everything', ['quick', 'fast', 'full', 'thorough']],
  ['By kind', ['security-fast', 'security', 'functionality-fast', 'functionality', 'ui-fast', 'ui', 'performance-fast', 'performance', 'refactor']],
  ['Combinations', ['app-fast', 'app', 'ci', 'release', 'security-ai']],
]

const out = []
for (const [title, names] of SECTIONS) {
  out.push(`### ${title}`, '', '| Command | What it runs | Checks | Time |', '|---|---|---|---|')
  for (const n of names) {
    const p = PRESETS[n]
    if (!p) continue
    const m = measure(n)
    out.push(`| \`meerkat ${n}\` | ${p.about} | ${m ? m.checks : '-'} | ${m ? time(m.seconds) : 'none here'} |`)
    console.log(n, m)
  }
  out.push('')
}
const block = `<!-- presets:start -->\nMeasured on ${folder.replace(/\\/g, '/') === MEERKAT_DIR ? "Meerkat's own repository" : folder.split(/[\\/]/).pop()}, a small project, on one PC (median of 3 runs). Real projects take as long as their builds and tests; the quick checks that only read files stay at a second or two.\n\n${out.join('\n')}<!-- presets:end -->`

const file = join(MEERKAT_DIR, 'docs', 'reference.md')
const text = readFileSync(file, 'utf8')
const nl = text.includes('\r\n') ? '\r\n' : '\n'
const re = /<!-- presets:start -->[\s\S]*?<!-- presets:end -->/
if (!re.test(text)) throw new Error('docs/reference.md has no presets markers')
writeFileSync(file, text.replace(re, () => block.replace(/\n/g, nl)))
rmSync(logs, { recursive: true, force: true })
console.log('docs/reference.md updated')
