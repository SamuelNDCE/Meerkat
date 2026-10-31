// Repository file checks: the names, modes and layout of what git tracks, build output left in git, and whether package.json and its lockfiles agree.
// Run through the repo pack, or by hand:
//   node thorough/repo-files.mjs <check> [--root <dir>]      node thorough/repo-files.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "repo". Non-ASCII names you accept go in .meerkat-files-allow.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { finish, isFixture, main, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'

const GENERATED = new Set(['node_modules', 'dist', 'build', 'target', '.next', 'out', '__pycache__', 'coverage', '.venv'])
// build/ and out/ are also source folders (installer resources, icons) in many projects, so they count only when they hold compiled files.
const AMBIGUOUS = new Set(['build', 'out'])
const COMPILED = /\.(m?js|cjs|map|css|html?|wasm|pyc|o|a|so|dll|exe|class|jar|rlib)$/i
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

// Every git index entry with its file mode, or null when the folder is not a repository.
const gitIndex = (root) => {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 2 ** 20 })
    return out.split('\0').filter(Boolean).map((e) => {
      const tab = e.indexOf('\t')
      return { mode: e.slice(0, tab).split(' ')[0], path: e.slice(tab + 1) }
    })
  } catch {
    return null
  }
}

// Tracked names come from the index, not from disk, so a name Windows cannot create (CON, a 260+ character path) is still checked.
const listed = (root) => {
  const idx = gitIndex(root)
  return idx ? idx.map((e) => e.path) : trackedFiles(root)
}

const notGit = (name) => {
  console.log(`${name}: skipped, this folder is not a git repository, so there are no tracked file modes to check`)
  return 0
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const firstTwo = (p) => {
  try {
    return readFileSync(p).subarray(0, 2).toString('latin1')
  } catch {
    return ''
  }
}
const allowList = (root, name) => new Set(readText(root, name).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))

// ---- generated-files-tracked: build or dependency output that someone committed
const generatedFiles = (root) => {
  const files = listed(root)
  const tracked = new Set(files)
  // Go vendors on purpose when vendor/modules.txt is committed. A vendor/ folder without it is stray output.
  const flagVendor = existsSync(join(root, 'go.mod')) && !tracked.has('vendor/modules.txt')
  const f = []
  for (const x of files) {
    if (isFixture(x) || /(^|\/)(tests?|__tests__)\//i.test(x)) continue
    const dirs = x.split('/').slice(0, -1)
    const hit = dirs.find((s) => GENERATED.has(s) || (s === 'vendor' && flagVendor))
    if (hit && (!AMBIGUOUS.has(hit) || COMPILED.test(x))) f.push(`${x} is inside ${hit}/, which holds build or dependency output: remove it from git and add it to .gitignore`)
    else if (/\.pyc$/i.test(x)) f.push(`${x} is compiled Python: remove it from git and add *.pyc to .gitignore`)
  }
  return finish('generated-files-tracked', f, 'no build or dependency output is tracked')
}

// ---- case-conflicts: two paths that differ only by upper and lower case
const caseConflicts = (root) => {
  const groups = new Map()
  for (const x of listed(root)) {
    const key = x.toLowerCase()
    if (!groups.has(key)) groups.set(key, new Set())
    groups.get(key).add(x)
  }
  const f = [...groups.values()].filter((s) => s.size > 1).map((s) => `${[...s].join(' and ')} differ only by upper and lower case (they clash on Windows and macOS)`)
  return finish('case-conflicts', f, 'no two tracked paths differ only by case')
}

// ---- long-paths: paths Windows tools struggle with
const longPaths = (root) => {
  const max = readBudgets(root)?.repo?.maxPathLength ?? 200
  const f = listed(root).filter((x) => x.length > max).map((x) => `${x} is ${x.length} characters (limit ${max}): shorten the folder names`)
  return finish('long-paths', f, `every tracked path is under ${max} characters`)
}

// ---- reserved-names: names Windows cannot use
const reservedNames = (root) => {
  const f = []
  for (const x of listed(root)) {
    for (const seg of x.split('/')) {
      if (RESERVED.test(seg.split('.')[0])) f.push(`${x}: "${seg}" is a name Windows reserves (rename it)`)
      else if (/[. ]$/.test(seg)) f.push(`${x}: "${seg}" ends in a dot or space, which Windows silently strips`)
      else if (/[<>:"|?*]/.test(seg)) f.push(`${x}: "${seg}" contains a character Windows does not allow`)
    }
  }
  return finish('reserved-names', f, 'no name is one Windows cannot use')
}

// ---- non-ascii-filenames: accents, emoji and control characters in names
const nonAsciiFilenames = (root) => {
  const allow = allowList(root, '.meerkat-files-allow')
  const f = []
  for (const x of listed(root)) {
    if (allow.has(x)) continue
    if (/[^\x20-\x7e/]/.test(x)) f.push(`${x}: the name has a non-ASCII or control character (some tools mangle it: rename it, or list it in .meerkat-files-allow)`)
  }
  return finish('non-ascii-filenames', f, 'every tracked name is plain ASCII')
}

// ---- symlinks-tracked: symbolic links break on Windows checkouts
const symlinksTracked = (root) => {
  const idx = gitIndex(root)
  if (!idx) return notGit('symlinks-tracked')
  const f = idx.filter((e) => e.mode === '120000').map((e) => `${e.path} is a symbolic link (it breaks on Windows checkouts: replace it with a real file)`)
  return finish('symlinks-tracked', f, 'no symbolic links are tracked')
}

// ---- exec-bits: executable mode without a reason, and scripts that cannot run
const execBits = (root) => {
  const idx = gitIndex(root)
  if (!idx) return notGit('exec-bits')
  const f = []
  for (const e of idx) {
    const p = join(root, e.path)
    if (isFixture(e.path) || !existsSync(p)) continue
    const shebang = firstTwo(p) === '#!'
    if (e.mode === '100755' && !shebang && !/^(bin|scripts)\//.test(e.path)) f.push(`${e.path} is marked executable but has no #! line (remove the executable bit, or add the interpreter line)`)
    else if (e.mode === '100644' && /\.(sh|bash|py)$/i.test(e.path) && shebang) f.push(`${e.path} starts with #! but is not marked executable (run git update-index --chmod=+x on it)`)
  }
  return finish('exec-bits', f, 'executable bits match the files that need them')
}

// ---- package-fields: package.json has what a reader and a registry expect, and its entry points exist
const packageFields = (root) => {
  const pj = join(root, 'package.json')
  if (!existsSync(pj)) {
    console.log('package-fields: skipped, there is no package.json at the root')
    return 0
  }
  let j
  try {
    j = readJson(pj)
  } catch (e) {
    return finish('package-fields', [`package.json does not parse as JSON (${String(e.message).split('\n')[0]})`])
  }
  const f = []
  for (const k of ['name', 'version', 'license']) if (typeof j[k] !== 'string' || !j[k].trim()) f.push(`package.json has no "${k}"`)
  if (typeof j.version === 'string' && j.version && !SEMVER.test(j.version)) f.push(`package.json version "${j.version}" is not valid semver (use a form like 1.2.3)`)
  if (!j.private) for (const k of ['description', 'repository', 'engines']) if (!j[k]) f.push(`package.json has no "${k}" (needed because the package is not private)`)
  const paths = []
  if (typeof j.main === 'string') paths.push(['main', j.main])
  if (typeof j.bin === 'string') paths.push(['bin', j.bin])
  else if (j.bin && typeof j.bin === 'object') for (const v of Object.values(j.bin)) if (typeof v === 'string') paths.push(['bin', v])
  const walkExports = (v) => {
    if (typeof v === 'string') {
      if (v.startsWith('./')) paths.push(['exports', v])
    } else if (v && typeof v === 'object') for (const w of Object.values(v)) walkExports(w)
  }
  walkExports(j.exports)
  for (const [k, p] of paths) if (!p.includes('*') && !existsSync(join(root, p))) f.push(`package.json ${k} points at ${p}, which does not exist`)
  return finish('package-fields', f, 'package.json has its required fields and its entry points exist')
}

// Dependency names from a Cargo.toml, across [dependencies], [dev-dependencies], [build-dependencies] and target tables.
const cargoDeps = (text) => {
  const names = new Set()
  let inDeps = false
  for (const line of text.split('\n')) {
    const h = /^\s*\[([^\]]+)\]/.exec(line)
    if (h) {
      const m = /^(?:target\..+\.)?(?:dependencies|dev-dependencies|build-dependencies)(?:\.([A-Za-z0-9_-]+))?$/.exec(h[1].trim())
      if (m && m[1]) names.add(m[1])
      inDeps = Boolean(m) && !m[1]
      continue
    }
    if (!inDeps) continue
    const k = /^\s*([A-Za-z0-9_-]+)\s*(?:=|\.)/.exec(line)
    if (k) names.add(k[1])
  }
  return names
}

// ---- lockfile-sync: every declared dependency is in the lockfile, and the lock names the same package
const lockfileSync = (root) => {
  const f = []
  const notes = []
  const pj = join(root, 'package.json')
  const lk = join(root, 'package-lock.json')
  if (existsSync(pj) && existsSync(lk)) {
    let pkg
    let lock
    try {
      pkg = readJson(pj)
      lock = readJson(lk)
    } catch (e) {
      f.push(`package.json or package-lock.json does not parse as JSON (${String(e.message).split('\n')[0]})`)
    }
    if (pkg && lock) {
      const want = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})])
      for (const n of want) if (!lock.packages?.[`node_modules/${n}`] && !lock.dependencies?.[n]) f.push(`${n} is in package.json but not in package-lock.json (run npm install to refresh the lock)`)
      const lockName = lock.packages?.['']?.name ?? lock.name
      const lockVersion = lock.packages?.['']?.version ?? lock.version
      if (pkg.name !== undefined && lockName !== pkg.name) f.push(`package-lock.json names the package "${lockName}" but package.json says "${pkg.name}"`)
      if (pkg.version !== undefined && lockVersion !== pkg.version) f.push(`package-lock.json has version "${lockVersion}" but package.json says "${pkg.version}"`)
    }
  } else if (existsSync(pj)) notes.push('npm dependencies not compared: there is a package.json but no package-lock.json')
  else if (existsSync(lk)) notes.push('npm dependencies not compared: there is a package-lock.json but no package.json')

  const ct = join(root, 'Cargo.toml')
  const cl = join(root, 'Cargo.lock')
  if (existsSync(ct) && existsSync(cl)) {
    const lockNames = new Set([...readFileSync(cl, 'utf8').matchAll(/^name = "([^"]+)"/gm)].map((m) => m[1]))
    for (const n of cargoDeps(readFileSync(ct, 'utf8'))) if (!lockNames.has(n)) f.push(`${n} is in Cargo.toml but not in Cargo.lock (run cargo build to refresh the lock)`)
  } else if (existsSync(ct)) notes.push('Cargo dependencies not compared: there is a Cargo.toml but no Cargo.lock')
  for (const n of notes) console.log(`lockfile-sync: ${n}`)
  return finish('lockfile-sync', f, 'each lockfile lists every dependency its manifest declares (or there was nothing to compare)')
}

// ---- deprecated-deps: locked packages whose authors marked them deprecated (offline, from the lockfile itself)
const deprecatedDeps = (root) => {
  const locks = trackedFiles(root).filter((x) => /(^|\/)package-lock\.json$/.test(x) && !/node_modules/.test(x))
  if (!locks.length) {
    console.log('deprecated-deps: skipped, there is no package-lock.json')
    return 0
  }
  const f = []
  for (const x of locks) {
    let j
    try {
      j = JSON.parse(readText(root, x))
    } catch {
      continue
    }
    const seen = new Set()
    const note = (name, version, msg) => {
      const line = `${x}: ${name}@${version} is deprecated: ${msg}`
      if (!seen.has(line)) {
        seen.add(line)
        f.push(line)
      }
    }
    for (const [key, p] of Object.entries(j.packages ?? {})) {
      if (key && p?.deprecated) {
        const name = key.includes('node_modules/') ? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length) : key
        note(name, p.version, p.deprecated)
      }
    }
    const v1 = (deps) => {
      for (const [n, d] of Object.entries(deps ?? {})) {
        if (d?.deprecated) note(n, d.version, d.deprecated)
        v1(d?.dependencies)
      }
    }
    v1(j.dependencies)
  }
  return finish('deprecated-deps', f, 'no locked package is marked deprecated')
}

// A throwaway git repository whose index holds the given entries. An entry with disk: false exists only in the index,
// so a fixture can use a name Windows cannot create on disk (CON, aux.txt, a very long name).
const git = (dir, args, input) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const stagedFixture = (entries, run) =>
  withFixture({}, async (dir) => {
    git(dir, ['init', '-q'])
    for (const e of entries) {
      if (e.disk !== false) {
        mkdirSync(dirname(join(dir, e.path)), { recursive: true })
        writeFileSync(join(dir, e.path), e.body)
      }
      const sha = git(dir, ['-c', 'core.protectNTFS=false', 'hash-object', '-w', '--stdin'], e.body)
      git(dir, ['-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', `${e.mode ?? '100644'},${sha},${e.path}`])
    }
    return run(dir)
  })

main({
  'generated-files-tracked': { run: generatedFiles, fixture: () => withFixture({ 'dist/bundle.js': 'console.log(1)\n' }, generatedFiles) },
  'case-conflicts': { run: caseConflicts, fixture: () => stagedFixture([{ path: 'README.md', body: 'a\n', disk: false }, { path: 'readme.md', body: 'b\n', disk: false }], caseConflicts) },
  'long-paths': { run: longPaths, fixture: () => stagedFixture([{ path: `${'deep-folder-'.repeat(20)}file.txt`, body: 'a\n', disk: false }], longPaths) },
  'reserved-names': { run: reservedNames, fixture: () => stagedFixture([{ path: 'docs/aux.txt', body: 'a\n', disk: false }], reservedNames) },
  'non-ascii-filenames': { run: nonAsciiFilenames, fixture: () => stagedFixture([{ path: 'café.txt', body: 'a\n' }], nonAsciiFilenames) },
  'symlinks-tracked': { run: symlinksTracked, fixture: () => stagedFixture([{ path: 'link', mode: '120000', body: 'target.txt', disk: false }], symlinksTracked) },
  'exec-bits': { run: execBits, fixture: () => stagedFixture([{ path: 'tool.js', mode: '100755', body: 'console.log(1)\n' }], execBits) },
  'package-fields': { run: packageFields, fixture: () => withFixture({ 'package.json': JSON.stringify({ name: 'x', version: '1', main: './missing.js' }) }, packageFields) },
  'lockfile-sync': {
    run: lockfileSync,
    fixture: () =>
      withFixture(
        {
          'package.json': JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { left: '1.0.0' } }),
          'package-lock.json': JSON.stringify({ name: 'x', version: '1.0.0', packages: { '': { name: 'x', version: '1.0.0' } } }),
        },
        lockfileSync,
      ),
  },
  'deprecated-deps': { run: deprecatedDeps, fixture: () => withFixture({ 'package-lock.json': JSON.stringify({ packages: { '': {}, 'node_modules/old': { version: '1.0.0', deprecated: 'use new' } } }) }, deprecatedDeps) },
})
