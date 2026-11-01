// `meerkat tools`: every optional outside tool Meerkat can use, whether it is found, and ONE combined install command per ecosystem.
// `meerkat tools install`: puts the missing npm-based ones in Meerkat's own folder (~/.meerkat/tools), never in the project and never global,
// with npm --prefix and --ignore-scripts (no install scripts run), only after showing the list and getting a yes (or --yes).
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { findBinary, localPath, toolsHome } from './which.mjs'
import { stripControl } from './tui/safe.mjs'

const s = (x) => stripControl(String(x ?? ''))

// bin: the program name; pkg: the package that provides it. ecosystem decides the combined command.
export const CATALOG = [
  { bin: 'eslint', ecosystem: 'npm', pkg: 'eslint', what: 'JavaScript lint' },
  { bin: 'prettier', ecosystem: 'npm', pkg: 'prettier', what: 'code formatting' },
  { bin: 'tsc', ecosystem: 'npm', pkg: 'typescript', what: 'TypeScript types' },
  { bin: 'madge', ecosystem: 'npm', pkg: 'madge', what: 'circular imports' },
  { bin: 'htmlhint', ecosystem: 'npm', pkg: 'htmlhint', what: 'HTML' },
  { bin: 'stylelint', ecosystem: 'npm', pkg: 'stylelint', what: 'CSS' },
  { bin: 'markdownlint-cli2', ecosystem: 'npm', pkg: 'markdownlint-cli2', what: 'Markdown (built-in fallback exists)' },
  { bin: 'yamllint', ecosystem: 'pip', pkg: 'yamllint', what: 'YAML (built-in fallback exists)' },
  { bin: 'ruff', ecosystem: 'pip', pkg: 'ruff', what: 'Python lint' },
  { bin: 'mypy', ecosystem: 'pip', pkg: 'mypy', what: 'Python types' },
  { bin: 'bandit', ecosystem: 'pip', pkg: 'bandit', what: 'Python security' },
  { bin: 'vulture', ecosystem: 'pip', pkg: 'vulture', what: 'dead Python code' },
  { bin: 'pytest', ecosystem: 'pip', pkg: 'pytest', what: 'Python tests' },
  { bin: 'typos', ecosystem: 'cargo', pkg: 'typos-cli', what: 'typos (built-in fallback exists)' },
  { bin: 'lychee', ecosystem: 'cargo', pkg: 'lychee', what: 'links between documents (built-in fallback exists)' },
  { bin: 'shellcheck', ecosystem: 'system', pkg: 'shellcheck', what: 'shell scripts (bash -n fallback exists)' },
  { bin: 'hadolint', ecosystem: 'system', pkg: 'hadolint', what: 'Dockerfiles' },
  { bin: 'actionlint', ecosystem: 'system', pkg: 'actionlint', what: 'GitHub Actions workflows' },
]

const SYSTEM_LINE = (pkgs) => `your package manager (brew, scoop, winget, apt): ${pkgs.join(' ')}`

export function combinedCommand(ecosystem, pkgs, { dir } = {}) {
  if (!pkgs.length) return null
  if (ecosystem === 'npm') return `npm install --prefix ${dir ?? '~/.meerkat/tools'} --ignore-scripts ${pkgs.join(' ')}   (or: meerkat tools install)`
  if (ecosystem === 'pip') return `pip install ${pkgs.join(' ')}`
  if (ecosystem === 'cargo') return `cargo install ${pkgs.join(' ')}`
  return SYSTEM_LINE(pkgs)
}

// The report: every catalog tool, found or not, where, and the combined command per ecosystem for what is missing.
export function toolsReport({ env = process.env, dirs = [], find = findBinary, home = homedir(), extra = [] } = {}) {
  const searchEnv = { ...env, ...localPath(env, dirs, home) }
  const known = new Set([...CATALOG.map((t) => t.bin), 'node'])
  const others = []
  for (const e of extra) {
    if (!e.bin || known.has(e.bin)) continue
    known.add(e.bin)
    others.push({ bin: s(e.bin), ecosystem: 'other', pkg: s(e.bin), what: '', install: e.install ? s(e.install) : null })
  }
  const rows = [...CATALOG, ...others].map((t) => {
    const path = find(t.bin, searchEnv)
    return { ...t, found: Boolean(path), path: path ?? null }
  })
  const missing = rows.filter((r) => !r.found)
  const dir = toolsHome(env, home)
  const commands = {}
  for (const eco of ['npm', 'pip', 'cargo', 'system']) {
    const c = combinedCommand(eco, missing.filter((r) => r.ecosystem === eco).map((r) => r.pkg), { dir })
    if (c) commands[eco] = c
  }
  const other = missing.filter((r) => r.ecosystem === 'other' && r.install)
  if (other.length) commands.other = other.map((r) => `${r.bin}: ${r.install}`).join('; ')
  return { dir, found: rows.length - missing.length, missing: missing.length, tools: rows, commands }
}

export function toolsText(r) {
  const lines = [`Meerkat tools (private cache: ${r.dir})`, `Found ${r.found} of ${r.tools.length}. A missing tool makes its check NOT RUN (or use a built-in fallback where one exists).`, '']
  for (const t of r.tools) lines.push(`  ${t.found ? 'found  ' : 'MISSING'} ${t.bin.padEnd(18)} ${t.found ? t.path : t.what}`)
  const keys = Object.keys(r.commands)
  if (keys.length) {
    lines.push('', 'Install what is missing (one command per ecosystem):')
    for (const k of keys) lines.push(`  ${k.padEnd(6)} ${r.commands[k]}`)
    if (r.commands.npm) lines.push('', 'The npm ones can be installed for you into Meerkat\'s own folder: meerkat tools install')
  } else lines.push('', 'Nothing is missing.')
  return lines.join('\n')
}

// Install the missing npm tools into the private cache. `run` is injectable for tests. Returns { ok, installed, code, text }.
export function installNpmTools(report, { run, env = process.env, platform = process.platform } = {}) {
  const pkgs = [...new Set(report.tools.filter((t) => t.ecosystem === 'npm' && !t.found).map((t) => t.pkg))]
  if (!pkgs.length) return { ok: true, installed: [], code: 0, text: 'No npm-based tool is missing.' }
  const npm = findBinary('npm', env, platform) ?? 'npm'
  const args = ['install', '--prefix', report.dir, '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel', 'error', ...pkgs]
  const exec = run ?? ((cmd, a) => {
    // A Windows .cmd shim needs a shell; every argument here is a fixed package name or Meerkat's own folder, which is quoted.
    const shell = platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
    return spawnSync(shell ? `"${cmd}"` : cmd, shell ? a.map((x) => (/[\s]/.test(x) ? `"${x}"` : x)) : a, { stdio: 'inherit', shell, env })
  })
  const r = exec(npm, args)
  if (r.error || (r.status ?? 1) !== 0) return { ok: false, installed: [], code: r.status ?? 1, text: `npm install failed${r.error ? `: ${s(r.error.message)}` : ''}. Nothing in your project was changed.` }
  return { ok: true, installed: pkgs, code: 0, text: `Installed into ${report.dir}: ${pkgs.join(', ')}. Meerkat finds them from there.` }
}

export function installPlanText(report) {
  const pkgs = [...new Set(report.tools.filter((t) => t.ecosystem === 'npm' && !t.found).map((t) => t.pkg))]
  if (!pkgs.length) return null
  return [`Meerkat will install these npm packages into ${report.dir} (not into your project, not global, install scripts off):`, ...pkgs.map((p) => `  ${p}`)].join('\n')
}
