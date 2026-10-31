// `meerkat recommend [folder]`: tests this project already has the means to run and that no Meerkat check covers yet.
// It only LOOKS (package.json scripts, test-runner config files, Makefile targets, Python and Docker files, the commands CI runs) and
// proposes custom checks. It never runs anything and never writes anything; adding is a separate, explicit step (--add, lib/yourapp.mjs).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { splitCommand } from './customchecks.mjs'
import { stripControl } from './tui/safe.mjs'

const read = (file) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}
const readJson = (file) => {
  try {
    return JSON.parse(read(file))
  } catch {
    return null
  }
}
const names = (dir) => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// package.json script name -> what the idea is called and how it is filed. [title, group, tier, seconds]
const SCRIPTS = {
  test: ['Unit tests', 'functionality', 'fast', 60],
  'test:e2e': ['End-to-end tests', 'functionality', 'thorough', 300],
  e2e: ['End-to-end tests', 'functionality', 'thorough', 300],
  lint: ['Lint', 'refactor', 'fast', 30],
  typecheck: ['Type check', 'functionality', 'fast', 30],
  build: ['Production build', 'functionality', 'thorough', 120],
  check: ['Project check script', 'functionality', 'thorough', 90],
  verify: ['Project verify script', 'functionality', 'thorough', 90],
  coverage: ['Test coverage', 'functionality', 'thorough', 120],
}
const JS_TOOLS = ['npm', 'pnpm', 'yarn', 'bun']

// "Is this already run by a check?" The same program and the same first argument; for a package manager, the same script name.
export function runKey(cmd, args = []) {
  if (JS_TOOLS.includes(cmd)) {
    const a = args[0] === 'run' || args[0] === 'run-script' ? args[1] : args[0]
    return `js:${a ?? ''}`
  }
  if (cmd === 'npx' || (JS_TOOLS.includes(cmd) && args[0] === 'exec')) return `tool:${args.find((x) => !x.startsWith('-')) ?? ''}`
  return `${cmd}:${args[0] ?? ''}`
}
const keyOfCheck = (c) => (c?.run && typeof c.run === 'object' && typeof c.run.cmd === 'string' ? runKey(c.run.cmd, c.run.args ?? []) : null)

function packageManager(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun'
  return 'npm'
}
const scriptArgs = (pm, name) => (name === 'test' ? ['test'] : pm === 'yarn' ? [name] : ['run', name])

// The ideas for a folder. `checks` are the checks that already apply (bundled and your own): their commands are not proposed again.
export function recommend(dir, { checks = [] } = {}) {
  const ideas = []
  const add = (idea) => {
    const bad = splitCommand([idea.cmd, ...idea.args].join(' '))
    if (!bad.ok) return
    ideas.push({ group: 'functionality', tier: 'thorough', ...idea, title: stripControl(idea.title), why: stripControl(idea.why) })
  }
  const pkg = readJson(join(dir, 'package.json'))
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {}
  const pm = packageManager(dir)
  for (const [name, [title, group, tier, est]] of Object.entries(SCRIPTS)) {
    if (typeof scripts[name] !== 'string') continue
    add({ id: `app-${slug(name)}`, title, cmd: pm, args: scriptArgs(pm, name), group, tier, estSeconds: est, why: `package.json has a "${name}" script` })
  }
  const files = names(dir)
  const has = (re) => files.some((f) => re.test(f))
  const haveE2eScript = typeof scripts['test:e2e'] === 'string' || typeof scripts.e2e === 'string'
  const haveTestScript = typeof scripts.test === 'string'
  if (has(/^playwright\.config\./) && !haveE2eScript) add({ id: 'app-playwright', title: 'Playwright tests', cmd: 'npx', args: ['playwright', 'test'], tier: 'thorough', estSeconds: 300, why: 'playwright.config found' })
  if (has(/^cypress\.config\./) && !haveE2eScript) add({ id: 'app-cypress', title: 'Cypress tests', cmd: 'npx', args: ['cypress', 'run'], tier: 'thorough', estSeconds: 300, why: 'cypress.config found' })
  if (has(/^vitest\.config\./) && !haveTestScript) add({ id: 'app-vitest', title: 'Vitest tests', cmd: 'npx', args: ['vitest', 'run'], tier: 'fast', estSeconds: 60, why: 'vitest.config found' })
  if ((has(/^jest\.config\./) || pkg?.jest) && !haveTestScript) add({ id: 'app-jest', title: 'Jest tests', cmd: 'npx', args: ['jest'], tier: 'fast', estSeconds: 60, why: 'a Jest config found' })
  if (has(/^\.mocharc/) && !haveTestScript) add({ id: 'app-mocha', title: 'Mocha tests', cmd: 'npx', args: ['mocha'], tier: 'fast', estSeconds: 60, why: '.mocharc found' })
  // Makefile targets
  const make = read(join(dir, 'Makefile')) ?? read(join(dir, 'makefile'))
  if (make) for (const t of ['test', 'lint', 'check']) if (new RegExp(`^${t}\\s*:`, 'm').test(make)) add({ id: `app-make-${t}`, title: `make ${t}`, cmd: 'make', args: [t], tier: t === 'lint' ? 'fast' : 'thorough', group: t === 'lint' ? 'refactor' : 'functionality', estSeconds: 60, why: `the Makefile has a "${t}" target` })
  // Python
  const pyproject = read(join(dir, 'pyproject.toml')) ?? ''
  if (existsSync(join(dir, 'tox.ini'))) add({ id: 'app-tox', title: 'tox test environments', cmd: 'tox', args: [], tier: 'thorough', estSeconds: 180, why: 'tox.ini found' })
  else if (existsSync(join(dir, 'pytest.ini')) || /\[tool\.pytest/.test(pyproject)) add({ id: 'app-pytest', title: 'pytest tests', cmd: 'pytest', args: [], tier: 'fast', estSeconds: 60, why: 'a pytest configuration found' })
  // Docker Compose
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    if (existsSync(join(dir, f))) {
      add({ id: 'app-compose-config', title: 'Compose file resolves', cmd: 'docker', args: ['compose', 'config', '--quiet'], tier: 'fast', estSeconds: 5, why: `${f} found (docker compose checks that it parses and resolves)` })
      break
    }
  }
  // Commands the project's own CI runs (single, simple lines only)
  const wf = join(dir, '.github', 'workflows')
  for (const f of names(wf).filter((n) => /\.ya?ml$/i.test(n))) {
    for (const m of (read(join(wf, f)) ?? '').matchAll(/^\s*-?\s*run:\s*([^\n|>][^\n]*)$/gm)) {
      const s = splitCommand(m[1].replace(/\s+#.*$/, ''))
      if (!s.ok || !['npm', 'pnpm', 'yarn', 'bun', 'make', 'pytest', 'tox'].includes(s.cmd)) continue
      const sub = s.args[0]
      if (!sub || ['ci', 'install', 'i', 'add', 'publish'].includes(sub)) continue
      if (JS_TOOLS.includes(s.cmd) && !['run', 'test', 'build'].includes(sub) && !(s.cmd === 'yarn' && /^[a-z][a-z0-9:-]*$/.test(sub))) continue
      const name = s.cmd === 'make' || sub === 'run' ? s.args[1] : sub
      if (!name || !/^[a-z0-9][a-z0-9:_-]*$/i.test(name)) continue
      add({ id: `app-ci-${slug(name)}`, title: `CI step: ${s.cmd} ${s.args.join(' ')}`.slice(0, 80), cmd: s.cmd, args: s.args, tier: 'thorough', estSeconds: 120, why: `.github/workflows/${f} runs it` })
    }
  }
  // Drop what a check already runs, what is already an id, and repeats of the same command.
  const covered = new Set(checks.map(keyOfCheck).filter(Boolean))
  const ids = new Set(checks.map((c) => c.id))
  const seen = new Set()
  const out = []
  let skipped = 0
  for (const i of ideas) {
    const key = runKey(i.cmd, i.args)
    if (covered.has(key) || ids.has(i.id)) {
      skipped++
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: i.id, title: i.title, cmd: i.cmd, args: i.args, group: i.group, tier: i.tier, estSeconds: i.estSeconds ?? 60, why: i.why })
  }
  return { ideas: out, covered: skipped }
}

// The one dim line at the end of a run: only when the project has no checks of its own and there is something to suggest.
export function tipLine({ dir, checks = [], env = process.env, quiet = false, json = false, plain = false } = {}) {
  if (quiet || json || plain || env.CI || env.MEERKAT_NO_TIP) return null
  if (checks.some((c) => c?.origin === 'personal' || c?.origin === 'project')) return null
  const n = recommend(dir, { checks }).ideas.length
  return n ? `Tip: meerkat recommend (${n} test${n === 1 ? '' : 's'} this project could run)` : null
}
