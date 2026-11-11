// Scale bugs: verdict output is stable (timings and paths removed), a file over 1 MB is skipped with a reason, a huge finding list prints a count and the first 20.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { runVerdict } from '../lib/branchcmds.mjs'
import { buildCodemap, MAX_FILE_BYTES } from '../lib/codemap.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-bughunt-scale-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const put = (dir: string, file: string, body: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), body)
}
const env = { ...process.env, MEERKAT_NO_PROJECT_CODE: '1', MEERKAT_LOG_DIR: join(root, 'logs') }
function repo(name: string, change: (d: string) => void) {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(d, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  for (let i = 0; i < 20; i++) put(d, `src/d${i % 4}/m${i}.js`, `export const m${i} = ${i}\n`)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feat')
  change(d)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'change')
  return d
}
const run = async (dir: string, argv: string[]) => {
  const lines: string[] = []
  const code = await runVerdict(argv, { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {} })
  return { code, lines }
}
const SKIP = /^(ms|timings|startedAt|endedAt|log|runDir|totalSeconds|gateSeconds|behindBy|base)$|Seconds$|Ms$/
const clean = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(clean)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).filter(([k]) => !SKIP.test(k)).map(([k, x]) => [k, clean(x)]))
  if (typeof v === 'string') return v.split(root).join('<root>').replace(/[0-9a-f]{12,40}/g, '<sha>').replace(/[A-Za-z]:[\/][^\s"']*[\/]runs[\/][^\s"']+/g, '<run>').replace(/\d+(\.\d+)? ?s\b/g, '<s>')
  return v
}

describe('bughunt scale', () => {
  test('verdict JSON is identical to the saved expectation (timings and paths removed)', async () => {
    const d = repo('same', (x) => {
      for (let i = 0; i < 5; i++) put(x, `src/d${i % 4}/m${i}.js`, `export const m${i} = ${i}\nexport const x${i} = (c) => eval(c)\n`)
    })
    const { code, lines } = await run(d, ['--base', 'main', '--json'])
    expect(code).toBe(1)
    const got = JSON.stringify(clean(JSON.parse(lines.join('\n'))), null, 2)
    const file = join(__dirname, 'fixtures', 'bughunt-scale.expected.json')
    if (process.env.BUGHUNT_WRITE === '1' || !existsSync(file)) writeFileSync(file, got + '\n')
    expect(got + '\n').toBe(readFileSync(file, 'utf8'))
  }, 240000)

  test('a file over 1 MB is skipped with a reason and nothing crashes', async () => {
    const d = repo('big', (x) => put(x, 'src/big.js', 'export const x = 1\n'.repeat(70000)))
    const map = buildCodemap(d) as { skipped?: { path: string; reason: string }[]; build?: { skipped?: { path: string; reason: string }[] } }
    const skipped = map.skipped ?? map.build?.skipped ?? []
    const hit = skipped.find((s) => s.path === 'src/big.js')
    expect(hit?.reason).toContain(String(MAX_FILE_BYTES))
    const { code } = await run(d, ['--base', 'main'])
    expect([0, 1]).toContain(code)
  }, 240000)

  test('a list over 10,000 findings prints a count and the first 20, not all', async () => {
    const d = repo('many', (x) => put(x, 'src/many.js', Array.from({ length: 10500 }, (_, i) => `export const e${i} = (c) => eval(c)`).join('\n') + '\n'))
    const { code, lines } = await run(d, ['--base', 'main'])
    expect(code).toBe(1)
    expect(lines.length).toBeLessThan(200)
    expect(lines.join('\n')).toMatch(/\.\.\. and \d+ more/)
  }, 240000)
})
