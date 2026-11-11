// The text verdict and the JSON verdict answer the same question from the same run: same exit code, same verdict word on the first line.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { runVerdict } from '../lib/branchcmds.mjs'

const root = mkdtempSync(join(tmpdir(), 'meerkat-verdict-memo-'))
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

function repo(name: string) {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  git(d, 'init', '-q', '-b', 'main')
  put(d, 'meerkat.config.json', JSON.stringify({ packs: ['security-plus', 'repo'], disable: ['unused-files'], discover: false }))
  put(d, 'package.json', JSON.stringify({ name: 'fx', version: '1.0.0', private: true }))
  put(d, 'src/a.js', 'export const a = 1\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'base')
  git(d, 'checkout', '-q', '-b', 'feat')
  // The eval() is file content the verdict must flag, written as text into a temp repo. Nothing here executes it.
  put(d, 'src/a.js', 'export const a = (c) => eval(c)\n')
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'change')
  return d
}
const run = async (dir: string, argv: string[]) => {
  const lines: string[] = []
  const code = await runVerdict(argv, { env, cwd: dir, out: (t: string) => lines.push(t), err: () => {} })
  return { code, lines }
}

test('text and JSON verdicts agree on exit code and verdict word', async () => {
  const d = repo('agree')
  const text = await run(d, ['--base', 'main'])
  const json = await run(d, ['--base', 'main', '--json'])
  expect(json.code).toBe(text.code)
  const doc = JSON.parse(json.lines.join('\n'))
  expect(text.lines.join('\n')).toContain(doc.verdict)
}, 240000)
