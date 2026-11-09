// meerkat fix: the rules, and the whole path on a real fixture repository (a real run of the sql-concat check, then fix dry-run, apply, re-run, stale refusal).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { runFix, unifiedDiff } from './fix.mjs'
// @ts-expect-error plain .mjs module
import { FIX_RULES } from './fixrules.mjs'

const rule = FIX_RULES['sql-concat']
const pg = "const { Pool } = require('pg')\n"
const my = "const mysql = require('mysql2')\n"

describe('sql-concat fix rule', () => {
  test('template literal with pg gets $1', () => {
    const line = 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)'
    expect(rule({ line, text: pg + line }).to).toBe('db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id])')
  })
  test('quoted placeholder loses its quotes, two values numbered in order', () => {
    const line = "await db.query(`SELECT * FROM t WHERE a = '${a}' AND b = ${b}`)"
    expect(rule({ line, text: pg + line }).to).toBe('await db.query(`SELECT * FROM t WHERE a = $1 AND b = $2`, [a, b])')
  })
  test('string concatenation with mysql gets ?', () => {
    const line = 'conn.query("SELECT * FROM u WHERE id = " + id + " AND ok = 1");'
    expect(rule({ line, text: my + line }).to).toBe('conn.query("SELECT * FROM u WHERE id = ? AND ok = 1", [id]);')
  })
  test('refuses: unknown driver, table name, LIKE pattern, expression, existing params, other quotes', () => {
    const t = (line: string, text = pg + line) => rule({ line, text })
    expect(t('db.query(`SELECT * FROM u WHERE id = ${id}`)', 'db.query()').reason).toMatch(/driver/)
    expect(t('db.query(`SELECT * FROM ${table} WHERE id = 1`)').reason).toMatch(/not a place a bound value/)
    expect(t("db.query(`SELECT * FROM u WHERE n LIKE '%${n}%'`)").reason).toMatch(/not a place a bound value/)
    expect(t('db.query(`SELECT * FROM u WHERE id = ${a + b}`)').reason).toMatch(/plain variable/)
    expect(t('db.query(`SELECT * FROM u WHERE id = ${id}`, [1])').reason).toMatch(/more arguments/)
    expect(t('db.query("SELECT * FROM u WHERE id = " + id + \'x\')').reason).toMatch(/quote styles/)
    expect(t('db.query(buildSql())').reason).toBeTruthy()
    expect(t('foo(`SELECT ${a}`)').reason).toMatch(/single db.query/)
  })
  test('unified diff shows only the changed line with context', () => {
    const d = unifiedDiff('a.js', 'a\nb\nc\nd\ne\nf\n', [{ line: 3, to: 'C' }])
    expect(d).toBe('--- a/a.js\n+++ b/a.js\n@@ -1,5 +1,5 @@\n a\n b\n-c\n+C\n d\n e')
  })
})

describe('meerkat fix on a fixture repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'meerkat-fixfix-'))
  const repo = join(root, 'app')
  const logs = join(root, 'logs')
  const env = { ...process.env, MEERKAT_LOG_DIR: logs, MEERKAT_NO_PROJECT_CODE: '1' }
  const BAD = 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)'
  const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8', env })
  const git = (...a: string[]) => sh('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', ...a])
  const scan = () => sh(process.execPath, [join(__dirname, '..', 'run.mjs'), '--app', repo, '--only', 'sql-concat', '--plain'])
  const run = (...argv: string[]) => {
    const o: string[] = []
    const e: string[] = []
    const code = runFix(argv, { env, cwd: repo, out: (t: string) => o.push(t), err: (t: string) => e.push(t) })
    return { code, out: o.join('\n'), err: e.join('\n') }
  }
  beforeAll(() => {
    sh('git', ['init', '-q', '-b', 'main', repo])
    writeFileSync(join(repo, 'meerkat.config.json'), '{"packs":["security-plus"]}\n')
    writeFileSync(join(repo, 'db.js'), `${pg}const db = new Pool()\n${BAD}\n`)
    git('add', '-A')
    git('commit', '-q', '-m', 'init')
  }, 60000)
  afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

  test('dry-run prints a diff and changes nothing; apply fixes it; the re-run no longer reports it; a changed file is refused', () => {
    const first = scan()
    expect(first.stdout).toContain('findings: 1 high')
    const before = readFileSync(join(repo, 'db.js'), 'utf8')

    const dry = run()
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('-db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)')
    expect(dry.out).toContain('+db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id])')
    expect(dry.out).toContain('dry run: nothing was changed')
    expect(readFileSync(join(repo, 'db.js'), 'utf8')).toBe(before)
    expect(run('--dry-run').code).toBe(0)
    expect(readFileSync(join(repo, 'db.js'), 'utf8')).toBe(before)

    // Changed after the run: refused, file untouched.
    const edited = before.replace('req.params.id', 'req.params.uid')
    writeFileSync(join(repo, 'db.js'), edited)
    const stale = run('--apply')
    expect(stale.code).toBe(2)
    expect(stale.out).toContain('refused')
    expect(stale.out).toContain('changed since the run')
    expect(readFileSync(join(repo, 'db.js'), 'utf8')).toBe(edited)

    // Back to what the run saw: apply writes it.
    writeFileSync(join(repo, 'db.js'), before)
    const ok = run('--apply')
    expect(ok.code).toBe(0)
    expect(ok.out).toContain('applied 1 change(s) to db.js')
    const after = readFileSync(join(repo, 'db.js'), 'utf8')
    expect(after).toBe(before.replace(BAD, 'db.query(`SELECT * FROM users WHERE id = $1`, [req.params.id])'))

    const second = scan()
    expect(second.stdout).not.toContain('findings: 1 high')
    expect(second.stdout).toContain('findings: none')
  }, 120000)

  test('a finding whose check has no safe fix says why and exits 2; an unknown id exits 2', () => {
    writeFileSync(join(repo, 'db.js'), `const db = require('some-orm')\n${BAD}\n`)
    git('add', '-A')
    git('commit', '-q', '-m', 'second')
    scan()
    const r = run()
    expect(r.code).toBe(2)
    expect(r.out).toContain('no automatic fix: the database driver is not pg, mysql or sqlite')
    expect(readFileSync(join(repo, 'db.js'), 'utf8')).toContain('${req.params.id}')
    expect(run('zzzzzzzz').code).toBe(2)
    expect(run('--apply', '--dry-run').code).toBe(2)
  }, 120000)
})
