// meerkat brief --task <plan.json> <task-id> (lib/taskpack.mjs, roadmap C4): a context pack for one task of a checked plan.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { projectInfo } from '../lib/runlog.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-pack-'))); tmps.push(d); return d }
function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}
let logDir = ''
let repo = ''
function mk(...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: 'utf8', timeout: 90000, env: { ...process.env, MEERKAT_LOG_DIR: logDir } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
function put(rel: string, text: string) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true })
  writeFileSync(join(repo, rel), text)
}
let n = 0
function plan(obj: unknown) {
  const f = join(repo, `plan-${n++}.json`)
  writeFileSync(f, JSON.stringify(obj))
  return f
}
const task = (id: string, owns: string[], extra: Record<string, unknown> = {}) => ({ id, goal: `goal of ${id}`, owns, done: `npm test -- ${id}`, timeMinutes: 25, maxTurns: 40, ...extra })
const HEADS = ['## Task', '## Files the task owns', '## Symbols defined there', '## Callers outside the task', '## Open risks in the owned files', '## Done command']

beforeAll(() => {
  repo = tmp()
  logDir = tmp()
  git(repo, 'init', '-q', '-b', 'main')
  put('src/a.js', 'export function alpha() { return 1 }\nexport const beta = 2\nclass Gamma {}\nexport { Gamma }\n')
  put('src/b.js', "import { alpha } from './a.js'\nexport function useAlpha() { return alpha() }\n")
  put('lib/c.js', "import { beta } from '../src/a.js'\nexport const c = beta\n")
  put('other/z.js', 'export const z = 1\n')
  put('py/m.py', 'def run():\n    pass\n\nclass Thing:\n    pass\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  // a saved run with findings in src/a.js (owned) and lib/c.js (not owned by the first task)
  const p = projectInfo(repo)
  const dir = join(logDir, 'runs', `20261110-100000-${p.id}-run`)
  mkdirSync(dir, { recursive: true })
  const f = (id: string, file: string, line: number, severity: string, check: string) => ({ id, check, rule: check, suite: 'code', severity, file, line, message: `problem ${id}`, status: 'new', fix: null })
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({ schemaVersion: 1, meerkat: { version: 'x' }, run: { id: 'r1', project: { name: p.name, path: p.path } }, counts: { total: 2, new: 2, known: 0, fixed: 0, bySeverity: {} }, findings: [f('aaaa1111', 'src/a.js', 1, 'high', 'chk-a'), f('bbbb2222', 'lib/c.js', 1, 'high', 'chk-c')], hidden: [], hiddenFindings: [], fixed: [], notRun: [], skipped: [] }))
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ preset: 'run', tier: 'run', project: { path: p.path } }))
})
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

describe('meerkat brief --task', () => {
  test('sections appear in the fixed order, the done command twice, stdout only', () => {
    const f = plan({ version: 1, tasks: [task('t1', ['src/a.js'], { timeMinutes: 20, maxTurns: 33 })] })
    const r = mk('brief', '--task', f, 't1')
    expect(r.code, r.err).toBe(0)
    expect(r.err).toBe('')
    let at = -1
    for (const h of HEADS) {
      const i = r.out.indexOf(h)
      expect(i, h).toBeGreaterThan(at)
      at = i
    }
    expect(r.out).toContain('goal of t1')
    expect(r.out).toMatch(/20 minutes/)
    expect(r.out).toMatch(/33 turns/)
    expect(r.out.split('npm test -- t1').length - 1).toBe(2)
    expect(r.out).toMatch(/approximate/i)
  })

  test('owned files come only from the task, directories are expanded to the files in them', () => {
    const f = plan({ version: 1, tasks: [task('t1', ['src']), task('t2', ['other/z.js'])] })
    const out = mk('brief', '--task', f, 't1').out
    const owned = out.slice(out.indexOf('## Files the task owns'), out.indexOf('## Symbols'))
    expect(owned).toContain('src/a.js')
    expect(owned).toContain('src/b.js')
    expect(owned).not.toContain('other/z.js')
    expect(owned).not.toContain('lib/c.js')
  })

  test('symbols are names from the owned files only (js and python)', () => {
    const f = plan({ version: 1, tasks: [task('t1', ['src/a.js', 'py/m.py'])] })
    const out = mk('brief', '--task', f, 't1').out
    const sec = out.slice(out.indexOf('## Symbols'), out.indexOf('## Callers'))
    for (const s of ['alpha', 'beta', 'Gamma', 'run', 'Thing']) expect(sec, s).toContain(s)
    expect(sec).not.toContain('useAlpha') // defined in src/b.js, which the task does not own
  })

  test('callers listed are outside the task, files only', () => {
    const f = plan({ version: 1, tasks: [task('t1', ['src/a.js'])] })
    const one = mk('brief', '--task', f, 't1').out
    const callers1 = one.slice(one.indexOf('## Callers'), one.indexOf('## Open risks'))
    expect(callers1).toContain('src/b.js')
    expect(callers1).toContain('lib/c.js')
    // a plan where one task owns src/ (a and b): b.js is inside the task, only lib/c.js calls in from outside
    const g = plan({ version: 1, tasks: [task('t2', ['src'])] })
    const two = mk('brief', '--task', g, 't2').out
    const callers2 = two.slice(two.indexOf('## Callers'), two.indexOf('## Open risks'))
    expect(callers2).toContain('lib/c.js')
    expect(callers2).not.toContain('src/b.js')
    expect(callers2).not.toMatch(/:\d+/) // files only, no line numbers
  })

  test('open risks are the findings in the owned files only', () => {
    const f = plan({ version: 1, tasks: [task('t1', ['src/a.js'])] })
    const out = mk('brief', '--task', f, 't1').out
    const risks = out.slice(out.indexOf('## Open risks'), out.indexOf('## Done command'))
    expect(risks).toContain('src/a.js')
    expect(risks).toContain('chk-a')
    expect(risks).not.toContain('chk-c')
    expect(risks).not.toContain('lib/c.js')
  })

  test('an invalid plan is refused with exit 1 and no pack on stdout', () => {
    const f = plan({ version: 1, tasks: [task('t1', ['src/a.js'], { done: '' })] })
    const r = mk('brief', '--task', f, 't1')
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/plan check/)
  })

  test('an unknown task id is exit 2; a missing plan file is exit 3', () => {
    const f = plan({ version: 1, tasks: [task('t1', ['src/a.js'])] })
    const r = mk('brief', '--task', f, 'zzz')
    expect(r.code).toBe(2)
    expect(r.err).toContain('zzz')
    expect(mk('brief', '--task', join(repo, 'nope.json'), 't1').code).toBe(3)
    expect(mk('brief', '--task', f).code).toBe(2) // no task id
  })

  test('size cap: default 4000 characters, fixed sections kept, a visible [truncated] marker', () => {
    for (let i = 0; i < 120; i++) put(`big/file-number-${i}.js`, `export function fn${i}A() {}\nexport function fn${i}B() {}\nexport function fn${i}C() {}\n`)
    git(repo, 'add', 'big')
    git(repo, 'commit', '-q', '-m', 'big')
    const f = plan({ version: 1, tasks: [task('big', ['big'])] })
    const r = mk('brief', '--task', f, 'big')
    expect(r.code, r.err).toBe(0)
    expect(r.out.length).toBeLessThanOrEqual(4000)
    expect(r.out).toContain('[truncated]')
    for (const h of HEADS) expect(r.out).toContain(h)
    expect(r.out.split('npm test -- big').length - 1).toBe(2)
    // a smaller cap on request; a roomy cap shows nothing cut for a small task
    const small = mk('brief', '--task', f, 'big', '--max-chars', '1500')
    expect(small.out.length).toBeLessThanOrEqual(1500)
    const g = plan({ version: 1, tasks: [task('t1', ['src/a.js'])] })
    expect(mk('brief', '--task', g, 't1').out).not.toContain('[truncated]')
  })

  test('--json carries the same sections', () => {
    const f = plan({ version: 1, tasks: [task('t1', ['src/a.js'])] })
    const j = JSON.parse(mk('brief', '--task', f, 't1', '--json').out)
    expect(j.task.id).toBe('t1')
    expect(j.owned).toEqual(['src/a.js'])
    expect(j.symbols['src/a.js']).toEqual(expect.arrayContaining(['alpha', 'beta']))
    expect(j.callers).toEqual(['lib/c.js', 'src/b.js'])
    expect(j.risks.map((x: { check: string }) => x.check)).toEqual(['chk-a'])
    expect(j.done).toBe('npm test -- t1')
  })

  test('meerkat brief <file> still works without --task', () => {
    const r = mk('brief', 'src/a.js')
    expect(r.code, r.err).toBe(0)
    expect(r.out).toContain('src/a.js')
  })
})
