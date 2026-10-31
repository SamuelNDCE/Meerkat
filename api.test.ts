// The API checks (thorough/api.mjs): each check must fail on its own fixture, pass on a clean folder, and the api pack must load.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/api.mjs'
const ALL = [
  'openapi-valid',
  'openapi-operation-ids',
  'openapi-security-defined',
  'graphql-schema-basics',
  'sql-migrations-order',
  'sql-destructive-migrations',
  'sql-missing-index-note',
  'prisma-schema-basics',
  'http-timeouts',
  'rate-limit-present',
  'error-leak',
  'pagination-bounds',
]

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 clean, 1 findings, anything else is a crash).
function exitCodeOf(args: string[]): number {
  try {
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe' })
    return 0
  } catch (e: any) {
    return e.status ?? -1
  }
}

// One small project with clean code in every shape the API checks look at.
function cleanFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-api-'))
  made.push(dir)
  const put = (name: string, body: string) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  put(
    'openapi.json',
    '{"openapi":"3.0.3","info":{"title":"Clean API","version":"1.0.0"},"servers":[{"url":"https://api.example.com"}],"security":[{"bearer":[]}],' +
      '"paths":{"/items":{"get":{"operationId":"listItems","responses":{"200":{"description":"ok"}}}}},' +
      '"components":{"securitySchemes":{"bearer":{"type":"http","scheme":"bearer"}}}}\n',
  )
  put('schema.graphql', 'type Query {\n  items: [Item]\n}\n\ntype Item {\n  id: ID!\n}\n')
  put('migrations/001_init.sql', 'CREATE TABLE users (\n  id INT PRIMARY KEY\n);\n')
  put('migrations/002_orders.sql', 'CREATE TABLE orders (\n  id INT PRIMARY KEY,\n  user_id INT REFERENCES users (id)\n);\n')
  put('migrations/003_cleanup.sql', 'DELETE FROM orders WHERE id = 1;\n')
  put('prisma/schema.prisma', 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n\nmodel User {\n  id Int @id @default(autoincrement())\n}\n')
  put('src/client.js', 'export const load = (url) => fetch(url, { signal: AbortSignal.timeout(5000) })\n')
  put(
    'src/server.js',
    "import express from 'express'\nimport rateLimit from 'express-rate-limit'\n\nconst app = express()\napp.use(rateLimit({ windowMs: 60000, max: 100 }))\napp.get('/items', (req, res) => {\n  const limit = Math.min(Number(req.query.limit) || 20, 100)\n  res.status(500).json({ error: 'internal', limit })\n})\n",
  )
  return dir
}

describe('api checks fail on their own fixture', () => {
  for (const check of ALL) {
    test(`${check} reports its deliberate problem`, () => {
      expect(exitCodeOf([check, '--fixtures'])).toBe(1)
    })
  }
})

describe('api checks pass on a clean folder', () => {
  const dir = cleanFolder()
  for (const check of ALL) {
    test(`${check} is clean`, () => {
      expect(exitCodeOf([check, '--root', dir])).toBe(0)
    })
  }
})

describe('the api pack', () => {
  test('loads 12 checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'api'))
    expect(checks.filter((c) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks).toHaveLength(12)
    expect(checks.map((c) => c.id).sort()).toEqual([...ALL].sort())
  })
})
