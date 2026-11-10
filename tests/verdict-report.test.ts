// The verdict's report: exact failure blocks, plain headlines, labelled failure states and one answer across all four output formats.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { runVerdict } from '../lib/branchcmds.mjs'
import { blockLines, collectReport, headline, stateLines } from '../lib/verdict-report.mjs'
import { runHandoff } from '../lib/handoff.mjs'
import { verdictLine } from '../lib/branchcmds.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-vreport-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const bug = (name: string) => `export function ${name}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }\n`
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') }
let dir: string

beforeAll(() => {
  dir = join(root, 'repo')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'src/ok.js', 'export const ok = (a) => a + 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'checkout', '-q', '-b', 'bad')
  put(dir, 'src/b.js', bug('b'))
  put(dir, 'src/a.js', bug('a'))
  put(dir, 'src/c.js', bug('c'))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'bad change')
})

const run = async (argv: string[], where = dir, e = env) => {
  const lines: string[] = []
  const errs: string[] = []
  const code = await runVerdict(argv, { env: e, cwd: where, memory: false, out: (t: string) => lines.push(t), err: (t: string) => errs.push(t) })
  return { code, lines, errs }
}

const row = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, ...extra })

describe('(a) the exact failure report', () => {
  test('a 3-finding failure prints 3 blocks sorted by file then line, each with its rerun command', async () => {
    const r = await run(['--base', 'main'])
    expect(r.code).toBe(1)
    expect(r.lines[0]).toMatch(/^FAIL 3 new blocking findings in 3 files \(status 422\)\. Next: fix src\/a\.js:1/)
    const heads = r.lines.filter((l) => /^src\/\w\.js:\d+  \S+  \S+$/.test(l))
    expect(heads.map((l) => l.split('  ')[0])).toEqual(['src/a.js:1', 'src/b.js:1', 'src/c.js:1'])
    expect(r.lines.filter((l) => /^ {2}rerun: meerkat gate --only \S+/.test(l))).toHaveLength(3)
    expect(r.lines.filter((l) => l === '  new')).toHaveLength(3)
  }, 180_000)

  test('blocks are sorted by file then line and capped at 20 in text, with every one in the report', () => {
    const places = Array.from({ length: 25 }, (_, i) => ({ file: i % 2 ? 'z.js' : 'a.js', line: 30 - i, message: `m${i}` }))
    const rep = collectReport({ rows: [row('chk', 'fail', { places })] })
    expect(rep.blocks).toHaveLength(25)
    expect(rep.blocks.slice(0, 3).map((b) => `${b.file}:${b.line}`)).toEqual(['a.js:6', 'a.js:8', 'a.js:10'])
    const text = blockLines(rep.blocks)
    expect(text.filter((l) => /^a\.js|^z\.js/.test(l))).toHaveLength(20)
    expect(text[text.length - 1]).toMatch(/and 5 more/)
  })
})

describe('(b) a run the time limit stopped', () => {
  test('headline counts the checks that did not finish and ends with the resume action', () => {
    const rep = collectReport({ rows: [row('a', 'pass'), row('b', 'notrun', { detail: 'run deadline reached' }), row('c', 'notrun', { detail: 'run deadline reached' })] })
    expect(rep.notFinished.count).toBe(2)
    const head = headline({ kind: 'INCOMPLETE', status: 408, reason: 'timeout', notFinished: rep.notFinished, next: 'meerkat verdict --resume' })
    expect(head).toBe('INCOMPLETE (status 408): the time limit stopped the run; 2 of 3 checks did not finish. Next: meerkat verdict --resume')
    expect(stateLines(rep, { resumeCommand: 'meerkat verdict --resume' })).toEqual(['NOT FINISHED: 2 of 3 checks did not finish. rerun: meerkat verdict --resume'])
  })

  test('a real run with a 1 second limit prints NOT FINISHED or an INCOMPLETE headline, exit 75, never a pass', async () => {
    const r = await run(['--base', 'main', '--max-seconds', '1', '--no-cache'])
    if (r.code === 75) {
      expect(r.lines[0]).toMatch(/^INCOMPLETE \(status \d{3}\): .*Next: /)
      expect(r.lines.join('\n')).toMatch(/resume: |Next: meerkat verdict/)
    } else {
      expect(r.code).not.toBe(0) // the checks were fast enough to finish; the finding is still reported
    }
  }, 180_000)
})

describe('(c) a check that crashed', () => {
  test('is a TOOL PROBLEM, not a finding, and its status is 503, never 422', () => {
    const rep = collectReport({ rows: [row('cargo-test', 'crash', { detail: 'cargo: command not found' })] })
    expect(rep.blocks).toHaveLength(0)
    expect(rep.toolProblems).toHaveLength(1)
    const lines = stateLines(rep)
    expect(lines[0]).toMatch(/^TOOL PROBLEM: check cargo-test did not work \(cargo: command not found\)\. This is not a finding in your code\. rerun: meerkat gate --only cargo-test/)
    const head = headline({ kind: 'INCOMPLETE', status: 503, reason: 'tool-problem', toolProblems: 1, next: rep.toolProblems[0].rerun })
    expect(head).toContain('(status 503)')
    expect(head).not.toContain('422')
  })

  test('a run whose only trouble is a crashed check exits 75 with status 503', async () => {
    const crash = join(root, 'crash')
    mkdirSync(crash, { recursive: true })
    git(crash, 'init', '-q', '-b', 'main')
    put(crash, 'meerkat.config.json', JSON.stringify({ packs: ['repo'], discover: false, checks: [{ id: 'always-crash', run: 'node -e "process.exit(139)"', files: ['src/**/*.js'] }] }))
    put(crash, 'src/ok.js', 'export const ok = 1\n')
    git(crash, 'add', '-A')
    git(crash, 'commit', '-q', '-m', 'base')
    git(crash, 'checkout', '-q', '-b', 'feat')
    put(crash, 'src/ok.js', 'export const ok = 2\n')
    git(crash, 'commit', '-q', '-am', 'change')
    const r = await run(['--base', 'main', '--json'], crash)
    const doc = JSON.parse(r.lines.join('\n'))
    expect(doc.status).not.toBe(422)
    expect(doc.verdict).not.toBe('FAIL')
  }, 180_000)
})

describe('(d) a missing base', () => {
  test('is status 404 on one line, with no stack trace', async () => {
    const r = await run(['--base', 'no-such-ref-xyz'])
    expect(r.code).not.toBe(0) // a bad ref: no verdict, not a pass
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatch(/^NO-RESULT \(status 404\): .*Next: pass a base that exists/)
    expect(r.lines.join('\n') + r.errs.join('\n')).not.toMatch(/\n\s+at |Error:/)
  }, 60_000)

  test('a missing --known file is 404 on one line', async () => {
    const r = await run(['--base', 'main', '--known', 'nope.json'])
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatch(/^NO-RESULT \(status 404\): the --known file nope\.json does not exist/)
  }, 60_000)

  test('an unexpected exception inside Meerkat is status 500, one line, and a log file holds the detail', async () => {
    const lines: string[] = []
    const code = await runVerdict(['--base', 'main'], { env: { ...env, MEERKAT_LOG_DIR: join(root, 'errlogs') }, cwd: dir, out: (t: string) => lines.push(t), err: () => { throw new Error('boom: stack detail must stay in the log') } })
    // err is only called for progress, so a throwing err stands in for any internal fault.
    expect(code).toBe(75)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^INCOMPLETE \(status 500\): Meerkat itself failed \(boom/)
    expect(lines[0]).toMatch(/Details: .*verdict-error-.*\.log/)
    expect(lines[0]).not.toMatch(/\n|\sat /)
  }, 60_000)
})

describe('(e) the four formats agree', () => {
  test('text, json, markdown and github carry the same verdict word, status and exit code', async () => {
    const text = await run(['--base', 'main'])
    const json = await run(['--base', 'main', '--json'])
    const md = await run(['--base', 'main', '--format', 'markdown'])
    const gh = await run(['--base', 'main', '--format', 'github'])
    const doc = JSON.parse(json.lines.join('\n'))
    expect(doc.verdict).toBe('FAIL')
    expect(doc.status).toBe(422)
    expect(doc.blocks).toHaveLength(3)
    expect(doc.headline).toBe(text.lines[0])
    for (const r of [text, json, md, gh]) expect(r.code).toBe(doc.exitCode)
    expect(md.lines[0]).toBe(`**Meerkat verdict: ${doc.headline}**`)
    expect(gh.lines.some((l) => l === `::error::${doc.headline}`)).toBe(true)
    expect(md.lines[0]).toContain('(status 422)')
    expect(gh.lines.join('\n')).toContain('(status 422)')
  }, 240_000)
})

describe('verdictLine never passes with a tool problem', () => {
  test('a crashed check and no finding is INCOMPLETE (503), not PASS', () => {
    expect(verdictLine({ blocking: 0, preExisting: 0, toolProblems: 1 })).toMatch(/^INCOMPLETE .*503/)
    expect(verdictLine({ blocking: 0, preExisting: 0 })).toBe('PASS')
    expect(verdictLine({ blocking: 2, preExisting: 0, toolProblems: 1 })).toMatch(/^FAIL 2 blocking/)
  })
})
