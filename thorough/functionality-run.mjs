// Checks that RUN the project and prove it works. They execute project code, so they are opt-in (--include runtime) and only ever run in a
// temp copy of the git-tracked files, with a scrubbed environment (thorough/sandbox.mjs). See docs/functionality-run.md.
//   node thorough/functionality-run.mjs <check> [--root <dir>]      node thorough/functionality-run.mjs <check> --fixtures   (must exit 1)
// Budgets: .meerkat-budgets.json under "run": installSeconds 600, buildSeconds 600, testSeconds 900, readmeSeconds 60, bootSeconds 15, flakyRuns 3.
// MEERKAT_RUN_BUDGETS (a JSON object) overrides single budget values for one run, for example '{"testSeconds":60}'.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NOT_RUN, main, notRun, readBudgets, withFixture } from './kit.mjs'
import { cleanup, detectCommands, makeCleanCopy, makeTemp, runIn, safe, scrubbedEnv } from './sandbox.mjs'

const budgets = (root) => {
  let env = {}
  try {
    env = JSON.parse(process.env.MEERKAT_RUN_BUDGETS || '{}')
  } catch {
    /* ignored: a bad override is no override */
  }
  const b = { ...(readBudgets(root)?.run ?? {}), ...env }
  const n = (v, d, lo = 1, hi = 86_400) => (Number.isFinite(Number(v)) && Number(v) >= lo ? Math.min(Number(v), hi) : d)
  return {
    installSeconds: n(b.installSeconds, 600),
    buildSeconds: n(b.buildSeconds, 600),
    testSeconds: n(b.testSeconds, 900),
    readmeSeconds: n(b.readmeSeconds, 60),
    bootSeconds: n(b.bootSeconds, 15),
    flakyRuns: Math.floor(n(b.flakyRuns, 3, 2, 10)),
  }
}

const sub = (state, id, why = '') => console.log(`MEERKAT-SUB ${state} ${id}${why ? ` ${safe(why).replace(/\s+/g, ' ').slice(0, 190)}` : ''}`)
const lastLines = (text, n = 3) => String(text).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n)
const NETWORK = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|getaddrinfo|network (error|is unreachable)|fetch failed|Could not resolve host|Temporary failure in name resolution|no such host|dial tcp|Failed to fetch|Connection timed out/i

// A clean copy plus a scrubbed environment, or a NOT RUN reason.
function prepare(root) {
  const copy = makeCleanCopy(root, { trackedOnly: true, maxMb: 200 })
  if (!copy.ok) return { reason: copy.reason }
  const home = makeTemp('meerkat-home-')
  const env = scrubbedEnv({}, { home })
  const done = () => {
    cleanup(copy.dir)
    cleanup(home)
  }
  return { copy, env, home, cmds: detectCommands(copy.dir), done }
}
// A program that is not installed here is NOT RUN (thrown, caught by guard()), never a failure of the project.
const step = async (p, argv, seconds, env = p.env) => {
  const r = await runIn(p.copy.dir, argv[0], argv.slice(1), { timeoutMs: seconds * 1000, env, maxOutputKb: 256 })
  if (r.code === 127 && !r.timedOut && /^(\S+: command not found|spawn .* ENOENT)\s*$/.test(r.output.trim())) throw Object.assign(new Error('tool missing'), { notRunReason: `${argv[0]} is not installed or not on PATH here` })
  return r
}
const guard = (fn) => async (root) => {
  try {
    return await fn(root)
  } catch (e) {
    if (e?.notRunReason) return notRun(e.notRunReason)
    throw e
  }
}
const show = (argv) => argv.join(' ')

// Files the output says were missing (Cannot find module, ENOENT, No such file ...), made relative to the copy.
function missingFiles(output, dir) {
  const flat = String(output).replace(/\\/g, '/')
  const base = dir.replace(/\\/g, '/')
  const found = new Set()
  const pats = [/Cannot find module '([^']+)'/g, /ENOENT[^'\n]*'([^']+)'/g, /can't open file '([^']+)'/g, /No such file or directory[^'\n]*'([^']+)'/g, /(?:cat|cp|open|stat): ([^\s:]+): No such file/g, /Could not resolve "([^"]+)"/g, /Module not found[^'\n]*'([^']+)'/g, /error: couldn't read (\S+)/g, /can't find file for module `?(\w+)/g]
  for (const re of pats) for (const m of flat.matchAll(re)) found.add(m[1].replace(base, '').replace(/^\/+/, ''))
  return [...found].filter(Boolean).slice(0, 10)
}
// The files in the working tree that git does not track and does not ignore: the classic reason a clean copy misses a file.
function untrackedFiles(root) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean)
  } catch {
    return []
  }
}
function ignoredFiles(root) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter((f) => f && !f.endsWith('/'))
  } catch {
    return []
  }
}
function explainFailure(label, argv, r, p, root, seconds) {
  console.log(`${label}: the ${label === 'install' ? 'install' : label} step failed in a clean copy of the tracked files`)
  console.log(`  command: ${safe(show(argv))}`)
  console.log(r.timedOut ? `  it did not finish in ${seconds}s (budget run.${label}Seconds)` : `  exit code ${r.code}`)
  console.log('  last lines of its output:')
  for (const l of lastLines(r.output, 3)) console.log(`    ${safe(l).slice(0, 200)}`)
  const missing = missingFiles(r.output, p.copy.dir)
  if (missing.length) console.log(`  files it could not find: ${missing.map(safe).join(', ')}`)
  const ignoredNamed = ignoredFiles(root).filter((u) => String(r.output).includes(basename(u)))
  if (ignoredNamed.length) console.log(`  probable cause: these files exist in your folder but are ignored by .gitignore, so a fresh checkout lacks them: ${ignoredNamed.slice(0, 10).map(safe).join(', ')}`)
  const untracked = untrackedFiles(root)
  if (untracked.length) {
    const named = untracked.filter((u) => String(r.output).includes(basename(u)) || missing.some((m) => m.endsWith(posix.basename(u))))
    const rest = untracked.filter((u) => !named.includes(u))
    if (named.length) console.log(`  probable cause: these files exist in your folder but are NOT tracked by git, so a fresh checkout lacks them: ${named.slice(0, 10).map(safe).join(', ')}`)
    if (rest.length) console.log(`  also untracked and not ignored (${rest.length}): ${rest.slice(0, 10).map(safe).join(', ')}${rest.length > 10 ? ', ...' : ''}`)
  }
}

// ---- clean-copy-builds
async function cleanCopyBuilds(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    const { cmds } = p
    if (!cmds.build && !cmds.test) {
      sub('NA', 'clean-copy', 'no build or test command could be detected')
      return notRun('no build or test command could be detected (looked for package.json scripts, pytest, go.mod, Cargo.toml, pom.xml, .csproj)')
    }
    console.log(`clean-copy-builds: ${p.copy.copied} tracked file(s) copied (${p.copy.note})`)
    const plan = [['install', cmds.install, b.installSeconds], ['build', cmds.build, b.buildSeconds], ['test', cmds.test, b.testSeconds]]
    for (const [name, argv, secs] of plan) {
      if (!argv) {
        sub('NA', `clean-copy-${name}`, `no ${name} command detected`)
        continue
      }
      const r = await step(p, argv, secs)
      if (r.code === 0) {
        sub('PASS', `clean-copy-${name}`, `${show(argv)} passed in ${(r.ms / 1000).toFixed(1)}s`)
        console.log(`  ${name}: ${safe(show(argv))} passed (${(r.ms / 1000).toFixed(1)}s)`)
        continue
      }
      if (name === 'install' && NETWORK.test(r.output)) {
        sub('NA', 'clean-copy-install', 'install needs the network and it is not reachable')
        return notRun(`the install (${show(argv)}) needs the network and failed with a network error: ${safe(lastLines(r.output, 1)[0] ?? '')}`)
      }
      sub('FAIL', `clean-copy-${name}`, `${show(argv)} failed${r.timedOut ? ' (timed out)' : ` (exit ${r.code})`}`)
      explainFailure(name, argv, r, p, root, secs)
      return 1
    }
    console.log('clean-copy-builds: install, build and test all work in a clean copy of the tracked files')
    return 0
  } finally {
    p.done()
  }
}

// ---- install-reproducible
const sha = (f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null)
function frozenInstall(dir) {
  const has = (f) => existsSync(join(dir, f))
  if (has('package-lock.json')) return { argv: ['npm', 'ci'], locks: ['package-lock.json'] }
  if (has('pnpm-lock.yaml')) return { argv: ['pnpm', 'install', '--frozen-lockfile'], locks: ['pnpm-lock.yaml'] }
  if (has('yarn.lock')) return { argv: ['yarn', 'install', '--frozen-lockfile'], locks: ['yarn.lock'] }
  if (has('Cargo.lock')) return { argv: ['cargo', 'build', '--locked'], locks: ['Cargo.lock'] }
  if (has('go.mod')) return { argv: ['go', 'mod', 'verify'], locks: ['go.sum', 'go.mod'] }
  if (has('requirements.txt')) return { argv: ['python', '-m', 'pip', 'install', '--dry-run', '--no-deps', '-r', 'requirements.txt'], locks: ['requirements.txt'] }
  return null
}
async function installReproducible(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    const fi = frozenInstall(p.copy.dir)
    if (!fi) {
      sub('NA', 'frozen-install', 'no lockfile found')
      return notRun('no lockfile found (package-lock.json, pnpm-lock.yaml, yarn.lock, Cargo.lock, go.mod, requirements.txt)')
    }
    const before = fi.locks.map((f) => sha(join(p.copy.dir, f)))
    const r = await step(p, fi.argv, b.installSeconds)
    const after = fi.locks.map((f) => sha(join(p.copy.dir, f)))
    const changed = fi.locks.filter((f, i) => before[i] !== after[i])
    if (r.code !== 0 && NETWORK.test(r.output) && !/not in sync|out of sync|lockfile|lock file|needs to be updated|cannot install with/i.test(r.output)) {
      sub('NA', 'frozen-install', 'needs the network and it is not reachable')
      return notRun(`${show(fi.argv)} needs the network and failed with a network error: ${safe(lastLines(r.output, 1)[0] ?? '')}`)
    }
    if (r.code !== 0 || changed.length) {
      const why = changed.length ? `${changed.join(', ')} was rewritten by the install` : r.timedOut ? 'timed out' : `exit ${r.code}`
      sub('FAIL', 'frozen-install', `${show(fi.argv)}: ${why}`)
      console.log(`install-reproducible: the frozen install does not work from the tracked files: ${safe(show(fi.argv))}`)
      console.log(`  ${changed.length ? `the lockfile is out of sync with the manifest: ${changed.join(', ')} changed during the install` : `exit code ${r.code}, which usually means the lockfile does not match the manifest`}`)
      for (const l of lastLines(r.output, 3)) console.log(`    ${safe(l).slice(0, 200)}`)
      return 1
    }
    sub('PASS', 'frozen-install', `${show(fi.argv)} ran and left ${fi.locks.join(', ')} untouched`)
    console.log(`install-reproducible: ${safe(show(fi.argv))} works from the tracked files and does not change ${fi.locks.join(', ')}`)
    return 0
  } finally {
    p.done()
  }
}

// ---- readme-commands-work
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'console', 'powershell', 'ps1', 'zsh', 'terminal', 'cmd', 'bat', 'shell-session', 'sh-session'])
// Every candidate command line of a README: lines starting with "$ " anywhere, and every line of a bash/sh/shell/console/powershell block.
export function extractReadmeCommands(text) {
  const out = []
  const seen = new Set()
  const re = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm
  for (const m of text.matchAll(re)) {
    const lang = m[2].toLowerCase()
    const shellBlock = SHELL_LANGS.has(lang) && lang !== 'console' && lang !== 'shell-session' && lang !== 'sh-session'
    const joined = m[3].replace(/\\\r?\n/g, ' ').split(/\r?\n/)
    for (const raw of joined) {
      let line = raw.trim()
      const prompt = /^(\$|PS>|>)\s+(.*)$/.exec(line)
      if (prompt) line = prompt[2].trim()
      else if (!shellBlock) continue
      line = line.replace(/\s+#\s.*$/, '').trim()
      if (!line || line.startsWith('#') || seen.has(line)) continue
      seen.add(line)
      out.push(line)
    }
  }
  return out
}
const SAFE_FLAGS = new Set(['--help', '-h', '--version', '-v', '-V'])
const SLOW_SCRIPT = /^(start|dev|serve|watch|preview|storybook)(:|$)/
const DENY_MAKE = /^(install|uninstall|deploy|publish|release|push|upload|run|serve|dev|watch|docker|dist)$/
function makeTargets(dir) {
  try {
    const t = readFileSync(join(dir, existsSync(join(dir, 'Makefile')) ? 'Makefile' : 'makefile'), 'utf8')
    return new Set([...t.matchAll(/^([A-Za-z0-9_][\w.-]*)\s*:(?!=)/gm)].map((m) => m[1]))
  } catch {
    return null
  }
}
// Decide whether one README line may run. Returns { argv } or { na: reason }. `ctx` = { dir, scripts, deps, bins }.
export function classifyCommand(line, ctx) {
  if (/\bsudo\b|\bsu\b/.test(line)) return { na: 'not allowlisted: needs sudo' }
  if (/[|;&<>`]|\$|\\|\*|~|\bcurl\b|\bwget\b/.test(line)) return { na: 'not allowlisted: pipe, redirect, chaining, variable or download' }
  if (/["']/.test(line)) return { na: 'not allowlisted: quoted arguments are not run' }
  const t = line.split(/\s+/)
  const [prog, ...a] = t
  if (['rm', 'rmdir', 'mv', 'dd', 'chmod', 'chown', 'git', 'docker', 'docker-compose', 'ssh', 'scp', 'kubectl', 'terraform', 'cd', 'export', 'set', 'source', 'echo', 'cat', 'brew', 'apt', 'apt-get', 'yum', 'winget', 'choco'].includes(prog)) return { na: `not allowlisted: ${prog}` }
  const flags = (xs, ok) => xs.every((x) => ok.has(x))
  const rel = (f) => /^[\w][\w./-]*$/.test(f) && !f.includes('..') && existsSync(join(ctx.dir, f))
  if (prog === 'npm') {
    const [sc, ...r] = a
    const INSTALL_OK = new Set(['--no-audit', '--no-fund', '--ignore-scripts', '--legacy-peer-deps', '--prefer-offline'])
    if (['install', 'i', 'ci'].includes(sc)) return flags(r, INSTALL_OK) ? { argv: ['npm', sc === 'i' ? 'install' : sc, ...r], install: true } : { na: 'not allowlisted: npm install with a package name or unknown option' }
    if (sc === 'test' || sc === 't') return r.length === 0 ? { argv: ['npm', 'test'], needsDeps: true } : { na: 'not allowlisted: npm test with arguments' }
    if (sc === 'start') return r.length === 1 && SAFE_FLAGS.has(r[0]) ? { argv: ['npm', 'start', '--', r[0]], needsDeps: true } : { na: 'not allowlisted: npm start runs a server, only --help is run' }
    if (sc === 'run' || sc === 'run-script') {
      const [name, ...rr] = r
      if (!name || !/^[\w:.-]+$/.test(name)) return { na: 'not allowlisted: odd script name' }
      if (!Object.hasOwn(ctx.scripts, name)) return { na: `not allowlisted: no "${name}" script in package.json` }
      if (SLOW_SCRIPT.test(name)) return { na: 'not allowlisted: a long-running server script is not run' }
      if (rr.length && !(rr.length === 1 && SAFE_FLAGS.has(rr[0]))) return { na: 'not allowlisted: script arguments' }
      return { argv: ['npm', 'run', name, ...(rr.length ? ['--', rr[0]] : [])], needsDeps: true }
    }
    return { na: `not allowlisted: npm ${sc ?? ''}`.trim() }
  }
  if (prog === 'npx') {
    const rr = a.filter((x) => x !== '--no-install')
    const [tool, ...r] = rr
    if (!tool || !/^[@\w][\w./@-]*$/.test(tool)) return { na: 'not allowlisted: npx tool name' }
    if (r.length !== 1 || !SAFE_FLAGS.has(r[0])) return { na: 'not allowlisted: npx only runs <tool> --help or --version' }
    if (!ctx.deps.has(tool) && !ctx.bins.has(tool)) return { na: 'not allowlisted: npx tool is not a dependency of this project (npx would download it)' }
    return { argv: ['npx', '--no-install', tool, r[0]], needsDeps: true }
  }
  if (prog === 'node' || prog === 'python' || prog === 'python3') {
    const [f, ...r] = a
    const okExt = prog === 'node' ? /\.(m|c)?js$/ : /\.py$/
    if (!f || !okExt.test(f) || !rel(f)) return { na: `not allowlisted: ${prog} runs only a file of this project` }
    if (r.length !== 1 || !SAFE_FLAGS.has(r[0])) return { na: `not allowlisted: ${prog} <file> only with --help or --version` }
    return { argv: [prog === 'python3' ? 'python' : prog, f, r[0]], needsDeps: true }
  }
  if (prog === 'pip' || prog === 'pip3') {
    if (a.length === 2 && a[0] === '-r' && rel(a[1])) return { argv: ['python', '-m', 'pip', 'install', '--dry-run', '-r', a[1]], network: true }
    if (a.length === 3 && a[0] === 'install' && a[1] === '-r' && rel(a[2])) return { argv: ['python', '-m', 'pip', 'install', '--dry-run', '-r', a[2]], network: true }
    return { na: 'not allowlisted: only pip install -r <file> (run as a dry run)' }
  }
  if (prog === 'cargo' && ['build', 'test'].includes(a[0])) return flags(a.slice(1), new Set(['--release', '--locked', '--offline', '--workspace', '--all'])) ? { argv: ['cargo', ...a] } : { na: 'not allowlisted: cargo option' }
  if (prog === 'go' && ['build', 'test'].includes(a[0])) return flags(a.slice(1), new Set(['./...', '.', '-v'])) ? { argv: ['go', ...a] } : { na: 'not allowlisted: go option' }
  if (prog === 'make') {
    const targets = makeTargets(ctx.dir)
    if (!targets) return { na: 'not allowlisted: no Makefile' }
    if (a.length > 1 || (a[0] && (a[0].includes('=') || a[0].startsWith('-')))) return { na: 'not allowlisted: make with options or variables' }
    if (!a[0]) return { argv: ['make'] }
    if (!targets.has(a[0]) || DENY_MAKE.test(a[0])) return { na: `not allowlisted: make target ${a[0]} is unknown or deploys/installs` }
    return { argv: ['make', a[0]] }
  }
  return { na: `not allowlisted: ${prog}` }
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 52)
async function readmeCommandsWork(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    const dir = p.copy.dir
    const rf = ['README.md', 'readme.md', 'Readme.md', 'README'].find((f) => existsSync(join(dir, f)))
    if (!rf) return notRun('no README.md among the tracked files')
    const lines = extractReadmeCommands(readFileSync(join(dir, rf), 'utf8'))
    if (!lines.length) return notRun(`${rf} has no shell commands`)
    let pkg = {}
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      /* no package.json */
    }
    const ctx = { dir, scripts: pkg.scripts ?? {}, deps: new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]), bins: new Set(typeof pkg.bin === 'string' ? [pkg.name] : Object.keys(pkg.bin ?? {})) }
    const plan = lines.map((l, i) => ({ line: l, i: i + 1, ...classifyCommand(l, ctx) }))
    const runnable = plan.filter((x) => x.argv)
    let depsOk = true
    let installNote = ''
    if (runnable.some((x) => x.needsDeps) && p.cmds.install && !runnable.some((x) => x.install)) {
      const ir = await step(p, p.cmds.install, b.installSeconds)
      if (ir.code !== 0) {
        depsOk = false
        installNote = NETWORK.test(ir.output) ? 'the dependency install needs the network and it is not reachable' : 'the dependency install failed (see clean-copy-builds)'
      }
    }
    let failed = 0
    let ran = 0
    const used = new Set()
    for (const x of plan) {
      let id = `cmd-${x.i}-${slug(x.line)}`.replace(/-$/, '')
      if (used.has(id)) id = `${id.slice(0, 55)}-${x.i}`
      used.add(id)
      if (!x.argv) {
        sub('NA', id, x.na)
        continue
      }
      if (x.needsDeps && !depsOk) {
        sub('NA', id, installNote)
        continue
      }
      const r = await step(p, x.argv, b.readmeSeconds)
      ran++
      if (r.code === 0) sub('PASS', id, `${x.line} worked (${(r.ms / 1000).toFixed(1)}s)`)
      else if (x.network && NETWORK.test(r.output)) sub('NA', id, 'needs the network and it is not reachable')
      else {
        failed++
        sub('FAIL', id, `${x.line} ${r.timedOut ? `did not finish in ${b.readmeSeconds}s` : `exited ${r.code}`}: ${lastLines(r.output, 1)[0] ?? ''}`)
      }
    }
    console.log(`readme-commands-work: ${lines.length} command(s) in ${safe(rf)}; ${ran} allowlisted and run, ${plan.length - runnable.length} not allowlisted (not run), ${failed} failed`)
    if (failed) {
      console.log('  a failed command is one the README tells people to type that does not work in a clean copy')
      return 1
    }
    if (!ran) return notRun(`none of the ${lines.length} README command(s) is on the allowlist, so nothing was verified`)
    return 0
  } finally {
    p.done()
  }
}

// ---- flaky-tests
async function flakyTests(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    if (!p.cmds.test) {
      sub('NA', 'flakiness', 'no test command detected')
      return notRun('no test command could be detected')
    }
    if (p.cmds.install) {
      const ir = await step(p, p.cmds.install, b.installSeconds)
      if (ir.code !== 0) {
        sub('NA', 'flakiness', 'install failed')
        return notRun(NETWORK.test(ir.output) ? 'the dependency install needs the network and it is not reachable' : `the dependency install failed: ${safe(lastLines(ir.output, 1)[0] ?? '')}`)
      }
    }
    const n = b.flakyRuns
    const results = []
    for (let i = 1; i <= n; i++) {
      const r = await step(p, p.cmds.test, b.testSeconds)
      results.push({ run: i, ok: r.code === 0, r })
      if (i === 1 && r.ms / 1000 > b.testSeconds / n) {
        sub('NA', 'flakiness', 'tests are too slow to repeat within the budget')
        return notRun(`one test run took ${(r.ms / 1000).toFixed(0)}s, more than run.testSeconds (${b.testSeconds}s) divided by ${n} runs`)
      }
    }
    const pass = results.filter((x) => x.ok).map((x) => x.run)
    const fail = results.filter((x) => !x.ok)
    if (pass.length && fail.length) {
      sub('FAIL', 'flakiness', `run${pass.length > 1 ? 's' : ''} ${pass.join(',')} passed, run${fail.length > 1 ? 's' : ''} ${fail.map((x) => x.run).join(',')} failed`)
      console.log(`flaky-tests: the same tests gave different results in ${n} runs of ${safe(show(p.cmds.test))}`)
      console.log(`  passed in run(s) ${pass.join(', ')}; failed in run(s) ${fail.map((x) => x.run).join(', ')}`)
      console.log(`  last lines of the output of run ${fail[0].run}:`)
      for (const l of lastLines(fail[0].r.output, 5)) console.log(`    ${safe(l).slice(0, 200)}`)
      return 1
    }
    if (!pass.length) {
      sub('NA', 'flakiness', 'the tests fail every time, so they are broken, not flaky')
      console.log(`flaky-tests: the tests failed in all ${n} runs (broken, not flaky; clean-copy-builds reports why)`)
      return 0
    }
    sub('PASS', 'flakiness', `${n} runs, same result every time`)
    console.log(`flaky-tests: ${n} runs of ${safe(show(p.cmds.test))} all passed`)
    return 0
  } finally {
    p.done()
  }
}

// ---- env-example-boot
const SECRETISH = /SECRET|TOKEN|KEY|PASSW|PWD|PRIVATE|CREDENTIAL|AUTH|DSN|CERT|SALT|SIGNATURE|COOKIE|BEARER|SESSION/i
const PLACEHOLDER = /^(|changeme|change[-_]me|your[-_\w]*|<[^>]*>|x+|\.\.\.|todo|replace[-_\w]*|example|placeholder|secret|\*+)$/i
export function parseEnvExample(text) {
  const out = []
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw)
    if (m) out.push({ key: m[1], value: m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\s+#.*$/, '') })
  }
  return out
}
// Dummy values for keys whose names look non-secret. A key that looks secret gets nothing: no secret is ever invented.
export function dummyEnv(entries) {
  const env = {}
  const skipped = []
  for (const { key, value } of entries) {
    if (SECRETISH.test(key)) {
      skipped.push(key)
      continue
    }
    let v = value
    if (/^https?:\/\//i.test(v) && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(v)) v = 'http://127.0.0.1:9'
    else if (PLACEHOLDER.test(v)) {
      if (/PORT$/i.test(key)) v = '0'
      else if (/HOST(NAME)?$/i.test(key)) v = '127.0.0.1'
      else if (/(URL|URI|ENDPOINT)$/i.test(key)) v = 'http://127.0.0.1:9'
      else if (/^(DEBUG|.*_ENABLED|.*_DISABLED)$/i.test(key)) v = 'false'
      else if (/^(NODE_ENV|APP_ENV|ENV|ENVIRONMENT)$/i.test(key)) v = 'development'
      else v = 'placeholder'
    }
    env[key] = v
  }
  return { env, skipped }
}
const NOT_VAR = /^(ERR_[A-Z_]+|E[A-Z]{3,}|MODULE_NOT_FOUND|JSON|HTTP|HTTPS|URL|ENV|NODE|TRUE|FALSE|NULL|UNDEFINED|ERROR|FATAL|WARN|INFO)$/
export function undocumentedVars(output, documented) {
  const found = new Set()
  for (const line of String(output).split(/\r?\n/)) {
    if (!/missing|required|not set|undefined|not defined|must be (set|defined|provided)|environment variable|env var|unset/i.test(line)) continue
    for (const m of line.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{4,})\b/g)) if (!NOT_VAR.test(m[1]) && !documented.has(m[1])) found.add(m[1])
  }
  return [...found]
}
async function envExampleBoot(root) {
  const b = budgets(root)
  const p = prepare(root)
  if (p.reason) return notRun(p.reason)
  try {
    const dir = p.copy.dir
    const ex = ['.env.example', '.env.sample', '.env.template'].find((f) => existsSync(join(dir, f)))
    if (!ex) return notRun('no .env.example among the tracked files')
    const startCmd = p.cmds.start ?? p.cmds.dev
    if (!startCmd) {
      sub('NA', 'boot', 'no start or dev command detected')
      return notRun('no start or dev command could be detected')
    }
    const entries = parseEnvExample(readFileSync(join(dir, ex), 'utf8'))
    const documented = new Set(entries.map((e) => e.key))
    const { env: dummies, skipped } = dummyEnv(entries)
    writeFileSync(join(dir, '.env'), `${Object.entries(dummies).map(([k, v]) => `${k}=${v}`).join('\n')}\n`)
    if (p.cmds.install) {
      const ir = await step(p, p.cmds.install, b.installSeconds)
      if (ir.code !== 0) {
        sub('NA', 'boot', 'install failed')
        return notRun(NETWORK.test(ir.output) ? 'the dependency install needs the network and it is not reachable' : 'the dependency install failed (see clean-copy-builds)')
      }
    }
    if (p.cmds.build) {
      const br = await step(p, p.cmds.build, b.buildSeconds)
      if (br.code !== 0) {
        sub('NA', 'boot', 'build failed')
        return notRun('the build failed before the start command could run (see clean-copy-builds)')
      }
    }
    const env = scrubbedEnv(dummies, { home: p.home })
    const r = await step(p, startCmd, b.bootSeconds, env)
    console.log(`env-example-boot: ran ${safe(show(startCmd))} with ${Object.keys(dummies).length} dummy value(s) from ${safe(ex)}${skipped.length ? `; left ${skipped.length} secret-looking key(s) unset: ${skipped.slice(0, 8).map(safe).join(', ')}` : ''}`)
    const missing = r.timedOut ? [] : undocumentedVars(r.output, documented)
    if (r.code !== 0 && !r.timedOut && missing.length) {
      sub('FAIL', 'boot', `needs ${missing.join(', ')}, which ${ex} does not list`)
      console.log(`  it stopped with an error about environment variable(s) that ${safe(ex)} does not list: ${missing.map(safe).join(', ')}`)
      for (const l of lastLines(r.output, 3)) console.log(`    ${safe(l).slice(0, 200)}`)
      return 1
    }
    if (r.timedOut || r.code === 0) {
      sub('PASS', 'boot', r.timedOut ? `still running after ${b.bootSeconds}s` : 'started and exited cleanly')
      console.log(`  ${r.timedOut ? `it was still running after ${b.bootSeconds}s (stopped)` : 'it exited cleanly'}`)
      return 0
    }
    sub('NA', 'boot', `exited ${r.code} for a reason that is not a missing variable`)
    console.log(`  it exited ${r.code}, but not because of an undocumented variable:`)
    for (const l of lastLines(r.output, 3)) console.log(`    ${safe(l).slice(0, 200)}`)
    return 0
  } finally {
    p.done()
  }
}

// ---- fixtures: each builds a tiny project whose check must exit 1
const git = (dir, ...a) => execFileSync('git', ['-c', 'user.name=meerkat', '-c', 'user.email=meerkat@example.invalid', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { stdio: 'ignore' })
export function commitAll(dir, except = []) {
  git(dir, 'init', '-q')
  git(dir, 'add', '-A')
  for (const f of except) git(dir, 'rm', '-q', '--cached', f)
  git(dir, 'commit', '-q', '-m', 'fixture')
}
const pkg = (scripts, extra = {}) => `${JSON.stringify({ name: 'fixture', version: '1.0.0', scripts, ...extra }, null, 2)}\n`
const fx = (tree, fn, untracked = {}) => ({
  fixture: () =>
    withFixture(tree, async (dir) => {
      commitAll(dir)
      for (const [name, body] of Object.entries(untracked)) writeFileSync(join(dir, name), body)
      return fn(dir)
    }),
})
const COUNTER = "const fs=require('fs');const n=(fs.existsSync('.count')?+fs.readFileSync('.count','utf8'):0)+1;fs.writeFileSync('.count',String(n));process.exit(n===2?1:0)\n"

const entry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (entry) main({
  'clean-copy-builds': {
    run: guard(cleanCopyBuilds),
    ...fx({ 'package.json': pkg({ build: 'node build.js' }), 'build.js': "require('./helper.js')\n" }, guard(cleanCopyBuilds), { 'helper.js': 'module.exports = 1\n' }),
  },
  'install-reproducible': {
    run: guard(installReproducible),
    ...fx({ 'package.json': pkg({}, { dependencies: { 'left-pad': '^1.3.0' } }), 'package-lock.json': `${JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture', version: '1.0.0' } } })}\n` }, guard(installReproducible)),
  },
  'readme-commands-work': {
    run: guard(readmeCommandsWork),
    ...fx({ 'README.md': '# Fixture\n\n```bash\nnode cli.js --help\n```\n', 'cli.js': 'process.exit(1)\n', 'package.json': pkg({}) }, guard(readmeCommandsWork)),
  },
  'flaky-tests': { run: guard(flakyTests), ...fx({ 'package.json': pkg({ test: 'node test.js' }), 'test.js': COUNTER, '.gitignore': '.count\n' }, guard(flakyTests)) },
  'env-example-boot': {
    run: guard(envExampleBoot),
    ...fx({ 'package.json': pkg({ start: 'node start.js' }), '.env.example': 'PORT=3000\n', 'start.js': "console.error('Error: missing environment variable API_BASE_URL');process.exit(1)\n" }, guard(envExampleBoot)),
  },
})

export { NOT_RUN }
