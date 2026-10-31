// The security-plus checks (thorough/sec-code.mjs): each check fails on its own fixture, passes on a clean folder that holds the
// safe shape of the same code, and the pack loads with no broken check file.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from '../lib/load-checks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCRIPT = 'thorough/sec-code.mjs'

const SAFE: Record<string, Record<string, string>> = {
  'cors-wildcard': { 'api.js': "const allowed = ['https://app.example.com']\nif (allowed.includes(req.headers.origin)) res.setHeader('Access-Control-Allow-Origin', req.headers.origin)\n" },
  'cookie-flags': { 'app.js': "res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax' })\n" },
  'jwt-weak': { 'auth.js': "const t = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })\n" },
  'hardcoded-ip': { 'server.js': "const host = process.env.UPSTREAM_HOST\nconst lan = '10.0.0.5'\nconst doc = '203.0.113.9'\n" },
  'debug-enabled': { 'settings.py': "import os\nDEBUG = os.environ.get('DJANGO_DEBUG') == '1'\napp.run(debug=False)\n" },
  'sql-concat': { 'db.js': "db.query('SELECT * FROM users WHERE id = $1', [req.params.id])\n" },
  'path-traversal-pattern': { 'files.js': "const p = path.join(ROOT, path.basename(req.query.name))\nres.sendFile(p)\n", 'write.js': 'fs.writeFileSync(out, req.body.text)\n' },
  'open-redirect-pattern': { 'auth.js': "const ALLOWED = ['/home']\nres.redirect(ALLOWED.includes(req.query.next) ? req.query.next : '/home')\n" },
  'regex-dos': { 'pattern.js': "const digits = /^[0-9]+$/\nconst word = new RegExp('^[a-z]{3,}$')\n", 'rule.js': "const rule = /^\\s*([-*_]\\s*){3,}$/gm\n" },
  'weak-crypto-modes': { 'crypto.js': "const c = crypto.createCipheriv('aes-256-gcm', key, iv)\nconst t = crypto.randomBytes(16).toString('hex')\n", 'msg.js': "const msg = 'Math.random() for something secret'\n" },
  'credentials-in-urls': { 'db.js': "const url = process.env.DATABASE_URL\nconst example = 'postgres://user:password@localhost:5432/app'\n" },
  'xxe-and-deserialize': { 'parse.py': 'parser = etree.XMLParser(resolve_entities=False)\n' },
}
const IDS = Object.keys(SAFE)

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// Runs the check script and returns its exit code (0 clean, 1 findings, anything else is a crash) and its output.
function runCheck(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-seccode-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

describe('security-plus checks', () => {
  test('there are twelve checks with a safe shape each', () => {
    expect(IDS.length).toBe(12)
  })

  for (const id of IDS) {
    test(`${id} fails on its own fixture`, () => {
      // "found N" proves the rule reported its finding; a crash exits 1 too, so the exit code alone is not enough.
      const r = runCheck([id, '--fixtures'])
      expect(r.code, r.out).toBe(1)
      expect(r.out).toMatch(/found \d+/)
    })
    test(`${id} passes on a clean folder with the safe shape`, () => {
      const r = runCheck([id, '--root', folderWith(SAFE[id])])
      expect(r.code, r.out).toBe(0)
    })
  }
})

describe('the security-plus pack loads', () => {
  test('every check loads, has a unique id, and self-tests as expected', async () => {
    const checks: any[] = await loadChecks(join(ROOT, 'packs', 'security-plus'))
    const ids = checks.map((c) => c.id)
    for (const id of IDS) expect(ids, id).toContain(id)
    expect(ids.filter((id) => id.startsWith('bad-check-file'))).toEqual([])
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of checks.filter((c) => IDS.includes(c.id))) {
      expect(c.lane, c.id).toBe('free')
      expect(c.selfTest.expectFail, c.id).toBe(true)
    }
  })
})
