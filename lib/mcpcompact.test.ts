// 0.7.0: compact MCP output by default, meerkat_first_failure, and descriptions up to 300 characters.
// The stdio cases start the real server (bin/meerkat-mcp.mjs) in a scratch git repository with a 200-finding change.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const ROOT = resolve(__dirname, '..')
const root = mkdtempSync(join(tmpdir(), 'meerkat-070-'))
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') } as NodeJS.ProcessEnv
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const sqlLines = (n: number) => Array.from({ length: n }, (_, i) => `export function f${i}(db, n) { return db.query("SELECT * FROM users WHERE name = " + n) }`).join('\n') + '\n'
const repo = (name: string, change: (d: string) => void) => {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'package.json', '{"name":"fx","version":"1.0.0","private":true,"main":"index.js"}')
  put(d, 'index.js', ["import './src/ok.js'", "import './src/old.js'", ''].join('\n'))
  put(d, 'src/old.js', sqlLines(5))
  put(d, 'src/ok.js', 'export const ok = 1\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feat')
  change(d)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'change')
  return d
}

type Reply = { result?: { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown>; tools?: { name: string; description: string }[] } }
// A real server process: one JSON-RPC message per line on stdin, one reply per line on stdout.
function startServer(cwd: string) {
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'meerkat-mcp.mjs')], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  const waiting = new Map<number, (r: Reply) => void>()
  let buf = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (c: string) => {
    buf += c
    let i = buf.indexOf('\n')
    while (i >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) {
        const m = JSON.parse(line)
        waiting.get(m.id)?.(m)
        waiting.delete(m.id)
      }
      i = buf.indexOf('\n')
    }
  })
  let n = 0
  const call = (method: string, params: unknown = {}) =>
    new Promise<Reply>((res, rej) => {
      n += 1
      const id = n
      const t = setTimeout(() => rej(new Error(`${method} timed out`)), 240000)
      waiting.set(id, (r) => {
        clearTimeout(t)
        res(r)
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  const tool = (name: string, args: unknown = {}) => call('tools/call', { name, arguments: args })
  return { call, tool, close: () => child.kill() }
}

let big: string
let small: string
let srv: ReturnType<typeof startServer>
beforeAll(async () => {
  big = repo('big', (d) => put(d, 'src/new.js', sqlLines(200)))
  small = repo('small', (d) => put(d, 'src/ok.js', 'export const ok = 2\n'))
  srv = startServer(root)
  await srv.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } })
}, 60000)
// The server runs in the scratch folder, so it must be gone before the folder can be deleted (Windows keeps a working directory locked).
afterAll(async () => {
  srv?.close()
  await new Promise((r) => setTimeout(r, 1000))
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
})

describe('every tool description', () => {
  test('is up to 300 characters and says what the tool returns', async () => {
    const r = await srv.call('tools/list')
    const tools = r.result?.tools ?? []
    expect(tools.length).toBeGreaterThan(30)
    for (const t of tools) {
      expect(t.description.length, `${t.name} is ${t.description.length} characters`).toBeLessThanOrEqual(300)
      expect(t.description.length, `${t.name} has no description`).toBeGreaterThan(20)
    }
  })

  test('--list-tools shows meerkat_first_failure, and tools/list agrees', async () => {
    const list = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'bin', 'meerkat-mcp.mjs'), '--list-tools'], { encoding: 'utf8' }))
    expect(list.tools).toContain('meerkat_first_failure')
    const r = await srv.call('tools/list')
    expect((r.result?.tools ?? []).map((t) => t.name).sort()).toEqual([...list.tools].sort())
  })
})

describe('compact output over stdio, 200-finding fixture', () => {
  test('meerkat_gate is compact by default: a count line, at most 10 items, the log path, under 2 KB; full: true is bigger', async () => {
    const d = await srv.tool('meerkat_gate', { folder: big, base: 'main' })
    const text = d.result!.content[0].text
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^meerkat_gate: (ok|error)\b.*blocking \d+, pre-existing \d+, passed \d+, failed \d+/)
    expect(lines.length).toBeLessThanOrEqual(13)
    expect(text).toMatch(/log: .*runs/)
    expect(Buffer.byteLength(text)).toBeLessThan(2048)
    expect(Buffer.byteLength(JSON.stringify(d.result))).toBeLessThan(3500)
    const f = await srv.tool('meerkat_gate', { folder: big, base: 'main', full: true })
    expect(f.result!.content[0].text.length).toBeGreaterThan(text.length)
  }, 300000)

  test('meerkat_findings is compact by default and lists findings as check file:line message', async () => {
    const d = await srv.tool('meerkat_findings', { folder: big })
    const text = d.result!.content[0].text
    const lines = text.split('\n')
    const items = lines.filter((l) => /sql-concat src\/new\.js:\d+/.test(l))
    expect(lines[0]).toMatch(/^meerkat_findings: ok\b.*blocking \d+/)
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(10)
    expect(Buffer.byteLength(text)).toBeLessThan(2048)
    const f = await srv.tool('meerkat_findings', { folder: big, full: true, limit: 50 })
    expect(Buffer.byteLength(f.result!.content[0].text)).toBeGreaterThan(Buffer.byteLength(text))
  }, 120000)
})

describe('meerkat_first_failure', () => {
  test('returns exactly one line: file:line check: message for the first blocking finding', async () => {
    const d = await srv.tool('meerkat_first_failure', { folder: big, base: 'main' })
    const text = d.result!.content[0].text
    expect(text.split('\n')).toHaveLength(1)
    expect(text).toMatch(/^src\/new\.js:\d+ sql-concat: .+/)
  }, 300000)

  test('returns PASS when the change has no blocking finding', async () => {
    const d = await srv.tool('meerkat_first_failure', { folder: small, base: 'main' })
    expect(d.result!.content[0].text).toBe('PASS')
  }, 300000)

  test('a bad base is refused without running anything', async () => {
    const d = await srv.tool('meerkat_first_failure', { folder: big, base: '--evil' })
    expect(d.result!.isError).toBe(true)
  })
})

// A finding's message comes from the scanned project, so it is untrusted text: compact items must be redacted and free of control characters.
describe('compact items are redacted', () => {
  test('an ESC sequence and a key-shaped string in a finding message do not reach the output', async () => {
    const mod = await import('./mcp.mjs')
    const key = 'sk_live_' + 'abcdefghijklmnopqrstuvwxyz0123456789'
    const doc = { run: { id: 'r1', project: { name: 'p', path: '/p' } }, findings: [{ id: 'aaaa1111', severity: 'high', check: 'secrets', file: 'src/a.js', line: 3, status: 'new', message: `bad \u001b[31mred\u001b[0m token ${key} end` }] }
    const ctx = {
      version: '1', cwd: '/p', now: () => Date.now(), isDirectory: () => true, realpath: (p: string) => p, roots: () => [],
      latestFindings: () => ({ ok: true, dir: '/logs/r1', doc }),
      runInfo: () => ({ id: 'r1', project: { name: 'p', path: '/p' }, preset: 'quick', exitCode: 1 }),
    }
    const r = await mod.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'meerkat_findings', arguments: {} } }, ctx)
    const all = JSON.stringify(r.result)
    expect(all).not.toContain(key)
    expect(all).not.toContain('\u001b')
    expect(r.result.content[0].text).not.toContain(String.fromCharCode(27))
    expect(r.result.content[0].text).toContain('src/a.js:3')
  })
})
