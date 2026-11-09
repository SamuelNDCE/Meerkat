// Peer-requested features: verdict, worktree reads its own branch, new findings only on a branch, repo commands, top. Real CLI in scratch git repos.
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const bin = fileURLToPath(new URL('../bin/meerkat.mjs', import.meta.url))
const SLOW = 180000
let tmp: string
let app: string
const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' })
const put = (rel: string, text: string, root = app) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const cli = (args: string[], cwd = app, extraEnv: Record<string, string> = {}) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', cwd, env: { ...process.env, NO_COLOR: '1', CI: '1', MEERKAT_LOG_DIR: join(tmp, 'logs'), ...extraEnv } })
const LOOSE = 'export const v = 1\nif (v == 2) {}\n'

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'meerkat-060-'))
  app = join(tmp, 'app')
  put('package.json', '{"name":"fx","private":true}\n')
  put('index.js', "import './clean.js'\n")
  put('clean.js', 'export const c = 1\n')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const commit = (msg = 'c') => (git(app, ['add', '-A']), git(app, ['commit', '-q', '-m', msg]))
const initMain = () => (git(app, ['init', '-q', '-b', 'main']), commit('init'))

describe('verdict', () => {
  test('PASS when nothing blocks (exit 0)', () => {
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('clean.js', 'export const c = 2\n')
    commit()
    const r = cli(['verdict'])
    expect(r.stdout.trim()).toBe('PASS')
    expect(r.status).toBe(0)
  }, SLOW)

  test('FAIL n blocking in changed files when the branch adds a finding (exit 1)', () => {
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('loose.js', LOOSE)
    put('index.js', "import './clean.js'\nimport './loose.js'\n")
    commit()
    const r = cli(['verdict', '--base', 'main'])
    expect(r.stdout.trim()).toBe('FAIL 1 blocking in changed files')
    expect(r.status).toBe(1)
  }, SLOW)

  test('findings only in code the branch did not change: PASS with a pre-existing note (exit 0)', () => {
    put('loose.js', LOOSE)
    put('index.js', "import './clean.js'\nimport './loose.js'\n")
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('clean.js', 'export const c = 2\n')
    commit()
    const r = cli(['verdict'])
    // Corrected 2026-11-09: findings outside the diff (kind wide) no longer fail the verdict; they are listed as pre-existing. Was: FAIL-PRE-EXISTING, exit 1.
    expect(r.stdout.trim()).toBe('PASS (1 pre-existing, not in this diff)')
    expect(r.status).toBe(0)
  }, SLOW)
})

describe('a worktree reads its own branch', () => {
  test('brief and gate on ../wt find the file committed only on feat, and name branch feat', () => {
    initMain()
    const wt = join(tmp, 'wt')
    git(app, ['worktree', 'add', '-q', wt, '-b', 'feat'])
    put('only-feat.js', 'export function onlyFeat() {\n  return 1\n}\n', wt)
    git(wt, ['add', '-A'])
    git(wt, ['commit', '-q', '-m', 'feat file'])
    expect(existsSync(join(app, 'only-feat.js'))).toBe(false)
    const b = cli(['brief', 'only-feat.js', '--app', '../wt'], app)
    expect(b.status).toBe(0)
    expect(b.stdout).not.toContain('does not exist')
    expect(b.stdout.split('\n')[0]).toContain('branch feat')
    expect(b.stdout.split('\n')[0]).toContain('git worktree')
    const g = cli(['gate', '--app', '../wt', '--no-input'], app)
    // the folder banner goes to stderr (stdout stays the pure gate output)
    expect(g.stderr).toContain('branch feat')
    expect(g.stdout).toContain('only-feat.js')
    expect(g.stderr).not.toMatch(/not found|does not exist/)
  }, SLOW)
})

describe('new findings only on a branch', () => {
  beforeEach(() => {
    put('loose.js', LOOSE)
    put('index.js', "import './clean.js'\nimport './loose.js'\n")
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    // the old finding moves down two lines (identity is the code, not the line number); a new finding arrives in a new file
    put('loose.js', `// a\n// b\n${LOOSE}`)
    put('fresh.js', 'export const f = 1\nif (f == 3) {}\n')
    put('index.js', "import './clean.js'\nimport './loose.js'\nimport './fresh.js'\n")
    commit()
  })
  test('gate --base hides what the base already has, shows the new one and says how many were hidden', () => {
    const r = cli(['gate', '--base', 'main', '--full', '--no-input'])  // --full: the compact default lists no per-finding lines
    expect(r.stdout).toMatch(/1 pre-existing finding\(s\) hidden: already on main/)
    expect(r.stdout).toContain('fresh.js:2')
    expect(r.stdout).not.toContain('loose.js:')
    expect(r.status).toBe(1)
  }, SLOW)
  test('--all-findings shows everything', () => {
    const r = cli(['gate', '--base', 'main', '--all-findings', '--full', '--no-input'])  // --full: the compact default lists no per-finding lines
    expect(r.stdout).toContain('fresh.js:2')
    expect(r.stdout).toContain('loose.js:4')
    expect(r.stdout).not.toContain('pre-existing finding(s) hidden')
  }, SLOW)
})

describe('new-findings hole: a copy of an old finding is not hidden', () => {
  test('a duplicate added on a changed line stays visible; the old one on an untouched line stays hidden', () => {
    put('loose.js', LOOSE)
    put('index.js', ["import './clean.js'", "import './loose.js'", ''].join('\n'))
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('loose.js', [LOOSE, 'if (v == 2) {}', ''].join('')) // the same finding text again, on a new line
    commit()
    const r = cli(['gate', '--base', 'main', '--full', '--no-input'])  // --full: the compact default lists no per-finding lines
    expect(r.stdout).toMatch(/1 pre-existing finding\(s\) hidden/)
    expect(r.stdout).toContain('loose.js:3')
    expect(r.stdout).not.toContain('loose.js:2')
    expect(r.status).toBe(1)
  }, SLOW)
})

describe('repo test and build commands', () => {
  beforeEach(() => {
    put('mark.mjs', "import { appendFileSync } from 'node:fs'\nappendFileSync('marks.txt', process.argv[2] + '\\n')\nprocess.exit(Number(process.argv[3] ?? 0))\n")
    put('meerkat.config.json', JSON.stringify({ commands: { test: 'node mark.mjs test', build: 'node mark.mjs build 3', typecheck: 'node mark.mjs typecheck', deploy: 'node mark.mjs deploy' } }))
    initMain()
  })
  const marks = () => (existsSync(join(app, 'marks.txt')) ? readFileSync(join(app, 'marks.txt'), 'utf8').trim().split(/\r?\n/) : [])
  test('meerkat commands lists the block', () => {
    const r = cli(['commands'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('test       node mark.mjs test')
    expect(r.stdout).toContain('typecheck  node mark.mjs typecheck')
    expect(JSON.parse(cli(['commands', '--json']).stdout).commands.build).toBe('node mark.mjs build 3')
  })
  test('meerkat test and meerkat build print the exact command, run only that command and pass its exit code on', () => {
    const t = cli(['test'], app, { MEERKAT_TRUST_PROJECT: '1' })
    expect(t.stdout).toContain('$ node mark.mjs test')
    expect(t.status).toBe(0)
    const b = cli(['build'], app, { MEERKAT_TRUST_PROJECT: '1' })
    expect(b.stdout).toContain('$ node mark.mjs build 3')
    expect(b.status).toBe(3)
    expect(marks()).toEqual(['test', 'build'])
  })
  test('an untrusted config runs nothing: build refuses and meerkat test says it took the quick-check path; no marker is written', () => {
    const b = cli(['build'])
    expect(b.status).toBe(1)
    expect(b.stderr).toContain('meerkat trust')
    expect(marks()).toEqual([])
    const u = cli(['test'])
    expect(u.stderr).toContain('commands.test was NOT run')
    expect(u.stderr).toContain('quick check')
    expect(marks()).toEqual([])
  }, SLOW)
  test('meerkat trust without a terminal trusts nothing; a trusted config runs', () => {
    expect(cli(['trust']).status).toBe(1)
    expect(cli(['build']).status).toBe(1)
    expect(marks()).toEqual([])
    expect(cli(['build'], app, { MEERKAT_TRUST_PROJECT: '1' }).status).toBe(3)
    expect(marks()).toEqual(['build'])
  })
  test('a command with an escape sequence is rejected, nothing runs, and the output has no raw ESC', () => {
    const esc = String.fromCharCode(27)
    put('meerkat.config.json', JSON.stringify({ commands: { test: 'node mark.mjs test', build: `node mark.mjs build${esc}[2K${esc}[1Gnode mark.mjs ok` } }))
    const l = cli(['commands'])
    expect(l.stdout + l.stderr).not.toContain(esc)
    expect(l.stdout).toContain('node mark.mjs test')
    expect(l.stdout).not.toContain('build')
    expect(l.stderr).toContain('control character')
    const b = cli(['build'], app, { MEERKAT_TRUST_PROJECT: '1' })
    expect(b.status).toBe(2)
    expect(b.stdout + b.stderr).not.toContain(esc)
    expect(marks()).toEqual([])
  })
  test('a command with a bidi override or zero-width joiner is rejected, nothing runs, and the listing has no raw format characters', () => {
    const bidi = String.fromCharCode(0x202e)
    const zwj = String.fromCharCode(0x200d)
    put('meerkat.config.json', JSON.stringify({ commands: { test: 'node mark.mjs test', build: `node mark.mjs ${bidi}build${zwj} 0`, deploy: `node mark.mjs deploy${zwj}` } }))
    const l = cli(['commands'])
    for (const c of [bidi, zwj]) expect(l.stdout + l.stderr).not.toContain(c)
    expect(l.stdout).toContain('node mark.mjs test')
    expect(l.stdout).not.toContain('build')
    expect(l.stderr).toContain('control character')
    expect(cli(['build'], app, { MEERKAT_TRUST_PROJECT: '1' }).status).toBe(2)
    expect(marks()).toEqual([])
  })
  test('a truncated config makes commands, build, test and trust exit 2 with the reason', () => {
    put('meerkat.config.json', '{ "commands": { "test": "node mark.mjs test", ')
    for (const w of ['commands', 'build', 'test', 'trust']) {
      const r = cli([w], app, { MEERKAT_TRUST_PROJECT: '1' })
      expect(r.status, w).toBe(2)
      expect(r.stderr, w).toContain('could not be read as JSON')
    }
    expect(marks()).toEqual([])
  })
  test('with no commands block, meerkat build is a usage error and runs nothing', () => {
    rmSync(join(app, 'meerkat.config.json'))
    const r = cli(['build'])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('commands')
    expect(marks()).toEqual([])
  })
})

describe('verdict and top never go silent', () => {
  const line = (r: { stdout: string }) => r.stdout.trim()
  test.each([['verdict'], ['top']])('%s: a base ref that does not exist is exit 2 with one NO-RESULT line', (w) => {
    initMain()
    const r = cli([w, '--base', 'no-such-ref'])
    expect(r.status).toBe(2)
    expect(line(r)).toMatch(/^NO-RESULT: .*no-such-ref.*next: /)
  }, SLOW)
  test.each([['verdict'], ['top']])('%s: not a git repository is exit 2 with one NO-RESULT line', (w) => {
    const r = cli([w])
    expect(r.status).toBe(2)
    expect(line(r)).toMatch(/^NO-RESULT: .*git.*next: /)
  })
  test.each([['verdict'], ['top']])('%s: nothing changed is exit 75 with an INCOMPLETE line', (w) => {
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    const r = cli([w])
    expect(r.status).toBe(1)
    expect(line(r)).toMatch(/^NO-RESULT: nothing changed .*next: /)
  }, SLOW)
  test.each([['verdict'], ['top']])('%s: a run that times out is exit 1 with one NO-RESULT line', (w) => {
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('loose.js', LOOSE)
    commit()
    const r = cli([w], app, { MEERKAT_VERDICT_TIMEOUT_S: '0.05' })
    expect(r.status).toBe(75)
    expect(line(r)).toMatch(/^INCOMPLETE \d+ of \d+ checks finished, \d+ blocking so far \(not a pass\)/)
  }, SLOW)
})

describe('legacy folders', () => {
  beforeEach(() => {
    put('package.json', JSON.stringify({ name: 'root', private: true }))
    put('apps/web/package.json', JSON.stringify({ scripts: { test: 'vitest run' } }))
    put('apps/old/package.json', JSON.stringify({ scripts: { test: 'old-runner', build: 'old-build' } }))
    put('meerkat.config.json', JSON.stringify({ legacy: ['apps/old'] }))
  })
  test('commands skips a legacy folder and says how many were hidden', () => {
    initMain()
    const r = cli(['commands'])
    expect(r.stdout).toContain('apps/web  test')
    expect(r.stdout).not.toContain('apps/old')
    expect(r.stdout).toContain('1 folder(s) hidden as legacy')
    put('meerkat.config.json', JSON.stringify({ legacy: ['apps/o*'] }))
    expect(cli(['commands']).stdout).not.toContain('apps/old')
    put('meerkat.config.json', '{}')
    expect(cli(['commands']).stdout).toContain('apps/old  test')
  })
  test('verdict and top ignore findings in a legacy folder and say so on stderr', () => {
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('apps/old/loose.js', LOOSE)
    commit()
    const v = cli(['verdict'])
    expect(v.stdout.trim()).toMatch(/^NO-RESULT: nothing changed/)
    expect(v.stderr).toContain('1 folder(s) hidden as legacy')
    put('apps/web/loose.js', LOOSE)
    commit()
    const t = cli(['top'])
    expect(t.stdout).toContain('apps/web/loose.js')
    expect(t.stdout).not.toContain('apps/old')
    expect(t.stderr).toContain('1 folder(s) hidden as legacy')
  }, SLOW)
})

describe('verdict --known', () => {
  beforeEach(() => {
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('loose.js', LOOSE)
    put('index.js', ["import './clean.js'", "import './loose.js'", ''].join('\n'))
    commit()
  })
  const known = (list: unknown) => put('known.json', JSON.stringify(list))
  test('a known entry on a changed file passes and is printed as KNOWN; the same finding without the entry blocks', () => {
    known([{ check: 'js-eqeqeq', file: 'loose.js' }])
    const k = cli(['verdict', '--known', 'known.json'])
    expect(k.stdout.split('\n')[0]).toBe('PASS (1 known)')
    expect(k.stdout).toContain('KNOWN: js-eqeqeq loose.js:2')
    expect(k.status).toBe(0)
    const plain = cli(['verdict'])
    expect(plain.stdout.trim()).toBe('FAIL 1 blocking in changed files')
    expect(plain.status).toBe(1)
  }, SLOW)
  test('a known entry for another file does not hide the finding, and a stale entry is reported; --json is one object', () => {
    known([{ check: 'js-eqeqeq', file: 'other.js' }])
    const r = cli(['verdict', '--known', 'known.json'])
    expect(r.stdout.split('\n')[0]).toBe('FAIL 1 blocking in changed files (0 known)')
    expect(r.stdout).toContain('STALE: js-eqeqeq other.js')
    expect(r.status).toBe(1)
    const j = JSON.parse(cli(['verdict', '--known', 'known.json', '--json']).stdout)
    expect(j).toMatchObject({ verdict: 'FAIL', exitCode: 1, blocking: 1, known: 0, stale: [{ check: 'js-eqeqeq', file: 'other.js' }] })
    expect(typeof j.reason).toBe('string')
  }, SLOW)
  test('a missing or malformed --known file is NO-RESULT, exit 2, never ignored', () => {
    const miss = cli(['verdict', '--known', 'nope.json'])
    expect(miss.status).toBe(2)
    expect(miss.stdout).toMatch(/^NO-RESULT: the --known file nope.json does not exist/)
    put('bad.json', '{not json')
    expect(cli(['verdict', '--known', 'bad.json']).status).toBe(2)
    known([{ check: 'js-eqeqeq' }])
    const shape = cli(['verdict', '--known', 'known.json', '--json'])
    expect(shape.status).toBe(2)
    expect(JSON.parse(shape.stdout)).toMatchObject({ verdict: 'NO-RESULT', exitCode: 2 })
  })
})

describe('commands without a config', () => {
  test('lists the package.json scripts read-only and says how to pin them', () => {
    put('package.json', JSON.stringify({ name: 'fx', scripts: { test: 'vitest run', build: 'tsc -p .', lint: 'eslint .', start: 'node x.js' } }))
    const r = cli(['commands'], tmp, { MEERKAT_APP_DIR: app })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('npm run test   (runs: vitest run)')
    expect(r.stdout).toContain('npm run build   (runs: tsc -p .)')
    expect(r.stdout).toContain('npm run lint')
    expect(r.stdout).not.toContain('start')
    expect(r.stdout).toContain('to pin them')
  })
  test('a monorepo with no root scripts lists the scripts one level down, prefixed with the folder; the list is capped', () => {
    put('package.json', JSON.stringify({ name: 'root', private: true }))
    put('apps/web/package.json', JSON.stringify({ name: 'web', scripts: { test: 'vitest run', build: 'vite build', dev: 'vite' } }))
    put('tools/cli/package.json', JSON.stringify({ name: 'cli', scripts: { lint: 'eslint .' } }))
    const r = cli(['commands'], tmp, { MEERKAT_APP_DIR: app })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('apps/web  test  npm --prefix apps/web run test   (runs: vitest run)')
    expect(r.stdout).toContain('apps/web  build')
    expect(r.stdout).not.toContain('dev')
    expect(r.stdout).not.toContain('tools/cli')
    put('package.json', JSON.stringify({ name: 'root', workspaces: ['tools/*'] }))
    expect(cli(['commands'], tmp, { MEERKAT_APP_DIR: app }).stdout).toContain('tools/cli  lint')
    for (let i = 0; i < 12; i++) put(`packages/p${String(i).padStart(2, '0')}/package.json`, JSON.stringify({ scripts: { test: 'a', build: 'b', lint: 'c', typecheck: 'd' } }))
    const big = cli(['commands'], tmp, { MEERKAT_APP_DIR: app }).stdout
    expect(big).toMatch(/\.\.\. \d+ more omitted/)
    expect(big.split('\n').filter((l) => l.includes('npm --prefix')).length).toBeLessThanOrEqual(41)
  })
  test('with no package.json either it says so and still exits 0', () => {
    rmSync(join(app, 'package.json'))
    const r = cli(['commands'], tmp, { MEERKAT_APP_DIR: app })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('no commands')
    expect(r.stdout).toContain('meerkat.config.json')
  })
})

describe('top', () => {
  test('lists the findings of changed files only, one table', () => {
    put('old.js', 'export const o = 1\nif (o == 9) {}\n')
    put('index.js', "import './clean.js'\nimport './old.js'\n")
    initMain()
    git(app, ['checkout', '-q', '-b', 'feat'])
    put('two.js', 'export const t = 1\nif (t == 2) {}\nif (t == 3) {}\n')
    put('index.js', "import './clean.js'\nimport './old.js'\nimport './two.js'\n")
    commit()
    const r = cli(['top'])
    expect(r.status).toBe(0)
    const rows = r.stdout.split('\n').filter((l) => /\.js\s/.test(l))
    expect(rows.filter((l) => l.startsWith('two.js')).length).toBe(2)
    expect(r.stdout).not.toContain('old.js')
    expect(r.stdout.split('\n')[0]).toMatch(/^file\s+check\s+line\s+message$/)
    expect(cli(['top', '--limit', '1']).stdout).toMatch(/1 more/)
  }, SLOW)
})
