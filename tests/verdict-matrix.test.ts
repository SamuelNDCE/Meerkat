// Conformance matrix: `meerkat verdict` (and `meerkat gate`) on the repository states a real team hits, run through the real CLI.
// Per row: (1) the first stdout line is the answer (a verdict word, never a folder/note/progress line), (2) the exit code is the one in the
// docs/commands.md "Exit codes" table, (3) --json gives the same exit code and verdict word, (4) the run finishes inside RUN_BUDGET_MS.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const RUN_BUDGET_MS = 60_000 // per CLI run; change here
const WORD = /^(PASS|FAIL|NO-RESULT|STALE|INCOMPLETE)\b/

const root = mkdtempSync(join(tmpdir(), 'meerkat-matrix-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const bin = join(__dirname, '..', 'bin', 'meerkat.mjs')
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), MEERKAT_HOME: join(root, 'home') }

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string | Buffer) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const commitAll = (dir: string, msg: string) => {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', msg)
}
const BAD = 'const awsKey = "AKIAIOSFODNN7EXAMPLE"\n'
const CLEAN = 'export const ok = (a) => a + 1\n'

// A repo whose base branch is `main`, with a project config that keeps the run fast and deterministic.
const makeRepo = (name: string, baseFiles: Record<string, string> = {}, base = 'main') => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', base)
  put(dir, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus'], disable: ['unused-files'], discover: false }))
  put(dir, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(dir, 'src/ok.js', CLEAN)
  for (const [f, b] of Object.entries(baseFiles)) put(dir, f, b)
  commitAll(dir, 'base')
  return dir
}
const branch = (dir: string, name = 'feature') => git(dir, 'checkout', '-q', '-b', name)

type Row = { name: string; build: () => string; args: string[]; word: RegExp; code: number; gateCode: number; docRow: string; gateArgs?: string[] }
const rows: Row[] = [
  {
    name: '01 clean branch, no diff',
    build: () => { const d = makeRepo('r01'); branch(d); return d },
    args: ['--base', 'main'], word: /^NO-RESULT/, code: 3, gateCode: 3,
    docRow: 'exit 3: NO-RESULT, nothing changed (status 204)',
  },
  {
    name: '02 branch with one new finding',
    build: () => { const d = makeRepo('r02'); branch(d); put(d, 'src/leak.js', BAD); commitAll(d, 'leak'); return d },
    args: ['--base', 'main'], word: /^FAIL/, code: 1, gateCode: 1,
    docRow: 'exit 1: a finding in a changed file (FAIL, status 422)',
  },
  {
    name: '03 pre-existing finding only',
    build: () => { const d = makeRepo('r03', { 'src/old.js': BAD }); branch(d); put(d, 'src/new.js', CLEAN + 'export const n = 2\n'); commitAll(d, 'clean add'); return d },
    args: ['--base', 'main'], word: /^PASS/, code: 0, gateCode: 0,
    docRow: 'exit 0: PASS, also with pre-existing findings only (verdict row)',
  },
  {
    name: '04 --staged with nothing staged',
    build: () => { const d = makeRepo('r04'); branch(d); return d },
    args: ['--staged'], word: /^NO-RESULT/, code: 3, gateCode: 3,
    docRow: 'exit 3: NO-RESULT; "--staged with nothing staged is NO-RESULT (exit 3, status 204)"', gateArgs: ['--staged'],
  },
  {
    name: '05 detached HEAD with a new finding',
    build: () => { const d = makeRepo('r05'); branch(d); put(d, 'src/leak.js', BAD); commitAll(d, 'leak'); git(d, 'checkout', '-q', '--detach'); return d },
    args: ['--base', 'main'], word: /^FAIL/, code: 1, gateCode: 1,
    docRow: 'exit 1: FAIL (a detached HEAD is still a branch state to judge)',
  },
  {
    name: '06 no base branch (no --base, no main/dev/origin)',
    build: () => { const d = makeRepo('r06', {}, 'work'); put(d, 'src/leak.js', BAD); commitAll(d, 'leak'); return d },
    args: [], word: /^NO-RESULT/, code: 3, gateCode: 3,
    docRow: 'exit 3: NO-RESULT, status 404 no base',
    gateArgs: [],
  },
  {
    name: '07 base far ahead (stale, 25 commits)',
    build: () => {
      const d = makeRepo('r07'); branch(d); put(d, 'src/leak.js', BAD); commitAll(d, 'leak')
      git(d, 'checkout', '-q', 'main')
      for (let i = 0; i < 25; i++) git(d, 'commit', '-q', '--allow-empty', '-m', `m${i}`)
      git(d, 'checkout', '-q', 'feature'); return d
    },
    args: ['--base', 'main'], word: /^STALE/, code: 4, gateCode: 1,
    docRow: 'exit 4: verdict STALE, more than 20 commits behind (gate has no stale rule: the finding still blocks, exit 1)',
  },
  {
    name: '08 large diff (about 3000 changed lines, clean)',
    build: () => {
      const d = makeRepo('r08'); branch(d)
      for (let f = 0; f < 6; f++) put(d, `src/big${f}.js`, Array.from({ length: 500 }, (_, i) => `export const v${f}_${i} = ${i}`).join('\n') + '\n')
      commitAll(d, 'big'); return d
    },
    args: ['--base', 'main'], word: /^PASS/, code: 0, gateCode: 0,
    docRow: 'exit 0: PASS (no diff cap exists on verdict/gate; the 3000-line cap is `batch --max-lines`, so no cap line is expected here)',
  },
  {
    name: '09 file the checks do not cover (.txt only)',
    build: () => { const d = makeRepo('r09'); branch(d); put(d, 'notes/readme.txt', 'just words\n'); commitAll(d, 'txt'); return d },
    args: ['--base', 'main'], word: /^NO-RESULT/, code: 3, gateCode: 3,
    docRow: 'exit 3: NO-RESULT, "no check ran on the changed files" (status 204)',
  },
  {
    name: '10 binary file',
    build: () => {
      const d = makeRepo('r10'); branch(d)
      put(d, 'assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254, 0, 0, 7]))
      commitAll(d, 'bin'); return d
    },
    args: ['--base', 'main'], word: /^NO-RESULT/, code: 3, gateCode: 3,
    docRow: 'exit 3: NO-RESULT, no check covers a binary file',
  },
  {
    name: '11 new finding alongside an uncovered file',
    build: () => { const d = makeRepo('r11'); branch(d); put(d, 'src/leak.js', BAD); put(d, 'notes/a.txt', 'x\n'); commitAll(d, 'mixed'); return d },
    args: ['--base', 'main'], word: /^FAIL/, code: 1, gateCode: 1,
    docRow: 'exit 1: FAIL (a covered finding is not hidden by an uncovered file)',
  },
]

const run = (cmd: 'verdict' | 'gate', args: string[], cwd: string) => {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [bin, cmd, ...args], { cwd, env, encoding: 'utf8', timeout: RUN_BUDGET_MS + 30_000 })
  return { code: r.status, ms: Date.now() - t0, lines: String(r.stdout).split(/\r?\n/).filter(Boolean), err: String(r.stderr) }
}

describe('verdict/gate conformance matrix', () => {
  for (const row of rows) {
    test(row.name, () => {
      const dir = row.build()
      const t = run('verdict', row.args, dir)
      expect(t.ms, 'time budget').toBeLessThan(RUN_BUDGET_MS)
      expect(t.lines[0] ?? '', `first line (${row.docRow})`).toMatch(WORD)
      expect(t.lines[0]).toMatch(row.word)
      expect(t.code, `exit code, doc: ${row.docRow}`).toBe(row.code)
      const j = run('verdict', [...row.args, '--json'], dir)
      expect(j.ms, 'time budget (json)').toBeLessThan(RUN_BUDGET_MS)
      const doc = JSON.parse(j.lines.join('\n'))
      expect(j.code).toBe(t.code)
      expect(doc.exitCode).toBe(t.code)
      expect(t.lines[0].startsWith(doc.verdict)).toBe(true)
      const g = run('gate', row.gateArgs ?? ['--base', 'main'], dir)
      expect(g.ms, 'time budget (gate)').toBeLessThan(RUN_BUDGET_MS)
      expect(g.lines[0] ?? '', 'gate first line').toMatch(/^(MEERKAT gate:|PASS|FAIL|NO-RESULT|INCOMPLETE)/)
      expect(g.lines[0]).toMatch(/\(status \d+[,)]/)
      expect(g.code, `gate exit code, doc: ${row.docRow}`).toBe(row.gateCode)
    }, 240_000)
  }
})
