// 0.8.2: time-boxed, resumable runs. Every case runs the real CLI (bin/meerkat.mjs) in a scratch git repository.
// The sleeping check is controlled by a flag file OUTSIDE the repository, so removing the sleep for the resumed run does not change the working tree
// (a changed tree is exactly what a resume file refuses).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-082-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_GATE_HEARTBEAT_MS: '500' } as NodeJS.ProcessEnv
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return String(r.stdout).trim()
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const cli = (args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'meerkat.mjs'), ...args], { encoding: 'utf8', env: { ...env, ...extra }, cwd, timeout: 170000 })
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) }
}

// A repository with two quick checks (one passes, one blocks on a.js:1), a check that sleeps while the flag file exists, and one more quick check.
function fixture(name: string) {
  const d = join(root, name)
  const flag = join(root, `${name}.sleep`).replace(/\\/g, '/')
  const config = JSON.stringify({ packs: [], discover: false, customChecks: [
    { id: 'quick-a', title: 'Quick A', cmd: 'node', args: ['quick.js'], tier: 'fast' },
    { id: 'blocker', title: 'Blocker', cmd: 'node', args: ['blocker.js'], tier: 'fast' },
    { id: 'nap', title: 'Nap', cmd: 'node', args: ['nap.js'], tier: 'fast', timeoutSeconds: 120 },
    { id: 'quick-b', title: 'Quick B', cmd: 'node', args: ['quick.js'], tier: 'fast' },
  ] })
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'package.json', '{"name":"fx","version":"1.0.0","private":true}')
  put(d, 'a.js', 'export const a = 1\n')
  put(d, 'quick.js', "console.log('ok')\n")
  put(d, 'blocker.js', "console.log('a.js:1: bad thing here'); process.exit(1)\n")
  put(d, 'nap.js', `if (require('fs').existsSync(${JSON.stringify(flag)})) setTimeout(() => {}, 20000)\n`)
  put(d, 'meerkat.config.json', config)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feat')
  put(d, 'a.js', 'export const a = 2\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'change a')
  return { d, flag }
}
const stopRun = (d: string, word: string, extra: string[] = []) => cli([word, '--base', 'main', ...extra], d, { MEERKAT_VERDICT_TIMEOUT_S: '12' })
const resumeFileOf = (text: string) => {
  const m = text.match(/^resume: meerkat \S+ --resume (?:"([^"]+)"|(\S+))$/m)
  return m ? (m[1] ?? m[2]) : ''
}

describe('verdict: a stop is resumable', () => {
  const { d, flag } = fixture('verdict-fx')
  let file = ''

  test('a sleeping check and a 3 s limit stop with INCOMPLETE, exit 75, a resume file and the exact resume command', () => {
    writeFileSync(flag, 'x')
    const v = stopRun(d, 'verdict')
    expect(v.code).toBe(75)
    expect(v.out).toMatch(/^INCOMPLETE \d+ of \d+ checks finished, \d+ blocking so far \(not a pass\)$/m)
    expect(v.out).toMatch(/a\.js:1 blocker: bad thing here/)
    file = resumeFileOf(v.out)
    expect(file).toMatch(/resume\.json$/)
    expect(v.out).toContain(`resume: meerkat verdict --resume ${file.includes(' ') ? `"${file}"` : file}`)
    expect(v.out).not.toMatch(/NO-RESUME|NO-RESULT/)
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    const ids = doc.rows.map((r: { id: string }) => r.id).sort()
    expect(ids).toEqual(expect.arrayContaining(['blocker', 'quick-a', 'quick-b']))
    expect(ids).not.toContain('nap')
    expect(doc.commit).toBe(git(d, 'rev-parse', 'HEAD'))
    expect(doc.base.ref).toBe('main')
    expect(doc.rows.find((r: { id: string }) => r.id === 'blocker').kind).toBe('fail')
  }, 90000)

  test('a missing, broken or foreign resume file is refused with the reason, exit 2, never ignored', () => {
    const missing = cli(['verdict', '--resume', join(root, 'nope.json')], d)
    expect(missing.code).toBe(2)
    expect(missing.out).toMatch(/^NO-RESULT: the resume file .* does not exist\. next:/m)
    writeFileSync(join(root, 'bad.json'), '{not json')
    expect(cli(['verdict', '--resume', join(root, 'bad.json')], d).out).toMatch(/is not valid JSON/)
    writeFileSync(join(root, 'other.json'), '{"version":99}')
    expect(cli(['verdict', '--resume', join(root, 'other.json')], d).out).toMatch(/not one this version of Meerkat wrote/)
    const none = cli(['verdict', '--resume'], d)
    expect(none.code).toBe(2)
    expect(none.out).toMatch(/--resume needs the resume file/)
  }, 90000)

  test('a different base, a changed working tree and a new commit each refuse the file with their own reason', () => {
    unlinkFlag(flag)
    const base = cli(['verdict', '--resume', file, '--base', 'HEAD'], d)
    expect(base.code).toBe(2)
    expect(base.out).toMatch(/^NO-RESULT: --resume refused: .*a different base/m)
    put(d, 'a.js', 'export const a = 3\n')
    const dirty = cli(['verdict', '--resume', file], d)
    expect(dirty.code).toBe(2)
    expect(dirty.out).toMatch(/--resume refused: files in the working tree changed after the stop/)
    git(d, 'checkout', 'a.js')
    git(d, 'commit', '-q', '--allow-empty', '-m', 'empty')
    const commit = cli(['verdict', '--resume', file], d)
    expect(commit.code).toBe(2)
    expect(commit.out).toMatch(/--resume refused: the resume file is from commit [0-9a-f]{10} and this folder is at [0-9a-f]{10}/)
    git(d, 'reset', '-q', '--hard', 'HEAD~1')
    expect(cli(['verdict', '--resume', file, '--app', join(root, 'elsewhere')], d).out).toMatch(/was made for .* and this run is for/)
  }, 150000)

  test('the resume run does only the unfinished check, merges, and its result equals one full run', () => {
    unlinkFlag(flag)
    const resumed = cli(['verdict', '--resume', file, '--json'], d)
    expect(resumed.err).toMatch(/resumed: \d+ checks already finished in the stopped run were not run again/)
    expect(resumed.err).toMatch(/^\[\d+\/\d+\] nap \.\.\./m)
    expect(resumed.err).not.toMatch(/^\[\d+\/\d+\] quick-a \.\.\./m)
    expect(resumed.err).not.toMatch(/^\[\d+\/\d+\] blocker \.\.\./m)
    const full = cli(['verdict', '--base', 'main', '--json'], d)
    expect(full.err).toMatch(/\[\d+\/\d+\] quick-a \.\.\./)
    // Per-check wall time and the cached flag differ between runs by design; the verdict and the rows must match.
    const same = (o: string) => { const d = JSON.parse(o); d.checks = d.checks?.map(({ seconds, cached, detail, ...rest }: any) => rest); return d }
    expect(same(resumed.out)).toEqual(same(full.out))
    expect(JSON.parse(full.out).verdict).toBe('FAIL')
    expect(resumed.code).toBe(full.code)
    // the plain line too
    const line = cli(['verdict', '--resume', file], d)
    expect(line.out.split('\n')[0]).toBe(cli(['verdict', '--base', 'main'], d).out.split('\n')[0])
    expect(line.out).toMatch(/^FAIL 1 blocking in changed files/m)
  }, 150000)
})

const unlinkFlag = (f: string) => {
  try {
    rmSync(f)
  } catch {
    /* already gone */
  }
}

describe('top and gate resume the same way', () => {
  test('top: stop, resume, same table as a full run', () => {
    const { d, flag } = fixture('top-fx')
    writeFileSync(flag, 'x')
    const t = stopRun(d, 'top')
    expect(t.code).toBe(75)
    const file = resumeFileOf(t.out)
    expect(t.out).toContain('resume: meerkat top --resume')
    unlinkFlag(flag)
    const resumed = cli(['top', '--resume', file], d)
    const full = cli(['top', '--base', 'main'], d)
    expect(resumed.code).toBe(0)
    expect(resumed.out).toBe(full.out)
    expect(resumed.out).toMatch(/a\.js\s+blocker\s+1\s+bad thing here/)
  }, 150000)

  test('gate: stop, resume, same rows as a full run; a resume made with --all is refused without it', () => {
    const { d, flag } = fixture('gate-fx')
    writeFileSync(flag, 'x')
    const g = cli(['gate', '--no-cache', '--base', 'main', '--max-seconds', '12', '--json'], d)
    expect([1, 75]).toContain(g.code) // 75 not run, or 1 when the blocker already counts
    expect(g.err).toMatch(/stopped early: \d+ blocking so far, \d+ of \d+ checks finished/)
    expect(g.err).toMatch(/^resume: meerkat gate --resume /m)
    const file = resumeFileOf(g.err)
    expect(JSON.parse(g.out).resumeRows).toBeUndefined()
    unlinkFlag(flag)
    const resumed = cli(['gate', '--resume', file, '--no-cache', '--json'], d)
    expect(resumed.err).toMatch(/resumed: \d+ checks already finished/)
    const full = cli(['gate', '--no-cache', '--base', 'main', '--json'], d)
    const norm = (t: string) => JSON.parse(t).rows.map((r: { id: string; kind: string; detail: string; places?: unknown }) => ({ id: r.id, kind: r.kind, detail: r.detail.replace(/\s*\[full output:.*$/s, ''), places: r.places }))
    expect(norm(resumed.out)).toEqual(norm(full.out))
    expect(resumed.code).toBe(full.code)
    // a gate stopped with --all cannot be resumed as a plain gate
    writeFileSync(flag, 'x')
    const all = cli(['gate', '--no-cache', '--all', '--base', 'main', '--max-seconds', '12'], d)
    const allFile = resumeFileOf(all.err)
    unlinkFlag(flag)
    expect(existsSync(allFile)).toBe(true)
    const doc = JSON.parse(readFileSync(allFile, 'utf8'))
    doc.key = ''
    writeFileSync(allFile, JSON.stringify(doc))
    const mismatch = cli(['gate', '--resume', allFile, '--no-cache'], d)
    expect(mismatch.code).toBe(2)
    expect(mismatch.err).toMatch(/made with different options/)
  }, 200000)
})

describe('resume.mjs helpers', () => {
  test('splitArgs keeps the folder absolute, drops the time limit and --all-findings, keeps the base', async () => {
    // @ts-expect-error plain .mjs module
    const { splitArgs, optionKey, resumeLine, resumeCommand } = await import('../lib/resume.mjs')
    const s = splitArgs(['proj', '--base', 'main', '--max-seconds', '5', '--all-findings'], root)
    expect(s.app).toBe(resolve(root, 'proj'))
    expect(s.flags).toEqual(['--base', 'main'])
    expect(s.seconds).toEqual(['--max-seconds', '5'])
    expect(optionKey({ all: true, thorough: false })).toBe('all')
    expect(resumeCommand('verdict', 'C:/a b/resume.json')).toBe('meerkat verdict --resume "C:/a b/resume.json"')
    expect(resumeLine('top', { reason: 'no log folder' })).toBe('NO-RESUME: no log folder')
  })
})
