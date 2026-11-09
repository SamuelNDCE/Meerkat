// `meerkat memory` (lib/memory.mjs, the generic hook) and the vault adapter in examples/ (export.mjs).
// The adapter is tested on a temporary vault folder; nothing here touches a real vault.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { ADAPTERS, runMemory } from '../lib/memory.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const adapter: any = await import('../examples/neuralvault/export.mjs')

const made: string[] = []
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
const temp = (what: string) => {
  const d = mkdtempSync(join(tmpdir(), `meerkat-${what}-`))
  made.push(d)
  return d
}
// Built at run time so this file holds no secret-shaped text of its own (Meerkat scans itself).
const KEY = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('')
const PASSWORD = ['hunter2', 'hunter2', 'xyz'].join('')
const TOKEN = ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('')

type F = Record<string, unknown>
function writeRun(dir: string, o: { id?: string; pass?: number; fail?: number; findings?: F[]; map?: boolean; exitCode?: number } = {}) {
  const run = join(dir, o.id ?? '20261107-100000-quick--demo')
  mkdirSync(run, { recursive: true })
  const findings = o.findings ?? [
    { id: 'aaaaaaaaaaaaaaaa', severity: 'high', title: 'Hard-coded key', message: 'Hard-coded key', check: 'secret-scan', rule: 'aws-key', file: 'src/a.js', line: 3, status: 'new', evidence: `const k = "${KEY}"`, rawOutput: [`password = "${PASSWORD}"`] },
    { id: 'bbbbbbbbbbbbbbbb', severity: 'low', title: `Leaked ${KEY} in a title`, message: `token ${TOKEN}`, check: 'x-check', rule: null, file: 'C:\\Users\\someone\\private\\file.env', line: 0, status: 'known' },
    { id: 'cccccccccccccccc', severity: 'medium', title: `config password = "${PASSWORD}"`, message: 'm', check: 'y-check', rule: 'r', file: null, line: null, status: 'known' },
  ]
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<string, number>
  for (const f of findings) bySeverity[String(f.severity)]++
  writeFileSync(join(run, 'findings.json'), JSON.stringify({ schemaVersion: 1, meerkat: { version: '9.9.9' }, run: { id: o.id ?? '20261107-100000-quick--demo' }, counts: { total: findings.length, bySeverity, new: 1, known: findings.length - 1, fixed: 0 }, findings, fixed: [], notRun: [] }))
  writeFileSync(join(run, 'summary.json'), JSON.stringify({ schema: 1, version: '9.9.9', preset: 'quick', tier: 'fast', exitCode: o.exitCode ?? 1, endedAt: '2026-11-07T10:00:05.000Z', ms: 5000, counts: { pass: o.pass ?? 7, fail: o.fail ?? 2, notRun: 1 }, results: [{ id: 'secret-scan', status: 'FAIL', detail: `found ${KEY}` }, { id: 'lint', status: 'FAIL', detail: 'two lint errors' }, { id: 'ok', status: 'PASS', detail: 'fine' }] }))
  if (o.map !== false) writeFileSync(join(run, 'codemap.json'), JSON.stringify({ schemaVersion: 1, app: { name: 'demo' }, summary: { files: 12, lines: 900, languages: { js: 10, md: 2 }, imports: 30, localImports: 20, externalImports: 8, unresolvedImports: 2 }, modules: [{ id: 'src', fileCount: 8, lines: 600 }, { id: 'lib', fileCount: 4, lines: 300 }] }))
  return run
}
const vaultWith = () => {
  const v = temp('vault')
  mkdirSync(join(v, 'wiki', 'projects'), { recursive: true })
  return v
}
const NOTE = (v: string) => join(v, 'wiki', 'projects', 'demo', 'meerkat-status.md')

describe('neuralvault adapter: writing the note', () => {
  test('writes one note into a temporary vault with frontmatter, counts, findings, the code map and a first-export line', () => {
    const v = vaultWith()
    const runs = temp('runs')
    const run = writeRun(runs)
    const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: run, env: { NV_VAULT_PATH: v }, now: new Date('2026-11-07T12:00:00Z') })
    expect(r.ok).toBe(true)
    expect(r.written).toBe(true)
    expect(r.file).toBe('wiki/projects/demo/meerkat-status.md')
    expect(r.rows).toEqual({ results: 10, findings: 3, failedChecks: 2, mapModules: 2, kept: 0 })
    const text = readFileSync(NOTE(v), 'utf8')
    expect(text).toMatch(/^---\ntitle: "Meerkat status: demo"\ntype: meerkat-report\nstatus: current\nproject: demo\ncreated: 2026-11-07\nupdated: 2026-11-07\nsource_run: 20261107-100000-quick--demo\n/)
    expect(text).toContain('| Checks passed | 7 |')
    expect(text).toContain('| Checks failed | 2 |')
    expect(text).toContain('3 open: critical 0, high 1, medium 1, low 1, info 0.')
    expect(text).toContain('12 source files, 900 lines (js 10, md 2)')
    expect(text).toContain('| src | 8 | 600 |')
    expect(text).toContain('## What changed since last export')
    expect(text).toContain('This is the first export')
    expect(readdirSync(join(v, 'wiki', 'projects', 'demo'))).toEqual(['meerkat-status.md'])
  })

  test('a second export says what changed: new run, count changes, new and gone findings', () => {
    const v = vaultWith()
    const runs = temp('runs')
    const env = { NV_VAULT_PATH: v }
    const app = join(temp('app'), 'demo')
    adapter.exportMemory({ appDir: app, runDir: writeRun(runs, { id: 'run-one' }), env, now: new Date('2026-11-06T09:00:00Z') })
    const second = writeRun(runs, { id: 'run-two', pass: 9, fail: 0, exitCode: 0, findings: [{ id: 'dddddddddddddddd', severity: 'medium', title: 'A new thing', check: 'c', rule: null, file: 'b.js', line: 1, status: 'new' }] })
    const r = adapter.exportMemory({ appDir: app, runDir: second, env, now: new Date('2026-11-07T09:00:00Z') })
    expect(r.ok).toBe(true)
    const text = readFileSync(NOTE(v), 'utf8')
    expect(text).toContain('created: 2026-11-06')
    expect(text).toContain('updated: 2026-11-07')
    expect(text).toContain('Run changed from run-one to run-two.')
    expect(text).toContain('| Checks passed | 9 (+2 since the last export) |')
    expect(text).toContain('| Checks failed | 0 (-2 since the last export) |')
    expect(text).toContain('Open findings 3 to 1.')
    expect(text).toContain('New findings: 1.')
    expect(text).toContain('dddddddddddddddd A new thing')
    expect(text).toContain('Gone findings: 3.')
    expect(text).toContain('aaaaaaaaaaaaaaaa Hard-coded key')
  })

  test('a run with no code map or findings file still exports, and says so', () => {
    const v = vaultWith()
    const run = writeRun(temp('runs'), { map: false })
    rmSync(join(run, 'findings.json'))
    const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: run, env: { NV_VAULT_PATH: v } })
    expect(r.ok).toBe(true)
    const text = readFileSync(NOTE(v), 'utf8')
    expect(text).toContain('No code map in this run')
    expect(text).toContain('no findings summary')
    expect(r.rows.mapModules).toBe(0)
  })

  test('--dry-run reports the rows and writes nothing', () => {
    const v = vaultWith()
    const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: writeRun(temp('runs')), env: { NV_VAULT_PATH: v }, dryRun: true })
    expect(r.ok).toBe(true)
    expect(r.written).toBe(false)
    expect(existsSync(NOTE(v))).toBe(false)
    expect(adapter.summaryLine(r)).toContain('would write wiki/projects/demo/meerkat-status.md')
  })

  test('lines marked as corrections in the old note survive a rewrite', () => {
    const v = vaultWith()
    const env = { NV_VAULT_PATH: v }
    const app = join(temp('app'), 'demo')
    const runs = temp('runs')
    adapter.exportMemory({ appDir: app, runDir: writeRun(runs, { id: 'r1' }), env })
    writeFileSync(NOTE(v), `${readFileSync(NOTE(v), 'utf8')}\nThe API is in Go. \\*\n> \\*Corrected 2026-11-07: it is in Rust.\n`)
    const r = adapter.exportMemory({ appDir: app, runDir: writeRun(runs, { id: 'r2' }), env })
    expect(r.rows.kept).toBe(2)
    const text = readFileSync(NOTE(v), 'utf8')
    expect(text).toContain('The API is in Go. \\*')
    expect(text).toContain('> \\*Corrected 2026-11-07: it is in Rust.')
  })

  test('the vault folder comes from ~/.neuralvault-vault-path when NV_VAULT_PATH is not set, and from nowhere else', () => {
    const v = vaultWith()
    const home = temp('home')
    expect(adapter.vaultFolder({ env: {}, home }).ok).toBe(false)
    expect(adapter.vaultFolder({ env: {}, home }).reason).toContain('NV_VAULT_PATH')
    writeFileSync(join(home, '.neuralvault-vault-path'), `${v}\nsecond line ignored\n`)
    expect(adapter.vaultFolder({ env: {}, home }).ok).toBe(true)
    expect(adapter.vaultFolder({ env: { NV_VAULT_PATH: join(v, 'missing') }, home }).ok).toBe(false)
    const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: writeRun(temp('runs')), env: {}, home })
    expect(r.ok).toBe(true)
    expect(existsSync(NOTE(v))).toBe(true)
  })
})

describe('neuralvault adapter: staying inside the vault', () => {
  const tryNote = (note: string) => {
    const v = vaultWith()
    const outside = temp('outside')
    const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: writeRun(temp('runs')), env: { NV_VAULT_PATH: v }, note })
    return { r, v, outside }
  }

  test.each(['../escape.md', 'wiki/../../escape.md', 'wiki/projects/../../../escape.md'])('refuses the path %s and writes nothing anywhere', (note) => {
    const { r, v } = tryNote(note)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/outside the vault/)
    expect(existsSync(join(v, '..', 'escape.md'))).toBe(false)
    expect(readdirSync(join(v, 'wiki', 'projects'))).toEqual([])
  })

  test('refuses an absolute path, even one that points inside the vault, and a note that is not .md', () => {
    const v = vaultWith()
    const abs = join(v, 'wiki', 'projects', 'x.md')
    for (const note of [abs, join(tmpdir(), 'elsewhere.md'), 'C:\\Windows\\x.md', '//server/share/x.md']) {
      const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: writeRun(temp('runs')), env: { NV_VAULT_PATH: v }, note })
      expect(r.ok, note).toBe(false)
    }
    expect(existsSync(abs)).toBe(false)
    const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: writeRun(temp('runs')), env: { NV_VAULT_PATH: v }, note: 'wiki/projects/x.txt' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('.md')
  })

  test('refuses a folder inside the vault that is a link leading outside it', () => {
    const v = vaultWith()
    const outside = temp('outside')
    try {
      symlinkSync(outside, join(v, 'wiki', 'linked'), 'junction')
    } catch {
      return // this machine cannot make links: nothing to test
    }
    const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: writeRun(temp('runs')), env: { NV_VAULT_PATH: v }, note: 'wiki/linked/n.md' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/outside the vault/)
    expect(readdirSync(outside)).toEqual([])
  })

  test('refuses a vault that does not exist or is a drive root, and a project with no run yet', () => {
    expect(adapter.exportMemory({ appDir: '.', runDir: writeRun(temp('runs')), env: { NV_VAULT_PATH: join(tmpdir(), 'no-such-vault-folder') } }).ok).toBe(false)
    expect(adapter.vaultFolder({ env: { NV_VAULT_PATH: process.platform === 'win32' ? 'C:\\' : '/' } }).ok).toBe(false)
    const none = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: join(temp('runs'), 'nothing-here'), env: { NV_VAULT_PATH: vaultWith() } })
    expect(none.ok).toBe(false)
    expect(none.reason).toContain('no run')
  })
})

describe('neuralvault adapter: no secret reaches the vault', () => {
  test('values planted in findings, check details and paths never appear in the note, and no machine path does either', () => {
    const v = vaultWith()
    const r = adapter.exportMemory({ appDir: join(temp('app'), 'demo'), runDir: writeRun(temp('runs')), env: { NV_VAULT_PATH: v } })
    expect(r.ok).toBe(true)
    const text = readFileSync(NOTE(v), 'utf8')
    for (const secret of [KEY, PASSWORD, TOKEN, 'ABCDEFGHIJKLMNOP']) expect(text).not.toContain(secret)
    expect(text).toContain('<redacted>')
    expect(text).not.toContain('evidence')
    expect(text).not.toContain('rawOutput')
    expect(text).not.toContain('C:\\Users')
    expect(text).not.toContain('someone')
    expect(text).toContain('file.env') // an absolute path is cut to its file name
  })

  test('if a secret still gets into the note by another way, the adapter refuses to write it', () => {
    const v = vaultWith()
    const env = { NV_VAULT_PATH: v }
    const app = join(temp('app'), 'demo')
    const runs = temp('runs')
    adapter.exportMemory({ appDir: app, runDir: writeRun(runs, { id: 'r1' }), env })
    const before = readFileSync(NOTE(v), 'utf8')
    writeFileSync(NOTE(v), `${before}\nA kept line with a key ${KEY}. \\*\n`)
    const r = adapter.exportMemory({ appDir: app, runDir: writeRun(runs, { id: 'r2' }), env })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('secret-like')
    expect(readFileSync(NOTE(v), 'utf8')).toContain('A kept line with a key') // untouched, not half-written
    expect(readdirSync(join(v, 'wiki', 'projects', 'demo')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  test('clean() blanks a whole field that holds a secret and escapes table bars and control characters', () => {
    expect(adapter.clean(`k ${KEY}`)).toBe('<redacted>')
    expect(adapter.clean('a | b\u0007\nc')).toBe('a \\| b c')
    expect(adapter.clean('x'.repeat(500), 20)).toHaveLength(20)
  })
})

describe('meerkat memory: the generic hook', () => {
  const appWith = (config: object | null) => {
    const a = temp('app')
    writeFileSync(join(a, 'package.json'), '{"name":"demo"}\n')
    if (config) writeFileSync(join(a, 'meerkat.config.json'), JSON.stringify(config))
    return a
  }
  const call = async (argv: string[], env: Record<string, string>) => {
    const out: string[] = []
    const err: string[] = []
    const code = await runMemory(['memory', ...argv], { env, cwd: tmpdir(), out: (t: string) => out.push(t), err: (t: string) => err.push(t) })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }

  test('with no "memory" key it loads nothing, writes nothing and says how to turn it on', async () => {
    const v = vaultWith()
    const app = appWith({ packs: ['security'] })
    const r = await call(['--app', app, '--run', writeRun(temp('runs'))], { NV_VAULT_PATH: v })
    expect(r.code).toBe(2)
    expect(r.err).toContain('"memory"')
    expect(readdirSync(join(v, 'wiki', 'projects'))).toEqual([])
  })

  test('with the adapter configured it writes the note, and --dry-run writes none', async () => {
    const v = vaultWith()
    const app = appWith({ packs: ['security'], memory: { adapter: 'neuralvault', project: 'demo' } })
    const run = writeRun(temp('runs'))
    const dry = await call(['--app', app, '--run', run, '--dry-run'], { NV_VAULT_PATH: v })
    expect(dry.code).toBe(0)
    expect(existsSync(NOTE(v))).toBe(false)
    const r = await call(['--app', app, '--run', run], { NV_VAULT_PATH: v })
    expect(r.code).toBe(0)
    expect(r.out).toContain('wrote wiki/projects/demo/meerkat-status.md: 10 check results, 3 findings, 2 failed checks, 2 map modules')
    expect(statSync(NOTE(v)).isFile()).toBe(true)
  })

  test('a config cannot move the vault: only project and note are passed on, and the note stays inside', async () => {
    const v = vaultWith()
    const other = vaultWith()
    const app = appWith({ memory: { adapter: 'neuralvault', project: 'demo', vaultPath: other, note: '../escape.md' } })
    const r = await call(['--app', app, '--run', writeRun(temp('runs'))], { NV_VAULT_PATH: v })
    expect(r.code).toBe(1)
    expect(r.err).toContain('outside the vault')
    expect(readdirSync(join(other, 'wiki', 'projects'))).toEqual([])
    expect(readdirSync(join(v, 'wiki', 'projects'))).toEqual([])
  })

  test('an unknown adapter name, a malformed memory key and an unknown option are refused', async () => {
    const run = writeRun(temp('runs'))
    expect((await call(['--app', appWith({ memory: { adapter: 'nope' } }), '--run', run], {})).code).toBe(2)
    expect((await call(['--app', appWith({ memory: 'neuralvault' }), '--run', run], {})).code).toBe(2)
    expect((await call(['--bogus'], {})).code).toBe(2)
  })
})

describe('the generic code does not name the adapter', () => {
  const SKIP = new Set(['node_modules', '.git', 'fixtures', 'examples'])
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.mjs$/.test(e.name)) out.push(relative(ROOT, p).split('\\').join('/'))
    }
    return out
  }
  // Files that named the app before the memory hook existed (checked 2026-11-07). They are not the hook, and this list must only shrink.
  const BEFORE: string[] = []

  test('in run.mjs, bin/, lib/, packs/ and thorough/ no file names the app; the adapter table is read from examples/*/pack.json', () => {
    const files = ['run.mjs', ...walk(join(ROOT, 'bin')), ...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'packs')), ...walk(join(ROOT, 'thorough'))].map((f) => f.replace(/^\.\.\//, ''))
    const hits = new Map<string, string[]>()
    for (const f of files) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/).filter((l) => /neuralvault/i.test(l))
      if (lines.length) hits.set(f, lines)
    }
    const names = [...hits.keys()].filter((f) => !BEFORE.includes(f)).sort()
    expect(names).toEqual([])
    expect(ADAPTERS).toEqual({ neuralvault: 'examples/neuralvault/export.mjs' })
    // The profiles and the files that carry the hook into the command line are generic too.
    for (const f of readdirSync(join(ROOT, 'profiles'))) expect(readFileSync(join(ROOT, 'profiles', f), 'utf8')).not.toMatch(/neuralvault/i)
    for (const f of ['lib/workflow-profiles.mjs', 'lib/extras-cli.mjs', 'lib/extras-words.mjs', 'lib/help.mjs', 'bin/meerkat.mjs', 'lib/config.mjs']) expect(readFileSync(join(ROOT, f), 'utf8'), f).not.toMatch(/neuralvault/i)
  })

  test('the adapter file holds no machine path and no fixed vault location', () => {
    const text = readFileSync(join(ROOT, 'examples', 'neuralvault', 'export.mjs'), 'utf8')
    expect(text).not.toMatch(/[A-Za-z]:[\\/]Users|\/Users\/|\/home\/|sample-vault/)
  })
})
