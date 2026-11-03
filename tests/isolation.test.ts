// Failure isolation (block 10): Meerkat never breaks the app it checks. A bad check is a NOT RUN or an error line, never a crash, and the
// run goes on; the project is never changed; a missing tool is NOT RUN with an install hint; a network check is NOT RUN offline; scratch
// folders are removed however a check ends.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { createControl, runAll, runOne } from '../lib/runner.mjs'
// @ts-expect-error plain JS module
import { generate } from '../tools/fake-apps/index.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
const tmp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  made.push(d)
  return d
}
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})

// SHA-256 over the sorted relative paths and contents of every file under a folder.
function treeHash(dir: string): string {
  const files: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk(dir)
  const h = createHash('sha256')
  for (const f of files.map((p) => relative(dir, p).split('\\').join('/')).sort()) h.update(f).update('\0').update(readFileSync(join(dir, f))).update('\0')
  return h.digest('hex')
}

const baseCtx = (dir: string, env: NodeJS.ProcessEnv = { ...process.env, MEERKAT_LOG_DIR: join(tmpdir(), 'meerkat-iso-logs') }) => ({ timeoutScale: 1, repoRoot: dir, appDir: dir, tier: 'fast', env, platform: process.platform, exists: existsSync, changedFiles: null, disabledSubs: new Map(), findingsSink: new Map(), logDir: null, control: createControl() })
const fn = (id: string, run: (ctx: any) => any, extra: Record<string, unknown> = {}) => ({ id, title: id, group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1, timeoutSeconds: 2, run, ...extra })

describe('a bad check never stops the run', () => {
  test('one that throws, one that hangs past its timeout and one that writes where it must not: each is reported, the next check still runs', async () => {
    const dir = tmp('meerkat-iso-')
    const checks = [
      fn('throws', () => {
        throw new Error('boom from a broken check')
      }),
      fn('hangs', () => new Promise(() => {}), { timeoutSeconds: 1 }),
      fn('writes-outside', () => {
        // a folder that does not exist: the write is refused and the check reports it
        writeFileSync(join(dir, 'no-such-folder', 'x.txt'), 'x')
        return { ok: true, detail: 'wrote' }
      }),
      fn('good', () => ({ ok: true, detail: 'fine' })),
    ]
    const results = await runAll(checks, baseCtx(dir), { log: () => {}, keepGoing: true })
    const by = Object.fromEntries(results.map((r: any) => [r.id, r]))
    expect(by.throws.status).not.toBe('PASS')
    expect(by.throws.detail).toContain('boom')
    expect(by.hangs.status).not.toBe('PASS')
    expect(by.hangs.detail).toMatch(/timed out/)
    expect(by['writes-outside'].status).not.toBe('PASS')
    expect(by.good.status).toBe('PASS')
    expect(results).toHaveLength(4)
  }, 30_000)

  test('a command check that crashes or hangs is also contained, and the following check runs', async () => {
    const dir = tmp('meerkat-iso-')
    writeFileSync(join(dir, 'crash.mjs'), 'process.exit(3)\n')
    writeFileSync(join(dir, 'hang.mjs'), 'setInterval(() => {}, 1000)\n')
    const cmd = (id: string, file: string) => ({ id, title: id, group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1, timeoutSeconds: 2, run: { cmd: 'node', args: [join(dir, file)] } })
    const results = await runAll([cmd('crash', 'crash.mjs'), cmd('hang', 'hang.mjs'), fn('after', () => ({ ok: true, detail: 'ok' }))], baseCtx(dir), { log: () => {}, keepGoing: true })
    expect(results.map((r: any) => r.id)).toEqual(['crash', 'hang', 'after'])
    expect(results[0].status).toBe('FAIL')
    expect(results[1].detail).toMatch(/timed out/)
    expect(results[2].status).toBe('PASS')
  }, 30_000)
})

describe('the project is never changed', () => {
  test('a full quick run on a small project leaves every file as it was', () => {
    const root = tmp('meerkat-iso-proj-')
    const dir = generate('tasks-app', 'clean', join(root, 'p'))
    const before = treeHash(dir)
    const logRoot = join(root, 'logs')
    const r = spawnSync(process.execPath, [join(ROOT, 'run.mjs'), '--app', dir, '--preset', 'quick', '--plain'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, MEERKAT_LOG_DIR: logRoot, MEERKAT_TIMINGS: join(root, 'timings.json'), MEERKAT_PLAIN: '1', NO_COLOR: '1' },
    })
    expect(r.status === null, `the run did not end: ${r.stderr}`).toBe(false)
    expect(existsSync(join(logRoot, 'runs'))).toBe(true)
    expect(treeHash(dir)).toBe(before)
  }, 300_000)
})

describe('a missing tool', () => {
  test('is NOT RUN with the install hint, not a crash (PATH without the tool)', async () => {
    const dir = tmp('meerkat-iso-')
    const empty = tmp('meerkat-emptybin-')
    const env = { ...process.env, PATH: empty, Path: empty }
    const check = fn('needs-tool', () => ({ ok: true, detail: 'ran' }), { needs: ['meerkat-no-such-tool'], install: 'pip install meerkat-no-such-tool' })
    const r = await runOne(check, baseCtx(dir, env))
    expect(r.status).toBe('NOT RUN')
    expect(r.detail).toContain('meerkat-no-such-tool')
    expect(r.detail).toContain('pip install meerkat-no-such-tool')
    const real = fn('needs-git', () => ({ ok: true, detail: 'ran' }), { needs: ['git'], install: 'install git' })
    expect((await runOne(real, baseCtx(dir, env))).status).toBe('NOT RUN')
  })
})

describe('a network check offline', () => {
  test('pip-audit is NOT RUN (exit 75), never a pass, when MEERKAT_DETECTORS_OFFLINE=1', () => {
    const dir = tmp('meerkat-iso-py-')
    writeFileSync(join(dir, 'requirements.txt'), 'requests==2.19.0\n')
    spawnSync('git', ['init', '-q'], { cwd: dir })
    spawnSync('git', ['add', '.'], { cwd: dir })
    const r = spawnSync(process.execPath, [join(ROOT, 'thorough/detectors.mjs'), 'pip-audit-python', '--root', dir], { encoding: 'utf8', env: { ...process.env, MEERKAT_DETECTORS_OFFLINE: '1' } })
    expect(r.status).toBe(75)
    expect(`${r.stdout}${r.stderr}`).toContain('MEERKAT_DETECTORS_OFFLINE=1')
  })
})

describe('scratch folders are cleaned up', () => {
  const leftovers = (root: string) => readdirSync(root).filter((n) => n.startsWith('meerkat-check-'))
  // The temp folder is pointed at a private empty folder for the test, so "nothing left behind" is a plain directory listing.
  const withTempDir = async (body: (scratchRoot: string) => Promise<void>) => {
    const scratchRoot = tmp('meerkat-iso-tmp-')
    const keep: Record<string, string | undefined> = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
    process.env.TEMP = process.env.TMP = process.env.TMPDIR = scratchRoot
    try {
      await body(scratchRoot)
    } finally {
      for (const [k, v] of Object.entries(keep)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }

  test('a check that writes in its scratch folder and finishes leaves nothing behind', async () => {
    await withTempDir(async (scratchRoot) => {
      let seen = ''
      const results = await runAll(
        [
          fn('scratch-ok', (ctx) => {
            seen = ctx.scratchDir
            writeFileSync(join(ctx.scratchDir, 'a.txt'), 'x')
            return { ok: true, detail: 'ok' }
          }),
        ],
        baseCtx(scratchRoot),
        { log: () => {} },
      )
      expect(results[0].status).toBe('PASS')
      expect(seen).not.toBe('')
      expect(leftovers(scratchRoot)).toEqual([])
    })
  })

  test('a command killed on its timeout leaves nothing behind in the temp folder', async () => {
    await withTempDir(async (scratchRoot) => {
      const proj = tmp('meerkat-iso-')
      const script = join(proj, 'slow.mjs')
      writeFileSync(script, "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nwriteFileSync(join(process.env.MEERKAT_SCRATCH, 'partial.bin'), 'half written')\nconsole.log('wrote')\nsetInterval(() => {}, 1000)\n")
      const check = { id: 'killed', title: 'killed', group: 'functionality', tier: 'fast', lane: 'free', estSeconds: 1, timeoutSeconds: 1, run: { cmd: 'node', args: [script] } }
      const results = await runAll([check], baseCtx(proj), { log: () => {} })
      expect(results[0].detail).toMatch(/timed out/)
      expect(leftovers(scratchRoot)).toEqual([])
    })
  }, 30_000)

  test('a function check that throws or times out leaves nothing behind either', async () => {
    await withTempDir(async (scratchRoot) => {
      const mk = (id: string, run: (c: any) => any, extra = {}) =>
        fn(
          id,
          (ctx) => {
            writeFileSync(join(ctx.scratchDir, 'f.txt'), 'x')
            return run(ctx)
          },
          extra,
        )
      await runAll(
        [
          mk('t1', () => {
            throw new Error('x')
          }),
          mk('t2', () => new Promise(() => {}), { timeoutSeconds: 1 }),
        ],
        baseCtx(scratchRoot),
        { log: () => {}, keepGoing: true },
      )
      expect(leftovers(scratchRoot)).toEqual([])
    })
  }, 30_000)
})
