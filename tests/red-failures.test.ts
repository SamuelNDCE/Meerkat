// RED: deliberately breaks something (bad input, a missing tool, a corrupt file, a killed process, a hostile name) and checks that Meerkat fails SAFELY:
// a documented exit code (docs/commands.md), no stack trace, a message that says what happened and what to do, nothing hanging, and nothing written outside the temp sandbox.
// Every test works on a copy of tests/fixtures/smoke-app. The sandbox has a sentinel folder next to the app, and the fixture in the repo is fingerprinted: after every test both must be unchanged.
// Where an expectation is looser than the ideal, the reason is written next to it.
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { FIXTURE, ROOT, fingerprint, git, hasStack, killTree, makeRunStore, makeSandbox, newestRunDir, runCli, spawnCli, startMcp } from './smoke-helpers.mjs'

type Sb = ReturnType<typeof makeSandbox>
type R = { code: number | null; stdout: string; stderr: string; all: string; timedOut: boolean }
const DOCUMENTED = [0, 1, 2, 3, 75, 130]
const WIN = process.platform === 'win32'
// A message that says what to do names a flag, a command, a variable or an action word.
const SAYS_WHAT_TO_DO = /(--[a-z]|meerkat [a-z]|MEERKAT_|\b(pass|set|run|add|install|use|see|try|fix|choose|say|check|leave|remove|enable|writable|force)\b)/i
const V = ['--only', 'license', '--plain']

const boxes: { sb: Sb; outside: string }[] = []
const fixtureBefore = fingerprint(FIXTURE)
const box = (opts?: Parameters<typeof makeSandbox>[0]) => {
  const sb = makeSandbox({ label: 'red', ...opts })
  boxes.push({ sb, outside: fingerprint(sb.outside) })
  return sb
}
afterEach(() => {
  for (const b of boxes) expect(fingerprint(b.sb.outside), 'a file was written next to the project, outside it').toBe(b.outside)
  expect(fingerprint(FIXTURE), 'the fixture in the repo was written to').toBe(fixtureBefore)
})
afterAll(() => boxes.forEach((b) => b.sb.cleanup()))

// The common assertions of a clean failure.
function clean(r: R, codes: number[], opts: { says?: RegExp; action?: boolean } = {}) {
  expect(r.timedOut, 'it hung').toBe(false)
  expect(DOCUMENTED, `exit code ${r.code} is not a documented one`).toContain(r.code)
  expect(codes, `exit code ${r.code}; output: ${r.all.slice(0, 500)}`).toContain(r.code)
  expect(hasStack(r.all), `a stack trace: ${r.all.slice(0, 600)}`).toBe(false)
  expect(r.all.trim().length, 'no message at all').toBeGreaterThan(0)
  if (opts.says) expect(r.all).toMatch(opts.says)
  if (opts.action !== false) expect(r.all, 'the message does not say what to do').toMatch(SAYS_WHAT_TO_DO)
}

describe('red: configuration', () => {
  let sb: Sb
  beforeAll(() => {
    sb = box()
  })
  test('a --config file that does not exist stops with exit 2 and names the file', () => {
    const r = runCli(sb, ['verify', ...V, '--config', 'nofile.json'])
    clean(r, [2], { says: /nofile\.json does not exist/ })
    expect(r.all).not.toMatch(/\[start/) // no check was started
  })
  test('a --config file that is not JSON stops with exit 2', () => {
    writeFileSync(join(sb.app, 'bad.json'), '{ nope')
    clean(runCli(sb, ['verify', ...V, '--config', 'bad.json']), [2], { says: /not valid JSON/ })
  })
  test('a broken meerkat.config.json found on its own is reported by name (the run goes on with defaults)', () => {
    writeFileSync(join(sb.app, 'meerkat.config.json'), '{ nope')
    // Exit 1 or 2 are both fine; the file is named and "ignored" is said, so nothing is silent. It is not an exit-2 stop because the person did not name the file.
    clean(runCli(sb, ['verify', ...V]), [0, 1, 2], { says: /meerkat\.config\.json: could not be read as JSON/, action: false })
    rmSync(join(sb.app, 'meerkat.config.json'))
  })
  test('a config with an unknown key does not crash (the key is ignored)', () => {
    writeFileSync(join(sb.app, 'unk.json'), JSON.stringify({ packs: ['security'], bogusKey: 1 }))
    // Ideal: a note naming the unknown key. Today it is ignored silently, which is reported to Samuel as a decision; the safe part (no crash, documented code) is what this asserts.
    clean(runCli(sb, ['verify', ...V, '--config', 'unk.json']), [0, 1, 2], { action: false })
  })
})

describe('red: folders', () => {
  let sb: Sb
  beforeAll(() => {
    sb = box()
  })
  test('a folder that does not exist: exit 2, says so, runs no checks', () => {
    const r = runCli(sb, ['verify', join(sb.root, 'nope'), ...V])
    clean(r, [2], { says: /does not exist/ })
    expect(r.all).not.toMatch(/\[start|spawn node ENOENT/)
  })
  test('a folder that is a file: exit 2, says so', () => {
    clean(runCli(sb, ['verify', join(sb.app, 'package.json'), ...V]), [2], { says: /is a file, not a folder/ })
  })
  test('an empty folder: exit 2, says it is not a project and offers --force', () => {
    mkdirSync(join(sb.root, 'empty'))
    clean(runCli(sb, ['verify', join(sb.root, 'empty'), ...V]), [2], { says: /not a project[\s\S]*--force/ })
  })
  test('a project with no git: verify still runs and says nothing about stacks', () => {
    const nogit = box({ commit: false })
    clean(runCli(nogit, ['verify', ...V]), [0, 1], { action: false })
  })
  test('a project with no git: gate exits 2 and says it is not a git work tree', () => {
    const nogit = box({ commit: false })
    clean(runCli(nogit, ['gate', '--staged']), [2], { says: /is not a git repository/, action: false })
  })
  test('a folder with shell metacharacters in its name is just a name', () => {
    const names = ['x$(echo)', 'x;y', 'x&y', 'x`y`'].concat(WIN ? [] : ['x|y']) // | is not allowed in a Windows file name
    for (const n of names) {
      const d = join(sb.root, n)
      cpSync(sb.app, d, { recursive: true })
      const r = runCli(sb, ['map', '--app', d])
      clean(r, [0], { action: false })
      expect(r.all).toMatch(/code map saved/)
      const v = runCli(sb, ['verify', d, ...V], { timeout: 120000 })
      clean(v, [0, 1], { action: false })
    }
    // Nothing the names spell out was run: no file called y, echo or similar appeared in the sandbox root.
    expect(readdirSync(sb.root).filter((x) => /^(y|echo|pwned)/.test(x))).toEqual([])
  }, 150000)
})

describe('red: a damaged run store, baseline or dismissals file', () => {
  let sb: Sb
  let dir: string
  beforeAll(() => {
    sb = box()
    makeRunStore(sb)
    dir = newestRunDir(sb)
  }, 120000)
  test('a corrupt summary.json: reading commands still answer, no stack', () => {
    const keep = readFileSync(join(dir, 'summary.json'), 'utf8')
    writeFileSync(join(dir, 'summary.json'), '{ corrupt')
    for (const a of [['last'], ['run', 'list'], ['findings'], ['trend']]) clean(runCli(sb, a), [0, 1], { action: false })
    writeFileSync(join(dir, 'summary.json'), keep)
  })
  test('a missing summary.json: the run list says it did not finish', () => {
    const keep = readFileSync(join(dir, 'summary.json'), 'utf8')
    rmSync(join(dir, 'summary.json'))
    const r = runCli(sb, ['run', 'list'])
    clean(r, [0], { says: /did not finish/, action: false })
    for (const a of [['last'], ['pr-comment']]) clean(runCli(sb, a), [0, 1], { action: false })
    writeFileSync(join(dir, 'summary.json'), keep)
  })
  test('a corrupt latest.json: runs and look-ups still work', () => {
    const f = join(sb.logs, 'latest.json')
    const keep = readFileSync(f, 'utf8')
    writeFileSync(f, '\u0000\u0000not json')
    clean(runCli(sb, ['last']), [0, 1], { action: false })
    clean(runCli(sb, ['verify', ...V]), [0, 1], { action: false })
    writeFileSync(f, keep)
  })
  test('a truncated findings.json: exit 2 with a message that names the run, no stack', () => {
    const keep = readFileSync(join(dir, 'findings.json'), 'utf8')
    writeFileSync(join(dir, 'findings.json'), keep.slice(0, Math.floor(keep.length / 2)))
    // Ideal: say "damaged" and tell the person to run meerkat again. Today it says the file is missing ("older Meerkat, or the run did not finish"), which is
    // misleading for a damaged file but safe; the exit code and the absence of a stack are what is asserted.
    const id = basename(dir) // name the run: folder-scoped commands read the folder's newest run, which is not this one after the earlier tests
    for (const a of [['findings', id], ['finding', 'abcd1234', id], ['prompt', id, '--print', '--no-copy']]) clean(runCli(sb, a), [1, 2], { says: /truncated|findings\.json/, action: false }) // a damaged run is named, not judged: exit 1 or 2 depending on the command
    clean(runCli(sb, ['suggest']), [0, 1], { action: false }) // suggest takes no run argument: checked only for a clean answer
    writeFileSync(join(dir, 'findings.json'), keep)
  })
  test('an empty baseline file: the ratchet run and the baseline command both cope', () => {
    dir = newestRunDir(sb) // an earlier test damaged the newest run; this test needs a clean one
    const made = runCli(sb, ['baseline', basename(dir)]) // name the run: the folder's newest run is not `dir` after the earlier tests
    expect(made.code, made.all).toBe(0)
    const f = join(sb.logs, 'baselines', readdirSync(join(sb.logs, 'baselines'))[0])
    writeFileSync(f, '')
    clean(runCli(sb, ['verify', ...V, '--ratchet']), [0, 1], { action: false })
    clean(runCli(sb, ['baseline', basename(dir)]), [0], { says: /Baseline saved/, action: false })
  })
  test('a dismissals file with bad ids and entries that are not objects: no crash (regression)', () => {
    runCli(sb, ['verify', ...V]) // a fresh run: the truncated-file test before this one damaged the last run's findings.json
    dir = newestRunDir(sb)
    const id = JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8')).findings[0].id
    runCli(sb, ['dismiss', id, basename(dir), '--reason', 'red test'])
    const f = join(sb.logs, 'dismissals', readdirSync(join(sb.logs, 'dismissals'))[0])
    writeFileSync(f, JSON.stringify({ schemaVersion: 1, items: [{ id: '../../etc/passwd', reason: 5 }, null, { id: {} }, 7] }))
    clean(runCli(sb, ['dismissals']), [0], { action: false })
    clean(runCli(sb, ['dismissals', '--stats']), [0], { action: false })
    clean(runCli(sb, ['dismiss', id, basename(dir), '--reason', 'again']), [0], { action: false })
  })
  test('dismiss and undismiss with a hostile id: exit 1, no path is touched, undismiss does not claim it removed something (regression)', () => {
    clean(runCli(sb, ['dismiss', '../../x', '--reason', 'r']), [2], { says: /No open finding/ })
    clean(runCli(sb, ['undismiss', '../../x']), [2], { says: /Nothing is dismissed/ })
  })
  test('a log folder that is a file: the run still shows its result, and says the logs were not saved (regression)', () => {
    const bad = box()
    const env = { MEERKAT_LOG_DIR: join(bad.outside, 'sentinel.txt') }
    const r = runCli(bad, ['verify', '--only', 'secret-scan', '--plain'], { env })
    clean(r, [0], { says: /logs cannot be saved/ })
    clean(runCli(bad, ['map'], { env }), [1], { says: /could not make a run folder/, action: false })
  })
  test.skipIf(WIN || process.getuid?.() === 0)('a read-only project folder: write commands (init) fail with a message, nothing is written', () => {
    const ro = box()
    chmodSync(ro.app, 0o555)
    const r = runCli(ro, ['init'])
    chmodSync(ro.app, 0o755)
    clean(r, [1, 2], { action: false })
  })
  test.skipIf(!WIN)('SKIPPED on Windows: a read-only project folder (a folder cannot be made read-only for its own files with chmod or attrib; the log-folder-is-a-file case above covers "cannot write")', () => {})
})

describe('red: hostile files in the project', () => {
  test('a symlink that points outside the project is not followed into the sandbox sentinel', () => {
    const sb = box()
    try {
      symlinkSync(sb.outside, join(sb.app, 'escape'), 'junction')
    } catch (e) {
      console.warn(`SKIP symlink: the OS refused (${(e as Error).message})`)
      return
    }
    clean(runCli(sb, ['map']), [0], { action: false })
    clean(runCli(sb, ['verify', ...V]), [0, 1], { action: false })
    // sentinel.txt must not have been scanned into a finding or modified (the afterEach fingerprint proves the latter).
  })
  test('a file name with a newline in it', () => {
    const sb = box()
    try {
      writeFileSync(join(sb.app, 'src', 'a\nb.js'), 'export const x = 1\n')
    } catch (e) {
      console.warn(`SKIP newline name: the OS refuses it (${(e as Error).message})`)
      return
    }
    git(sb.app, ['add', '-A'], sb.env)
    clean(runCli(sb, ['map']), [0], { action: false })
    clean(runCli(sb, ['gate', '--staged']), [0, 1, 75], { action: false })
  })
  test('a binary file with a .js extension, and a 5 MB minified line', () => {
    const sb = box()
    writeFileSync(join(sb.app, 'src', 'bin.js'), Buffer.from([0, 255, 254, 0, 1, 2, 3, 0, 0, 0xc3, 0x28, 0]))
    writeFileSync(join(sb.app, 'src', 'big.min.js'), `var a=${'x+'.repeat(2500000)}1;`)
    git(sb.app, ['add', '-A'], sb.env)
    const r = runCli(sb, ['verify', '--only', 'risky-code,secret-scan,sql-concat', '--plain'], { timeout: 150000 })
    clean(r, [0, 1], { action: false })
    clean(runCli(sb, ['map']), [0], { action: false })
  }, 160000)
  test('a package.json that is an array, not an object', () => {
    const sb = box()
    writeFileSync(join(sb.app, 'package.json'), '[1,2]')
    clean(runCli(sb, ['verify', ...V]), [0, 1], { action: false })
    for (const a of [['map'], ['discover'], ['recommend']]) clean(runCli(sb, a), [0], { action: false })
  })
  test('a package.json whose scripts are numbers, null and an array', () => {
    const sb = box()
    writeFileSync(join(sb.app, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 5, build: null, lint: ['a'] } }))
    for (const a of [['discover'], ['recommend']]) clean(runCli(sb, a), [0], { action: false })
    clean(runCli(sb, ['verify', ...V]), [0, 1], { action: false })
  })
})

describe('red: the environment', () => {
  test('git missing from PATH: gate exits 75 and says git was not found (regression: it used to say "not a git work tree")', () => {
    const sb = box()
    const empty = join(sb.root, 'emptypath')
    mkdirSync(empty)
    clean(runCli(sb, ['gate', '--staged'], { env: { PATH: empty, Path: empty } }), [75], { says: /git was not found on PATH/ })
  })
  test('an empty PATH: verify reports the check as NOT RUN with a way to fix it, and does not claim a pass', () => {
    const sb = box()
    const empty = join(sb.root, 'emptypath')
    mkdirSync(empty)
    const r = runCli(sb, ['verify', ...V], { env: { PATH: empty, Path: empty } })
    clean(r, [1], { says: /NOT RUN/ })
    expect(r.all).not.toMatch(/1 passed/)
  })
  // Not tested: node missing. The CLI is started by node itself, so "no node" cannot be simulated from inside a test.
  test('a run killed after 1 second leaves a store the next command can read', async () => {
    const sb = box()
    const { child, done } = spawnCli(sb, ['verify', '--plain'])
    await new Promise((r) => setTimeout(r, 1000))
    killTree(child)
    await done
    await new Promise((r) => setTimeout(r, 1500)) // let the killed process tree release its files
    clean(runCli(sb, ['run', 'list']), [0], { action: false })
    clean(runCli(sb, ['last']), [0, 1], { action: false })
    clean(runCli(sb, ['verify', ...V]), [0, 1], { action: false }) // the next run is not blocked by a stale lock
  }, 120000)
  test('two runs at the same time both finish and leave readable run folders', async () => {
    const sb = box()
    const a = spawnCli(sb, ['verify', '--only', 'license,node-engines', '--plain'])
    const b = spawnCli(sb, ['verify', '--only', 'license,node-engines', '--plain'])
    const [ra, rb] = await Promise.all([a.done, b.done])
    for (const r of [ra, rb]) {
      expect([0, 1]).toContain(r.code)
      expect(hasStack(r.all)).toBe(false)
    }
    const runs = join(sb.logs, 'runs')
    const dirs = readdirSync(runs)
    expect(dirs.length).toBeGreaterThanOrEqual(2)
    for (const d of dirs) JSON.parse(readFileSync(join(runs, d, 'summary.json'), 'utf8'))
    JSON.parse(readFileSync(join(sb.logs, 'latest.json'), 'utf8'))
  }, 120000)
})

describe('red: wrong use of the command line', () => {
  let sb: Sb
  beforeAll(() => {
    sb = box()
    makeRunStore(sb)
  }, 120000)
  test('an unknown command: exit 2 and the list of commands', () => {
    clean(runCli(sb, ['frobnicate']), [2], { says: /Unknown command "frobnicate"[\s\S]*verify/ })
  })
  test('an unknown option on a run and on a look-up: exit 2 and it names the option', () => {
    clean(runCli(sb, ['verify', '--frobnicate']), [2], { says: /--frobnicate/, action: false })
    clean(runCli(sb, ['findings', '--frobnicate']), [2], { says: /--frobnicate[\s\S]*--help/ })
    clean(runCli(sb, ['gate', '--bogus']), [2], { says: /--bogus/ })
  })
  test.each([['blast'], ['brief'], ['finding'], ['why'], ['check', 'show'], ['preset', 'show'], ['pack', 'enable']])('a missing required argument: meerkat %s %s', (...args) => {
    // Exit 2 is the documented usage error. dismiss and rules test print a usage line and exit 1 today (see the next test).
    clean(runCli(sb, args.filter(Boolean) as string[]), [2], { says: /(say which|for example|usage)/i })
  })
  test('dismiss and rules test without an argument print a usage line (exit 1, where the docs say usage errors are 2)', () => {
    clean(runCli(sb, ['dismiss']), [1, 2], { says: /usage: meerkat dismiss/ })
    clean(runCli(sb, ['rules', 'test']), [1, 2], { says: /usage: meerkat rules test/ })
  })
  test('rules test on a file that does not exist: exit 1 with the path', () => {
    clean(runCli(sb, ['rules', 'test', 'nope.json']), [1], { says: /nope\.json: cannot read rules/, action: false })
  })
  test('the global --no-input is accepted by init (regression)', () => {
    const fresh = box()
    clean(runCli(fresh, ['init', '--no-input']), [0], { says: /wrote .*meerkat\.config\.json/, action: false })
  })
})

describe('red: regressions in the checks', () => {
  const sqlCheck = (sb: Sb, source: string) => {
    writeFileSync(join(sb.app, 'src', 'q.js'), source)
    git(sb.app, ['add', '-A'], sb.env)
    const r = spawnSync(process.execPath, [join(ROOT, 'thorough', 'sec-code.mjs'), 'sql-concat'], { cwd: sb.app, env: { ...sb.env, MEERKAT_APP_DIR: sb.app }, encoding: 'utf8' })
    return `${r.stdout}${r.stderr}`
  }
  test('sql-concat still flags a request value joined into the statement', () => {
    const sb = box()
    const out = sqlCheck(sb, 'export function bad(db, req) {\n  return db.query("SELECT * FROM users WHERE name = \'" + req.query.name + "\'")\n}\n')
    expect(out).toMatch(/src\/q\.js:2 builds an SQL statement/)
  })
  test('sql-concat is quiet on the parameterised form with a $1 placeholder in double quotes (regression)', () => {
    const sb = box()
    const out = sqlCheck(sb, 'export function ok(db, req) {\n  return db.query("SELECT * FROM users WHERE name = $1", [req.query.name])\n}\n')
    expect(out).not.toMatch(/builds an SQL statement/)
  })
  test('sql-concat flags a double-quoted statement that interpolates a named variable ($name)', () => {
    const sb = box()
    const out = sqlCheck(sb, 'export function bad(db, name) {\n  return db.query("SELECT * FROM users WHERE name = $name")\n}\n')
    expect(out).toMatch(/src\/q\.js:2 builds an SQL statement/)
  })
  test('the gate, with a config that lists only some packs, still runs the packs it lists and says which checks ran', () => {
    // Documented gap, not a fix: meerkat gate loads exactly the configured packs (the quick preset adds every applicable pack). With the starter config from `meerkat init`
    // (security, hygiene) the SQL check lives in security-plus and does not run. This test pins the visible part: the gate header counts what it ran, so the gap can be seen.
    const sb = box()
    runCli(sb, ['init'])
    writeFileSync(join(sb.app, 'src', 'q.js'), 'export function bad(db, req) {\n  return db.query("SELECT * FROM users WHERE name = \'" + req.query.name + "\'")\n}\n')
    git(sb.app, ['add', '-A'], sb.env)
    const r = runCli(sb, ['gate', '--staged', '--no-cache', '--verbose'], { timeout: 120000 })
    clean(r, [0, 1, 75], { action: false })
    expect(r.all).toMatch(/gate: \d+ passed/)
  }, 130000)
})

describe('red: the MCP server', () => {
  let sb: Sb
  let mcp: ReturnType<typeof startMcp>
  beforeAll(async () => {
    sb = box()
    mcp = startMcp(sb)
    await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'red', version: '1' } })
  })
  afterAll(async () => {
    await mcp.close()
  })
  test('a malformed JSON line gets a parse error (-32700), and the server keeps going', async () => {
    mcp.writeRaw('{ this is not json\n')
    const reply = JSON.parse((await mcp.readReply(10000)) as string)
    expect(reply.error.code).toBe(-32700)
    expect((await mcp.call('ping', {})).result).toEqual({})
  })
  test('a 1 MB request line is answered (here with a clean "unknown argument") and the server keeps going', async () => {
    const r = await mcp.call('tools/call', { name: 'meerkat_list', arguments: { pad: 'x'.repeat(1024 * 1024) } }, { timeoutMs: 30000 })
    expect(r.error ?? r.result.isError, JSON.stringify(r).slice(0, 300)).toBeTruthy()
    expect(JSON.stringify(r).length).toBeLessThan(5000) // the huge argument is not echoed back
    expect((await mcp.call('ping', {})).result).toEqual({})
  })
  test('a request with no id is a notification: no reply, no crash', async () => {
    mcp.writeRaw(`${JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' })}\n`)
    expect(await mcp.readReply(1500)).toBeNull()
    expect((await mcp.call('ping', {})).result).toEqual({})
  })
  test('a folder argument outside the project is refused and says how to allow it', async () => {
    for (const folder of [sb.outside, '../..']) {
      const r = await mcp.call('tools/call', { name: 'meerkat_map', arguments: { folder } })
      expect(r.result.isError).toBe(true)
      const text = r.result.content[0].text
      expect(text).toMatch(/outside the folders this server may check/)
      expect(text).toMatch(/meerkat root add/)
      expect(hasStack(text)).toBe(false)
    }
  })
  test('an unknown tool, an unknown method and non-object arguments are errors, not crashes', async () => {
    expect((await mcp.call('tools/call', { name: 'rm_rf', arguments: {} })).error.code).toBe(-32602)
    expect((await mcp.call('nope/nothing', {})).error.code).toBe(-32601)
    const r = await mcp.call('tools/call', { name: 'meerkat_list', arguments: [1, 2] })
    expect(r.result.isError).toBe(true)
    expect(hasStack(mcp.stderr())).toBe(false)
  })
})

// Used only to keep the unused import honest when a platform skips every test that needs it.
void existsSync
