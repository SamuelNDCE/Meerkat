// `meerkat batch` must be findable: a row in the AI trigger table, an MCP tool that runs the same code path, and a pointer from verdict help.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { createContext, handleMessage, TOOLS } from '../lib/mcp.mjs'

const repoRoot = resolve(__dirname, '..')
const cli = join(repoRoot, 'bin', 'meerkat.mjs')
const root = mkdtempSync(join(tmpdir(), 'meerkat-batchdisc-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
const git = (dir: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
let repo: string

beforeAll(() => {
  repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.js'), 'export const a = 1\n')
  writeFileSync(join(repo, 'b.js'), 'export const b = 1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base')
  for (const [name, file] of [['feat-a', 'a.js'], ['feat-b', 'b.js']]) {
    git(repo, 'checkout', '-q', '-b', name, 'main')
    writeFileSync(join(repo, file), `export const x = 2\n`)
    git(repo, 'commit', '-q', '-am', name)
    git(repo, 'checkout', '-q', 'main')
  }
  repo = realpathSync(repo)
})

describe('batch discovery', () => {
  test('docs/ai-triggers.md has a batch row naming the CLI command', () => {
    const t = readFileSync(join(repoRoot, 'docs', 'ai-triggers.md'), 'utf8')
    const row = t.split(/\r?\n/).find((l) => l.startsWith('| meerkat_batch |'))
    expect(row).toBeTruthy()
    expect(row).toContain('meerkat batch')
    expect(row).toMatch(/several branches or PRs/)
  })

  test('the MCP tool list includes meerkat_batch, trigger first, marked as writing, within the length limit', () => {
    const tool = TOOLS.find((x: { name: string }) => x.name === 'meerkat_batch')
    expect(tool).toBeTruthy()
    expect(tool.description.length).toBeLessThanOrEqual(300)
    expect(tool.description).toMatch(/^WRITES: Use when several branches or PRs must be gated together/)
    expect(tool.inputSchema.required).toEqual(['branches'])
    expect(tool.annotations.readOnlyHint).toBe(false)
  })

  test('meerkat_batch with dryRun returns the same plan as `batch --dry-run`', async () => {
    const ctx = { ...createContext({ ...process.env, MEERKAT_NO_PROJECT_CODE: '1' }), cwd: repo }
    const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'meerkat_batch', arguments: { base: 'main', branches: ['feat-a', 'feat-b'], dryRun: true } } }, ctx)
    const text = res.result.content[0].text.split(String.fromCharCode(10)).filter((l: string) => l !== 'meerkat_batch: ok').join(String.fromCharCode(10)).trim()
    const direct = spawnSync(process.execPath, [cli, 'batch', '--base', 'main', '--app', repo, '--dry-run', 'feat-a', 'feat-b'], { encoding: 'utf8', env: { ...process.env, MEERKAT_NO_PROJECT_CODE: '1' } })
    expect(res.result.isError).not.toBe(true)
    expect(direct.status).toBe(0)
    expect(text).toContain('PLAN base')
    expect(text).toBe(direct.stdout.trim())
    expect(text).toContain('feat-a: would be merged')
    expect(text).toContain('feat-b: would be merged')
  })

  test('meerkat_batch rejects a missing or bad branch list', async () => {
    const ctx = { ...createContext(process.env), cwd: repo }
    for (const args of [{}, { branches: [] }, { branches: ['--evil'] }, { branches: ['a'], dryRun: 'yes' }]) {
      const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'meerkat_batch', arguments: args } }, ctx)
      expect(res.result.isError).toBe(true)
    }
  })

  test('`meerkat verdict --help` points to batch and says --branches is not a batch', () => {
    const r = spawnSync(process.execPath, [cli, 'verdict', '--help'], { encoding: 'utf8' })
    expect(r.stdout).toContain('meerkat batch --base <ref> --app <repo> <branch>...')
    expect(r.stdout).toMatch(/one separate verdict line per branch/)
    expect(r.stdout).toMatch(/NOT a batch/)
  })
})
