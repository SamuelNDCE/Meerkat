// The repo map tools: tools/map/generate.mjs, tools/map/check.mjs and tools/worktrees.mjs, each run against throwaway git repos.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GEN = join(ROOT, 'tools/map/generate.mjs')
const CHECK = join(ROOT, 'tools/map/check.mjs')
const WT = join(ROOT, 'tools/worktrees.mjs')
const tmps: string[] = []

function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'meerkat-maptools-')))
  tmps.push(d)
  return d
}
function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}
function node(script: string, args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 60000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
function miniRepo(): string {
  const d = tmp()
  git(d, 'init', '-q', '-b', 'main')
  mkdirSync(join(d, 'bin'))
  mkdirSync(join(d, 'lib'))
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'mini', bin: { mini: 'bin/mini.mjs' } }))
  writeFileSync(join(d, 'bin/mini.mjs'), '// The mini command.\n// Second line.\nconsole.log(1)\n')
  writeFileSync(join(d, 'lib/a.mjs'), '// Helper a.\nexport const a = 1\n')
  git(d, 'add', '.')
  git(d, 'commit', '-q', '-m', 'init')
  return d
}

afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true })
})

describe('map generate and check', () => {
  test('generate is idempotent and keeps hand-written text outside the markers', () => {
    const d = miniRepo()
    writeFileSync(join(d, 'MAP.md'), '# Mine\n\nhand written top\n\n<!-- map:start -->\nold\n<!-- map:end -->\n\nhand written bottom\n')
    expect(node(GEN, ['--root', d], ROOT).code).toBe(0)
    const first = readFileSync(join(d, 'MAP.md'), 'utf8')
    expect(node(GEN, ['--root', d], ROOT).code).toBe(0)
    expect(readFileSync(join(d, 'MAP.md'), 'utf8')).toBe(first)
    expect(first).toContain('hand written top')
    expect(first).toContain('hand written bottom')
    expect(first).toContain('`lib/`')
    expect(readFileSync(join(d, 'docs/map/bin.md'), 'utf8')).toContain('The mini command.')
    expect(first).not.toMatch(/\b\d+ files\b/)
  })

  test('check exits 0 right after generate and 1 when a top-level folder is added', () => {
    const d = miniRepo()
    expect(node(GEN, ['--root', d], ROOT).code).toBe(0)
    expect(node(CHECK, ['--root', d], ROOT).code).toBe(0)
    mkdirSync(join(d, 'newdir'))
    writeFileSync(join(d, 'newdir/x.mjs'), '// new\n')
    git(d, 'add', 'newdir')
    const r = node(CHECK, ['--root', d], ROOT)
    expect(r.code).toBe(1)
    expect(r.err).toContain('newdir/')
  })

  test('the index is short and every top-level folder with code has a detail file', () => {
    const r = node(GEN, ['--root', ROOT, '--stdout'], ROOT)
    expect(r.code).toBe(0)
    const d = miniRepo()
    expect(node(GEN, ['--root', d], ROOT).code).toBe(0)
    const idx = readFileSync(join(d, 'MAP.md'), 'utf8')
    expect(idx.split(String.fromCharCode(10)).length).toBeLessThan(150)
    for (const f of ['bin', 'lib', 'root']) expect(existsSync(join(d, 'docs/map', f + '.md'))).toBe(true)
    expect(idx).toContain('docs/map/lib.md')
    const lib = readFileSync(join(d, 'docs/map/lib.md'), 'utf8')
    expect(lib).toContain('Helper a.')
    expect(lib).toContain('## Imports')
  })

  test('detail files list local imports and group lib files by prefix', () => {
    const d = miniRepo()
    writeFileSync(join(d, 'lib/batch-x.mjs'), "// Batch x.\nimport { a } from './a.mjs'\nexport const x = a\n")
    writeFileSync(join(d, 'lib/batch-y.mjs'), '// Batch y.\nexport const y = 1\n')
    git(d, 'add', '.')
    expect(node(GEN, ['--root', d], ROOT).code).toBe(0)
    const lib = readFileSync(join(d, 'docs/map/lib.md'), 'utf8')
    expect(lib).toContain('### batch*')
    expect(lib).toContain('- `lib/batch-x.mjs`: `lib/a.mjs`')
  })

  test('the checkpoint changes when a tracked path changes', () => {
    const d = miniRepo()
    expect(node(GEN, ['--root', d], ROOT).code).toBe(0)
    const read = () => JSON.parse(readFileSync(join(d, 'docs/map/CHECKPOINT.json'), 'utf8'))
    const before = read()
    expect(before.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(before.pathsSha256).toMatch(/^[0-9a-f]{64}$/)
    writeFileSync(join(d, 'lib/b.mjs'), '// b\n')
    git(d, 'add', 'lib/b.mjs')
    expect(node(GEN, ['--root', d], ROOT).code).toBe(0)
    const after = read()
    expect(after.pathsSha256).not.toBe(before.pathsSha256)
    expect(after.trackedFiles).toBe(before.trackedFiles + 1)
  })

  test('check exits 1 and names lib/ after a new file is added to lib/', () => {
    const d = miniRepo()
    expect(node(GEN, ['--root', d], ROOT).code).toBe(0)
    expect(node(CHECK, ['--root', d], ROOT).code).toBe(0)
    writeFileSync(join(d, 'lib/new.mjs'), '// new module\n')
    git(d, 'add', 'lib/new.mjs')
    const r = node(CHECK, ['--root', d], ROOT)
    expect(r.code).toBe(1)
    expect(r.err).toContain('lib/')
    expect(r.out).toContain('lib')
  })

  test('check exits 2 on a usage error', () => {
    expect(node(CHECK, ['--bogus'], ROOT).code).toBe(2)
  })
})

describe('worktrees doctor', () => {
  test('list works with two worktrees and the clean merged one is a close candidate', () => {
    const base = tmp()
    const origin = join(base, 'origin.git')
    git(base, 'init', '-q', '--bare', '-b', 'main', origin)
    const main = join(base, 'main')
    git(base, 'clone', '-q', origin, main)
    writeFileSync(join(main, 'f.txt'), 'x\n')
    git(main, 'add', 'f.txt')
    git(main, 'commit', '-q', '-m', 'init')
    git(main, 'push', '-q', 'origin', 'HEAD:main')
    git(main, 'fetch', '-q', 'origin')
    const merged = join(base, 'wt-merged')
    const open = join(base, 'wt-open')
    git(main, 'worktree', 'add', '-q', '-b', 'done-branch', merged)
    git(main, 'worktree', 'add', '-q', '-b', 'open-branch', open)
    writeFileSync(join(open, 'g.txt'), 'y\n')
    git(open, 'add', 'g.txt')
    git(open, 'commit', '-q', '-m', 'more')

    const list = node(WT, ['list'], main)
    expect(list.code).toBe(0)
    expect(list.out).toContain('done-branch')
    expect(list.out).toContain('open-branch')
    expect(list.out).toContain('MAIN')

    const cand = node(WT, ['close-candidates'], main)
    expect(cand.code).toBe(0)
    expect(cand.out).toContain('done-branch')
    expect(cand.out).not.toContain('open-branch')

    expect(node(WT, ['remind'], main).out).toContain('is clean and merged')

    // close without --yes does nothing; refuses the main checkout and dirty trees; removes the clean merged one with --yes
    expect(node(WT, ['close', merged], main).out).toContain('nothing done')
    writeFileSync(join(open, 'dirty.txt'), 'z\n')
    const refuse = node(WT, ['close', '--yes', main, open], main)
    expect(refuse.out).toContain('kept')
    const ok = node(WT, ['close', '--yes', merged], main)
    expect(ok.out).toContain('removed')
    expect(node(WT, ['close-candidates'], main).out).toContain('no close candidates')
  })
})
