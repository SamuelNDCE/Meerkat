// meerkat risks (lib/risks.mjs, roadmap C3): the newest run's findings grouped by file, ranked, dismissed ones apart.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { projectInfo } from '../lib/runlog.mjs'
// @ts-expect-error plain JS module
import { acceptedFile, dismissalDoc } from '../lib/accepted.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BIN = join(ROOT, 'bin/meerkat.mjs')
const tmps: string[] = []
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-risks-'))); tmps.push(d); return d }
function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}
function mk(cwd: string, logDir: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, MEERKAT_LOG_DIR: logDir } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const finding = (id: string, file: string | null, line: number, severity: string, check: string, extra: Record<string, unknown> = {}) =>
  ({ id, check, rule: check, suite: 'code', severity, file, line, message: `problem ${id}`, status: 'new', fix: null, ...extra })

// Writes a run folder for `folder` holding findings.json (the shape lib/findingsdoc.mjs reads).
function saveRun(logDir: string, folder: string, findings: unknown[], stampPart = '20261110-100000') {
  const p = projectInfo(folder)
  const dir = join(logDir, 'runs', `${stampPart}-${p.id}-run`)
  mkdirSync(dir, { recursive: true })
  const doc = { schemaVersion: 1, meerkat: { version: 'x' }, run: { id: `${stampPart}-${p.id}-run`, project: { name: p.name, path: p.path } }, counts: { total: findings.length, new: findings.length, known: 0, fixed: 0, bySeverity: {} }, findings, hidden: [], hiddenFindings: [], fixed: [], notRun: [], skipped: [] }
  writeFileSync(join(dir, 'findings.json'), JSON.stringify(doc))
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ preset: 'run', tier: 'run', project: { path: p.path } }))
}
function commitFile(repo: string, rel: string, text: string, msg: string) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true })
  writeFileSync(join(repo, rel), text)
  git(repo, 'add', rel)
  git(repo, 'commit', '-q', '-m', msg)
}

let repo = ''
let logDir = ''
beforeAll(() => {
  repo = tmp()
  logDir = tmp()
  git(repo, 'init', '-q', '-b', 'main')
  const body = Array.from({ length: 30 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n'
  commitFile(repo, 'src/a.js', body, 'a1')
  commitFile(repo, 'src/b.js', body, 'b1')
  commitFile(repo, 'src/c.js', body, 'c1')
  commitFile(repo, 'src/d.js', body, 'd1')
  for (let i = 0; i < 4; i++) commitFile(repo, 'src/d.js', body + `// edit ${i}\n`, `d${i + 2}`)
  for (let i = 0; i < 2; i++) commitFile(repo, 'src/a.js', body + `// edit ${i}\n`, `a${i + 2}`)
  saveRun(logDir, repo, [
    finding('aaaa1111', 'src/a.js', 10, 'medium', 'chk-a'),
    finding('bbbb2222', 'src/b.js', 5, 'medium', 'chk-b'),
    finding('cccc3333', 'src/c.js', 7, 'critical', 'chk-c', { fix: 'run the fixer on src/c.js' }),
    finding('dddd4444', 'src/d.js', 20, 'medium', 'chk-d'),
    finding('dddd5555', 'src/d.js', 3, 'high', 'chk-d2'),
    finding('eeee6666', null, 0, 'low', 'chk-e'),
  ])
  // a dismissal for a finding that is NOT in the run (a dismissed finding is not an open one)
  const dfile = acceptedFile('dismissed', { MEERKAT_LOG_DIR: logDir }, repo)
  mkdirSync(dirname(dfile), { recursive: true })
  writeFileSync(dfile, JSON.stringify(dismissalDoc([{ id: 'ffff7777', rule: 'chk-f', check: 'chk-f', file: 'src/a.js', title: 'a thing we accept', reason: 'generated code, safe', at: '2026-11-01T00:00:00Z' }])))
})
afterAll(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }) })

describe('meerkat risks', () => {
  test('line 1 says it is the newest run of the current branch only', () => {
    const r = mk(repo, logDir, 'risks')
    expect(r.code).toBe(0)
    const first = r.out.split('\n')[0]
    expect(first).toMatch(/newest run/i)
    expect(first).toMatch(/current branch/i)
  })

  test('grouped by file, ranked by severity first, then by git churn', () => {
    const r = mk(repo, logDir, 'risks', '--json')
    expect(r.code).toBe(0)
    const j = JSON.parse(r.out)
    const files = j.open.map((e: { file: string | null }) => e.file)
    // critical c, then high d (worst of its two), then the two mediums: a changed 3 times, b once
    expect(files.slice(0, 4)).toEqual(['src/c.js', 'src/d.js', 'src/a.js', 'src/b.js'])
    const d = j.open.find((e: { file: string }) => e.file === 'src/d.js')
    expect(d.findings.map((f: { id: string }) => f.id)).toEqual(['dddd5555', 'dddd4444']) // severity within a file
    expect(d.churn).toBeGreaterThan(j.open.find((e: { file: string }) => e.file === 'src/a.js').churn)
    expect(j.gitHistory.available).toBe(true)
    expect(j.gitHistory.commits).toBe(200)
  })

  test('each entry has file, line, check id, a one-line message and the next command', () => {
    const j = JSON.parse(mk(repo, logDir, 'risks', '--json').out)
    const c = j.open.find((e: { file: string }) => e.file === 'src/c.js').findings[0]
    expect(c).toMatchObject({ line: 7, check: 'chk-c', severity: 'critical' })
    expect(c.message).not.toContain('\n')
    expect(c.next).toBe('run the fixer on src/c.js') // the check's fix hint wins
    const a = j.open.find((e: { file: string }) => e.file === 'src/a.js').findings[0]
    expect(a.next).toBe('meerkat why chk-a') // no hint: meerkat why
    const text = mk(repo, logDir, 'risks').out
    expect(text).toContain('src/c.js')
    expect(text).toContain('meerkat why chk-a')
  })

  test('dismissed findings are listed apart with their reason and never as open', () => {
    const j = JSON.parse(mk(repo, logDir, 'risks', '--json').out)
    expect(j.dismissed.map((d: { id: string }) => d.id)).toEqual(['ffff7777'])
    expect(j.dismissed[0].reason).toBe('generated code, safe')
    expect(JSON.stringify(j.open)).not.toContain('ffff7777')
    const text = mk(repo, logDir, 'risks').out
    const at = text.indexOf('Dismissed')
    expect(at).toBeGreaterThan(0)
    expect(text.slice(at)).toContain('generated code, safe')
    expect(text.slice(0, at)).not.toContain('ffff7777')
  })

  test('every named file and line exists in the working tree', () => {
    const j = JSON.parse(mk(repo, logDir, 'risks', '--json').out)
    let n = 0
    for (const e of j.open) {
      if (!e.file) continue
      expect(existsSync(join(repo, e.file)), e.file).toBe(true)
      const lines = readFileSync(join(repo, e.file), 'utf8').split('\n').length
      for (const f of e.findings) {
        expect(f.line).toBeGreaterThan(0)
        expect(f.line).toBeLessThanOrEqual(lines)
        n++
      }
    }
    expect(n).toBe(5)
    expect(j.open.at(-1).file).toBeNull() // a finding with no file is kept, last
  })

  test('git unavailable: ranks by severity only and says so', () => {
    const plain = tmp() // not a git repository
    writeFileSync(join(plain, 'x.js'), 'a\nb\nc\n')
    writeFileSync(join(plain, 'y.js'), 'a\nb\nc\n')
    saveRun(logDir, plain, [finding('1111aaaa', 'x.js', 1, 'low', 'chk-x'), finding('2222bbbb', 'y.js', 2, 'high', 'chk-y')])
    const r = mk(plain, logDir, 'risks')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/git history is not available.*severity only/i)
    const j = JSON.parse(mk(plain, logDir, 'risks', '--json').out)
    expect(j.gitHistory.available).toBe(false)
    expect(j.open.map((e: { file: string }) => e.file)).toEqual(['y.js', 'x.js'])
  })

  test('a folder argument picks that folder; no run saved is exit 3; a missing folder is exit 2', () => {
    const lone = tmp()
    expect(mk(lone, logDir, 'risks').code).toBe(3)
    expect(mk(lone, logDir, 'risks', repo).code).toBe(0)
    expect(mk(lone, logDir, 'risks', join(lone, 'nope')).code).toBe(2)
    expect(mk(lone, logDir, 'risks', '--bogus').code).toBe(2)
  })
})
