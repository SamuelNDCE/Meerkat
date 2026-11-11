// Every command uses the one exit-code table (lib/exitcodes.mjs). A table-driven test: one row per command and case, one shared temp repo.
// It fails when a command exits with a number the table does not have, when a case exits with the wrong table code, when a command's --help
// does not list the table in the table's own words, or when the help text promises a code the table does not have.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { EXIT_ALLOWED, EXIT_TABLE, exitLines } from '../lib/exitcodes.mjs'
// @ts-expect-error plain .mjs module
import { COMMANDS } from '../lib/help.mjs'

const CLI = join(__dirname, '..', 'bin', 'meerkat.mjs')
const root = mkdtempSync(join(tmpdir(), 'meerkat-exitall-'))
const repo = join(root, 'repo')
const plain = join(root, 'plain')
const home = join(root, 'home')
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const git = (...a: string[]) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' })
beforeAll(() => {
  for (const d of [join(repo, 'src'), plain, home, join(root, 'logs')]) mkdirSync(d, { recursive: true })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'src/a.js'), 'export const a = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'c')
})

const run = (args: string[], where: 'repo' | 'plain') =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd: where === 'repo' ? repo : plain,
    encoding: 'utf8',
    input: '',
    timeout: 60000,
    env: { ...process.env, CI: '1', NO_COLOR: '1', MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs'), HOME: home, USERPROFILE: home },
  })

type Row = [command: string, args: string[], where: 'repo' | 'plain', expected: number, case_: string]
const names: string[] = COMMANDS.map((c: { name: string }) => c.name)
// Commands that start long work, a network call or a terminal menu: only their usage and --help cases run here.
const HEAVY = new Set(['redtest', 'mcp', 'self-test'])

const rows: Row[] = []
// success: --help of every command
for (const n of names) rows.push([n, [n, '--help'], 'repo', 0, 'help'])
// usage: a bad flag is exit 2 for every command that checks its flags (help takes any words)
for (const n of names) if (n !== 'help') rows.push([n, [n, '--bogus-flag-zz'], 'repo', 2, 'bad flag'])
// success with a result
for (const n of ['version', 'describe', 'bug', 'logs', 'commands', 'claims', 'worktrees', 'dismissals', 'trend', 'cost', 'ps', 'team', 'map', 'guide', 'handoff', 'suite', 'preset', 'trust']) rows.push([n, [n], 'repo', 0, 'success'])
// no result: nothing saved yet, nothing to compare with
for (const n of ['findings', 'prompt', 'last', 'suggest', 'baseline', 'pr-comment', 'memory-branch', 'verdict', 'gate', 'frontend']) rows.push([n, [n], 'repo', 3, 'no result'])
rows.push(['verdict', ['verdict', '--base', 'no-such-ref'], 'repo', 3, 'unknown ref'])
rows.push(['gate', ['gate', '--base', 'no-such-ref'], 'repo', 3, 'unknown ref'])
// usage / configuration: not a git repository, a missing argument, no command configured
for (const n of ['verdict', 'gate', 'smoke', 'batch', 'brief', 'blast', 'finding', 'dismiss', 'who-calls', 'deps', 'tests-for', 'top', 'claim', 'release']) rows.push([n, [n], 'plain', 2, 'not a repo or missing argument'])
rows.push(['build', ['build'], 'repo', 2, 'no build command configured'])
rows.push(['root', ['root', 'bogus-action'], 'repo', 2, 'bad action'])
rows.push(['ai', ['ai', 'bogus-action'], 'repo', 2, 'bad action'])

describe('every command exits with a code of the one table', () => {
  test('the table itself is the nine codes, each with a meaning', () => {
    expect(EXIT_ALLOWED).toEqual([0, 1, 2, 3, 4, 70, 75, 124, 130])
    for (const r of EXIT_TABLE) expect(r.meaning.length).toBeGreaterThan(10)
  })

  test.each(rows.filter((r) => !HEAVY.has(r[0]) || r[4] === 'help' || r[4] === 'bad flag'))('%s: %s (%j)', (command, args, where, expected, case_) => {
    void command
    void case_
    const r = run(args, where)
    expect(r.error?.message ?? '').toBe('') // it finished inside the time limit
    expect(EXIT_ALLOWED).toContain(r.status) // never a number the table does not have
    expect(r.status).toBe(expected) // and the code that matches the case
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/\n\s+at [^\n]+\.m?js:\d+/) // no stack trace for a normal outcome
  })

  test('--help of every command lists the table, one line per code, in the table words', () => {
    for (const n of names) {
      const text = run([n, '--help'], 'repo').stdout
      for (const line of exitLines()) expect(text, `meerkat ${n} --help is missing: ${line}`).toContain(line)
    }
  }, 600000)

  test('no command promises a code the table does not have, in its help or its usage', () => {
    for (const c of COMMANDS as { name: string; output: string; usage: string[]; options: { text: string }[] }[]) {
      const prose = [c.output, ...c.usage, ...c.options.map((o) => o.text)].join('\n')
      for (const m of prose.matchAll(/\b[Ee]xit(?: code)?s?\b([^.;]*)/g)) {
        for (const n of m[1].matchAll(/(?<![\w.-])(\d{1,3})(?![\w.-]|\s*(?:commits|files|seconds|minutes|s\b|ms|lines|rows))/g)) {
          expect(EXIT_ALLOWED, `meerkat ${c.name} mentions exit ${n[1]} (in: "exit${m[1].trim().slice(0, 60)}")`).toContain(Number(n[1]))
        }
      }
    }
  })
})
