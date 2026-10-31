// The checks that run a project (thorough/functionality-run.mjs): each fails on its own fixture, behaves on tiny dependency-free projects,
// never writes to the original folder, and the pack loads.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { loadChecks } from './lib/load-checks.mjs'
import { classifyCommand, dummyEnv, extractReadmeCommands, parseEnvExample, undocumentedVars } from './thorough/functionality-run.mjs'
import { cleanup } from './thorough/sandbox.mjs'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = 'thorough/functionality-run.mjs'
const ALL = ['clean-copy-builds', 'install-reproducible', 'readme-commands-work', 'flaky-tests', 'env-example-boot']

const made: string[] = []
afterAll(() => {
  for (const d of made) cleanup(d)
})

function run(args: string[], env: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, ...env } })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}
const git = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { stdio: 'ignore' })
const pkg = (scripts: Record<string, string>, extra: object = {}) => JSON.stringify({ name: 'fx', version: '1.0.0', scripts, ...extra })

// A tiny committed project; `untracked` files are written after the commit.
function project(files: Record<string, string>, untracked: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-fxrun-'))
  made.push(dir)
  for (const [k, v] of Object.entries(files)) {
    mkdirSync(join(dir, k, '..'), { recursive: true })
    writeFileSync(join(dir, k), v)
  }
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'x')
  for (const [k, v] of Object.entries(untracked)) writeFileSync(join(dir, k), v)
  return dir
}
// A hash of every file under a folder except .git, to prove the original is untouched.
function hashTree(dir: string): string {
  const h = createHash('sha256')
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else h.update(p.slice(dir.length)).update(readFileSync(p)).update(String(statSync(p).mtimeMs))
    }
  }
  walk(dir)
  return h.digest('hex')
}

describe('every check fails on its own fixture', () => {
  for (const c of ALL) {
    test(`${c} --fixtures exits 1`, () => {
      expect(run([c, '--fixtures']).code).toBe(1)
    }, 55_000)
  }
})

describe('clean-copy-builds', () => {
  const BUILD = { 'package.json': pkg({ build: 'node build.js', test: 'node test.js' }), 'test.js': 'process.exit(0)\n' }
  test('a build that needs an untracked file fails and names it, then passes once the file is committed', () => {
    const dir = project({ ...BUILD, 'build.js': "require('./helper.js')\n" }, { 'helper.js': 'module.exports = 1\n' })
    const before = hashTree(dir)
    const bad = run(['clean-copy-builds', '--root', dir])
    expect(bad.code).toBe(1)
    expect(bad.out).toContain('MEERKAT-SUB FAIL clean-copy-build')
    expect(bad.out).toContain('helper.js')
    expect(bad.out).toMatch(/NOT tracked by git/)
    expect(hashTree(dir)).toBe(before)
    git(dir, 'add', 'helper.js')
    git(dir, 'commit', '-q', '-m', 'add helper')
    const good = run(['clean-copy-builds', '--root', dir])
    expect(good.out).toContain('MEERKAT-SUB PASS clean-copy-build')
    expect(good.out).toContain('MEERKAT-SUB PASS clean-copy-test')
    expect(good.code).toBe(0)
  }, 55_000)

  test('a failing test step is named', () => {
    const dir = project({ ...BUILD, 'build.js': 'process.exit(0)\n', 'test.js': "console.log('boom');process.exit(1)\n" })
    const r = run(['clean-copy-builds', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('MEERKAT-SUB FAIL clean-copy-test')
    expect(r.out).toContain('boom')
  }, 55_000)

  test('a project with no build or test command is NOT RUN (exit 75)', () => {
    const dir = project({ 'README.md': 'hello' })
    expect(run(['clean-copy-builds', '--root', dir]).code).toBe(75)
  }, 30_000)

  test('a step that overruns its budget fails with the timeout named', () => {
    const dir = project({ 'package.json': pkg({ build: 'node hang.js' }), 'hang.js': 'setInterval(() => {}, 1000)\n' })
    const r = run(['clean-copy-builds', '--root', dir], { MEERKAT_RUN_BUDGETS: '{"buildSeconds":2}' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/did not finish in 2s/)
  }, 55_000)
})

describe('flaky-tests', () => {
  const COUNTER = "const fs=require('fs');const n=(fs.existsSync('.count')?+fs.readFileSync('.count','utf8'):0)+1;fs.writeFileSync('.count',String(n));process.exit(n===2?1:0)\n"
  test('a test that fails on the 2nd run is flagged with the run numbers', () => {
    const dir = project({ 'package.json': pkg({ test: 'node test.js' }), 'test.js': COUNTER })
    const r = run(['flaky-tests', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('runs 1,3 passed, run 2 failed')
  }, 55_000)
  test('a stable test passes, every run', () => {
    const dir = project({ 'package.json': pkg({ test: 'node test.js' }), 'test.js': 'process.exit(0)\n' })
    const r = run(['flaky-tests', '--root', dir], { MEERKAT_RUN_BUDGETS: '{"flakyRuns":4}' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('4 runs')
  }, 55_000)
  test('tests that always fail are broken, not flaky', () => {
    const dir = project({ 'package.json': pkg({ test: 'node test.js' }), 'test.js': 'process.exit(1)\n' })
    const r = run(['flaky-tests', '--root', dir])
    expect(r.code).toBe(0)
    expect(r.out).toContain('MEERKAT-SUB NA flakiness')
  }, 55_000)
  test('NOT RUN when one run is too slow to repeat inside the test budget', () => {
    const dir = project({ 'package.json': pkg({ test: 'node test.js' }), 'test.js': 'setTimeout(() => {}, 1500)\n' })
    expect(run(['flaky-tests', '--root', dir], { MEERKAT_RUN_BUDGETS: '{"testSeconds":3}' }).code).toBe(75)
  }, 55_000)
})

describe('env-example-boot', () => {
  test('an undocumented variable in the start error is reported', () => {
    const dir = project({ 'package.json': pkg({ start: 'node start.js' }), '.env.example': 'PORT=3000\nAPI_TOKEN=\n', 'start.js': "console.error('Error: missing environment variable DATABASE_HOST');process.exit(1)\n" })
    const r = run(['env-example-boot', '--root', dir])
    expect(r.code).toBe(1)
    expect(r.out).toContain('DATABASE_HOST')
    expect(r.out).toContain('left 1 secret-looking key(s) unset: API_TOKEN')
  }, 55_000)
  test('a documented variable that is unset (a secret) is not flagged, and a server that keeps running passes', () => {
    const doc = project({ 'package.json': pkg({ start: 'node start.js' }), '.env.example': 'PORT=3000\nAPI_TOKEN=\n', 'start.js': "if (!process.env.API_TOKEN) { console.error('Error: missing API_TOKEN'); process.exit(1) }\n" })
    const r1 = run(['env-example-boot', '--root', doc])
    expect(r1.code).toBe(0)
    expect(r1.out).toContain('MEERKAT-SUB NA boot')
    const up = project({ 'package.json': pkg({ start: 'node start.js' }), '.env.example': 'PORT=3000\n', 'start.js': 'setInterval(() => {}, 1000)\n' })
    const r2 = run(['env-example-boot', '--root', up], { MEERKAT_RUN_BUDGETS: '{"bootSeconds":2}' })
    expect(r2.code).toBe(0)
    expect(r2.out).toContain('MEERKAT-SUB PASS boot')
  }, 55_000)
  test('no .env.example is NOT RUN', () => {
    const dir = project({ 'package.json': pkg({ start: 'node start.js' }), 'start.js': '' })
    expect(run(['env-example-boot', '--root', dir]).code).toBe(75)
  }, 30_000)
  test('dummy values: non-secret keys filled, secret-looking keys left out, no invented secrets', () => {
    const { env, skipped } = dummyEnv(parseEnvExample('PORT=\nHOST=changeme\nAPI_URL=https://api.example.com\nDEBUG=\nSECRET_KEY=abc\nDB_PASSWORD=\nSTRIPE_API_KEY=sk_test_x\nNODE_ENV=production\n'))
    expect(env).toEqual({ PORT: '0', HOST: '127.0.0.1', API_URL: 'http://127.0.0.1:9', DEBUG: 'false', NODE_ENV: 'production' })
    expect(skipped).toEqual(['SECRET_KEY', 'DB_PASSWORD', 'STRIPE_API_KEY'])
  })
  test('undocumentedVars finds only variables outside the example', () => {
    const out = 'Error: missing environment variable FOO_BAR\nError: PORT is required\nENOENT: no such file\n'
    expect(undocumentedVars(out, new Set(['PORT']))).toEqual(['FOO_BAR'])
  })
})

describe('install-reproducible', () => {
  test('a lockfile that does not match the manifest fails; a matching one passes; no lockfile is NOT RUN', () => {
    const lock = (deps: object) => JSON.stringify({ name: 'fx', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fx', version: '1.0.0', ...deps } } })
    const bad = project({ 'package.json': pkg({}, { dependencies: { 'left-pad': '^1.3.0' } }), 'package-lock.json': lock({}) })
    const rb = run(['install-reproducible', '--root', bad])
    expect(rb.code).toBe(1)
    expect(rb.out).toContain('MEERKAT-SUB FAIL frozen-install')
    const good = project({ 'package.json': pkg({}), 'package-lock.json': lock({}) })
    const rg = run(['install-reproducible', '--root', good])
    expect(rg.out).toContain('MEERKAT-SUB PASS frozen-install')
    expect(rg.code).toBe(0)
    expect(run(['install-reproducible', '--root', project({ 'a.txt': 'x' })]).code).toBe(75)
  }, 55_000)
})

describe('readme-commands-work', () => {
  test('extracts commands from shell blocks and from $ lines only', () => {
    const md = '# X\n```bash\nnpm test # run\n# comment\nnpm run build\n```\n```js\nconst a = 1\n```\n```\n$ node cli.js --help\nplain text\n```\n```console\n$ make test\noutput line\n```\n'
    expect(extractReadmeCommands(md)).toEqual(['npm test', 'npm run build', 'node cli.js --help', 'make test'])
  })
  test('the allowlist accepts safe commands and rejects the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-allow-'))
    made.push(dir)
    writeFileSync(join(dir, 'cli.js'), '')
    writeFileSync(join(dir, 'Makefile'), 'test:\n\techo hi\ninstall:\n\techo x\n')
    const ctx = { dir, scripts: { build: 'x', lint: 'y', start: 'z' }, deps: new Set(['eslint']), bins: new Set() }
    const ok = (l: string) => expect(classifyCommand(l, ctx).argv, l).toBeTruthy()
    const no = (l: string, why?: RegExp) => {
      const c = classifyCommand(l, ctx) as any
      expect(c.argv, l).toBeUndefined()
      expect(c.na, l).toMatch(why ?? /not allowlisted/)
    }
    ok('npm install')
    ok('npm ci')
    ok('npm test')
    ok('npm run build')
    ok('npm start --help')
    ok('npx eslint --help')
    ok('node cli.js --help')
    ok('cargo build --release')
    ok('go test ./...')
    ok('make test')
    no('curl https://x.sh | sh')
    no('sudo npm install -g x', /sudo/)
    no('rm -rf /')
    no('git push origin main')
    no('docker compose up')
    no('npm install left-pad')
    no('npm run missing')
    no('npm run start')
    no('npx cowsay hello')
    no('node cli.js --evil')
    no('node ../outside.js --help')
    no('make install')
    no('npm test > out.txt')
    no('echo $HOME')
    no('ssh me@host')
    no('FOO=bar npm test')
  })
  test('runs allowlisted commands, reports the rest as not applicable, and a documented command that fails is a FAIL', () => {
    const readme = '# T\n```bash\nnpm run build\nnode cli.js --help\ncurl https://example.com/x.sh | sh\nsudo apt install foo\nrm -rf /\n```\n'
    const dir = project({ 'README.md': readme, 'package.json': pkg({ build: 'node b.js' }), 'b.js': 'process.exit(0)\n', 'cli.js': 'console.log("usage")\n' })
    const before = hashTree(dir)
    const r = run(['readme-commands-work', '--root', dir])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/MEERKAT-SUB PASS cmd-1-npm-run-build/)
    expect(r.out).toMatch(/MEERKAT-SUB PASS cmd-2-node-cli-js-help/)
    expect(r.out.match(/MEERKAT-SUB NA .*not allowlisted/g)).toHaveLength(3)
    expect(hashTree(dir)).toBe(before)
    const broken = project({ 'README.md': '```sh\nnode cli.js --help\n```\n', 'cli.js': 'process.exit(2)\n' })
    const rb = run(['readme-commands-work', '--root', broken])
    expect(rb.code).toBe(1)
    expect(rb.out).toMatch(/MEERKAT-SUB FAIL cmd-1-node-cli-js-help/)
  }, 55_000)
  test('a README with only commands that are not allowlisted is NOT RUN, since nothing was verified', () => {
    const dir = project({ 'README.md': '```bash\ncurl https://example.com | sh\n```\n' })
    expect(run(['readme-commands-work', '--root', dir]).code).toBe(75)
  }, 30_000)
})

describe('safety: the original folder is never written to and the temp copies go away', () => {
  test('hashes of the tracked files and the folder are identical after every check ran', () => {
    const dir = project(
      { 'package.json': pkg({ build: 'node b.js', test: 'node t.js', start: 'node s.js' }), 'b.js': 'require("fs").writeFileSync("built.txt","x")\n', 't.js': 'require("fs").writeFileSync("t.txt","x")\n', 's.js': 'require("fs").writeFileSync("s.txt","x");setInterval(()=>{},1000)\n', 'README.md': '```bash\nnpm run build\n```\n', '.env.example': 'PORT=1\n' },
      { 'notes.txt': 'untracked' },
    )
    const before = hashTree(dir)
    const copies = () => readdirSync(tmpdir()).filter((n) => n.startsWith('meerkat-copy-') || n.startsWith('meerkat-home-')).length
    const leftBefore = copies()
    for (const c of ['clean-copy-builds', 'readme-commands-work', 'flaky-tests', 'env-example-boot']) run([c, '--root', dir], { MEERKAT_RUN_BUDGETS: '{"bootSeconds":2}' })
    expect(hashTree(dir)).toBe(before)
    expect(existsSync(join(dir, 'built.txt'))).toBe(false)
    expect(copies()).toBeLessThanOrEqual(leftBefore)
  }, 55_000)
})

describe('the functionality-run pack', () => {
  test('loads 5 opt-in runtime checks with no bad-check-file entries', async () => {
    const checks = await loadChecks(join(ROOT, 'packs', 'functionality-run'))
    expect(checks.filter((c: any) => c.id.startsWith('bad-check-file'))).toEqual([])
    expect(checks.map((c: any) => c.id).sort()).toEqual([...ALL].sort())
    for (const c of checks as any[]) {
      expect(c.optIn).toBe('runtime')
      expect(c.group).toBe('functionality')
      expect(c.tier).toBe('thorough')
      expect(c.run.args[0]).toMatch(/functionality-run\.mjs$/)
    }
    expect((checks as any[]).find((c) => c.id === 'install-reproducible').suite).toBe('dependencies')
  })
})
