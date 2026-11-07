// sql-concat: a join inside the bound-values array of a parameterised call is not SQL injection; a join in the statement itself still is.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

function scan(body: string): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-sqlarr-'))
  made.push(dir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 's.ts'), body)
  try {
    return { code: 0, out: execFileSync(process.execPath, ['thorough/sec-code.mjs', 'sql-concat', '--root', dir], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

describe('sql-concat and the bound-values array', () => {
  test('a LIKE wildcard built in the params array is quiet', () => {
    expect(scan("const r = await db.query('SELECT * FROM users WHERE name LIKE $1', ['%' + name + '%'])\n").code).toBe(0)
  })
  test('the e2e decoy (constant table name plus a wildcard in the params) is quiet', () => {
    expect(scan("const TABLE = 'products'\nconst r = await db.query('SELECT * FROM ' + TABLE + ' WHERE name ILIKE $1', ['%' + String(req.query.q) + '%'])\n").code).toBe(0)
  })
  test('a constant table name joined into the statement is not flagged', () => {
    expect(scan("const TABLE = 'orders'\nconst r = await db.query('SELECT * FROM ' + TABLE + ' WHERE id = 5')\n").code).toBe(0)
  })
  test('the request id concatenated into the statement is still flagged', () => {
    const r = scan(`const rows = await db.query("SELECT id, name, email FROM users WHERE id = '" + req.params.id + "'")\n`)
    expect(r.code, r.out).toBe(1)
  })
  test('a template literal with an interpolated id is still flagged', () => {
    const r = scan('const rows = await db.query(`SELECT id FROM users WHERE id = ${req.params.id}`)\n')
    expect(r.code, r.out).toBe(1)
  })
  test('a join in the statement is still flagged even when a params array follows', () => {
    const r = scan("const rows = await db.query('SELECT * FROM users WHERE name = ' + name + ' AND x = $1', ['%' + name + '%'])\n")
    expect(r.code, r.out).toBe(1)
  })
})
