// The Rust pack: checks for any Cargo project (a single crate or a workspace). Turn it on with { "packs": ["rust"] } in meerkat.config.json,
// and add "builtin": false when the project is not the app Meerkat was first written for. Every command runs from the repository root.
//   rust-fmt            cargo fmt --check
//   rust-check          cargo check (compile only): runs first, so a compile error fails fast, before clippy and the tests
//   rust-clippy         cargo clippy, warnings are errors (runs after rust-check, before rust-test)
//   rust-test           cargo test, only the changed crates and their direct dependents when the change is inside crates, else the whole workspace
//   rust-test-workspace cargo test --workspace, the whole workspace; opt-in (--include workspace-test), not part of the per-change gate
//   rust-audit          cargo audit (known advisories in the dependencies)
//   rust-build-release  cargo build --release (catches what only breaks in a release build), thorough
// Cargo jobs share the machine-wide cargo lock, so only one Rust build runs at a time, however many checks there are.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'
import { affectedByLock, readLocks } from '../../lib/rustlock.mjs'

// A rust check runs only the crates the change touches plus their direct dependents (the crates that name one of them as a `path` dependency).
// A change to the workspace itself (root Cargo.toml, the toolchain, .cargo) runs everything, and so does a change outside every crate.
// A change to Cargo.lock alone is narrowed to the crates whose resolved dependency set changed (lib/rustlock.mjs); a lock that cannot be compared runs everything.
const WORKSPACE_FILES = /^(?:Cargo\.toml|Cargo\.lock|rust-toolchain(?:\.toml)?|\.cargo\/)/
const SKIP_DIRS = new Set(['target', 'node_modules', '.git'])
function crateNameOf(manifest) {
  const text = readFileSync(manifest, 'utf8')
  const pkg = /^\[package\]([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)
  return pkg ? (/^\s*name\s*=\s*"([^"]+)"/m.exec(pkg[1])?.[1] ?? null) : null
}
// The `path = "..."` values of a manifest's dependency tables: `name = { path = "../x" }` lines and `[dependencies.name]` tables. A small reader, not a TOML parser.
function pathDepsOf(manifest) {
  const text = readFileSync(manifest, 'utf8')
  const paths = []
  let inDeps = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const table = /^\[(.+)\]$/.exec(line)
    if (table) {
      inDeps = /(^|\.)(dependencies|dev-dependencies|build-dependencies)$/.test(table[1]) || /(^|\.)(dependencies|dev-dependencies|build-dependencies)\./.test(table[1])
      // [target.'cfg(x)'.dependencies] and [dependencies.name] both count; a plain `[dependencies.name]` table carries its own path line below.
      continue
    }
    if (!inDeps) continue
    const m = /\bpath\s*=\s*"([^"]+)"/.exec(line)
    if (m) paths.push(m[1])
  }
  return paths
}
// Every crate under the repo (depth 4): name, folder, and the folders of its path dependencies.
function workspaceCrates(root) {
  const crates = []
  const walk = (dir, depth) => {
    const m = join(dir, 'Cargo.toml')
    if (existsSync(m)) {
      const name = crateNameOf(m)
      if (name) crates.push({ name, dir: resolve(dir), deps: pathDepsOf(m).map((p) => resolve(dir, p)) })
    }
    if (depth >= 4) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name), depth + 1)
  }
  walk(root, 0)
  return crates
}
// -> { crates: [names, sorted], changed: [names], dependents: [names] } | { whole: reason } | null (nothing to say: no change list).
function cratesFor(ctx) {
  const files = (ctx.changedFiles ?? []).map((f) => String(f).replace(/\\/g, '/'))
  if (!files.length || !ctx.repoRoot) return null
  const wsFiles = files.filter((f) => WORKSPACE_FILES.test(f))
  if (wsFiles.some((f) => f !== 'Cargo.lock')) return { whole: 'the change touches the workspace itself (root Cargo.toml, toolchain or .cargo)' }
  const all = workspaceCrates(ctx.repoRoot)
  const changed = new Set()
  let lockOnly = false
  if (wsFiles.length) {
    try {
      const { oldText, newText } = readLocks(ctx.repoRoot, ctx.env ?? process.env)
      for (const n of affectedByLock(oldText, newText, all.map((c) => c.name)).affected) changed.add(n)
      lockOnly = true
    } catch (e) { return { whole: `Cargo.lock changed and could not be compared: ${e.message}` } }
  }
  for (const f of files) {
    if (!/\.rs$|(^|\/)Cargo\.toml$/.test(f)) continue
    const abs = resolve(ctx.repoRoot, f)
    // the deepest crate folder that contains the file
    const home = all.filter((c) => abs === c.dir || abs.startsWith(c.dir + sep)).sort((x, y) => y.dir.length - x.dir.length)[0]
    // Fail closed: a changed Rust file or manifest that no crate the scanner can see contains means the whole workspace runs.
    if (!home) return { whole: `a changed Rust file is not in any crate the scanner can see (${f})` }
    changed.add(home.name)
  }
  if (!changed.size && lockOnly && files.every((f) => f === 'Cargo.lock')) return { crates: [], changed: [], dependents: [], lockOnly }
  if (!changed.size) return { whole: 'the changed files are outside every crate' }
  const dirOf = new Map(all.map((c) => [c.name, c.dir]))
  const dependents = new Set()
  for (const c of all) if (!changed.has(c.name) && c.deps.some((d) => [...changed].some((n) => dirOf.get(n) === d))) dependents.add(c.name)
  return { crates: [...new Set([...changed, ...dependents])].sort(), changed: [...changed].sort(), dependents: [...dependents].sort(), lockOnly }
}
// `build(names)` gives the cargo arguments for those crates; a null result means "run the whole workspace" (the check's own arguments).
function scopeCargo(ctx, build, label) {
  const r = cratesFor(ctx)
  if (!r) return null
  const target = ctx.env?.CARGO_TARGET_DIR ?? 'the repo default target/'
  if (r.whole) return { args: undefined, note: `${label} ran the whole workspace (${r.whole})` }
  // Only Cargo.lock changed and no resolved dependency of any crate differs (a reorder, a comment): the documented minimum is a lockfile consistency check, no crate tests.
  if (!r.crates.length) return { args: ['metadata', '--locked', '--format-version', '1'], note: `${label} ran only cargo metadata --locked (Cargo.lock changed but no resolved dependency changed for any crate; the workspace run covers the rest)` }
  const dep = r.dependents.length ? `; dependents ${r.dependents.join(', ')}` : ''
  const via = r.lockOnly ? ', through Cargo.lock dependency changes' : ''
  return { args: build(r.crates), note: `${label} ran only the crate(s) ${r.crates.join(', ')} (changed ${r.changed.join(', ')}${via}${dep}; target: ${target}); the workspace run covers the rest` }
}
const pkgArgs = (names) => names.flatMap((n) => ['-p', n])
// rust-test's scope as a plain function (the whole-workspace case is null here: the check's arguments stand).
export function scopeRustTest(ctx) {
  const s = scopeCargo(ctx, (names) => ['test', ...pkgArgs(names)], 'rust-test')
  return s?.args ? s : null
}
const scopeFor = (label, build) => (ctx) => scopeCargo(ctx, build, label)
const FIX = `${MK}/fixtures`
const RUST_PATHS = ['**/*.rs', 'Cargo.toml', '**/Cargo.toml', 'Cargo.lock', '.cargo/**', 'rust-toolchain.toml']

// Every check here is about Cargo projects: a folder with no Cargo.toml passes with "not applicable" (lib/applies.mjs).
const CHECKS = [
  {
    id: 'rust-fmt',
    group: 'functionality',
    tier: 'fast',
    lane: 'cargo',
    title: 'Rust formatting (cargo fmt --check)',
    estSeconds: 10,
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['fmt', '--all', '--check'], cwd: 'repo' },
    selfTest: { cmd: 'rustfmt', args: ['--edition', '2021', '--check', `${FIX}/sidecar-fmt/broken.rs`], cwd: 'repo', expectFail: true },
  },
  {
    id: 'rust-check',
    group: 'functionality',
    tier: 'fast',
    lane: 'cargo',
    title: 'Rust compile check (cargo check, runs first)',
    estSeconds: 90, weight: 'heavy', scale: 'crates',
    timeoutSeconds: 1200,
    timeoutIsFail: true,
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['check', '--workspace', '--all-targets'], cwd: 'repo' },
    scopeArgs: scopeFor('rust-check', (names) => ['check', ...pkgArgs(names), '--all-targets']),
    selfTest: { cmd: 'cargo', args: ['check', '--manifest-path', `${FIX}/build-broken/Cargo.toml`], cwd: 'repo', expectFail: true },
  },
  {
    id: 'rust-clippy',
    // Ranked behind the compile check in the start order (ranking only, nothing waits on its result).
    orderAfter: ['rust-check'],
    timeoutIsFail: true,
    group: 'functionality',
    tier: 'fast',
    lane: 'cargo',
    title: 'Rust lints (cargo clippy, warnings are errors)',
    estSeconds: 180, weight: 'heavy', scale: 'crates',
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'], cwd: 'repo' },
    scopeArgs: scopeFor('rust-clippy', (names) => ['clippy', ...pkgArgs(names), '--all-targets', '--', '-D', 'warnings']),
    selfTest: { cmd: 'cargo', args: ['clippy', '--manifest-path', `${FIX}/clippy-broken/Cargo.toml`, '--', '-D', 'warnings'], cwd: 'repo', expectFail: true },
  },
  {
    id: 'rust-test',
    // Ranked behind the compile check and clippy in the start order (ranking only, a lint finding does not stop the tests). A time-limit stop is a FAIL, not NOT RUN.
    orderAfter: ['rust-check', 'rust-clippy'],
    timeoutIsFail: true,
    group: 'functionality',
    tier: 'fast',
    lane: 'cargo',
    cost: { cpu: 8, memGB: 4 },
    title: 'Rust tests (cargo test, the touched crates and their dependents)',
    estSeconds: 300, weight: 'heavy', scale: 'crates',
    // A cold cargo build of the scoped crate can pass 300 s on a large dependency tree; the scoped run needs the room to finish.
    timeoutSeconds: 1200,
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['test', '--workspace'], cwd: 'repo' },
    needsResult: true,
    scopeArgs: scopeFor('rust-test', (names) => ['test', ...pkgArgs(names)]),
    // A verdict waits for the cargo lock at most 300 s before it reports NOT RUN with the holder, instead of the lock default of 900 s.
    env: { MEERKAT_LOCK_MAX_WAIT: '300' },
    selfTest: { cmd: 'cargo', args: ['test', '--manifest-path', `${FIX}/test-broken/Cargo.toml`], cwd: 'repo', expectFail: true },
  },
  {
    // The full workspace test, kept apart from the per-change gate: rust-test runs the touched crates, this runs everything. Never narrowed.
    id: 'rust-test-workspace',
    optIn: 'workspace-test',
    group: 'functionality',
    tier: 'thorough',
    lane: 'cargo',
    cost: { cpu: 8, memGB: 4 },
    title: 'Rust tests (cargo test, the whole workspace)',
    estSeconds: 1500, weight: 'heavy', scale: 'crates',
    timeoutSeconds: 3600,
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['test', '--workspace'], cwd: 'repo' },
    needsResult: true,
    env: { MEERKAT_LOCK_MAX_WAIT: '300' },
    selfTest: { cmd: 'cargo', args: ['test', '--manifest-path', `${FIX}/test-broken/Cargo.toml`], cwd: 'repo', expectFail: true },
  },
  {
    id: 'rust-audit',
    group: 'security',
    tier: 'fast',
    lane: 'free',
    title: 'Rust dependency advisories (cargo audit)',
    estSeconds: 15,
    needs: ['cargo-audit'],
    paths: ['Cargo.lock', '.cargo/audit.toml'],
    run: { cmd: 'node', args: [`${MK}/thorough/offline-guard.mjs`, '--offline', "couldn't fetch advisory database|failed to prepare fetch|failed to resolve|could not resolve host", '--', 'cargo', 'audit'], cwd: 'repo' },
    selfTest: { cmd: 'cargo', args: ['audit', '--no-fetch', '--file', `${FIX}/cargo-audit/Cargo.lock`], cwd: 'repo', expectFail: true },
  },
  {
    id: 'rust-build-release',
    group: 'functionality',
    tier: 'thorough',
    lane: 'cargo',
    cost: { cpu: 8, memGB: 4 },
    title: 'Rust release build (cargo build --release)',
    estSeconds: 400, weight: 'heavy', scale: 'crates',
    timeoutSeconds: 1800,
    timeoutIsFail: true,
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['build', '--workspace', '--release'], cwd: 'repo' },
    scopeArgs: scopeFor('rust-build-release', (names) => ['build', ...pkgArgs(names), '--release']),
    selfTest: { cmd: 'cargo', args: ['build', '--manifest-path', `${FIX}/build-broken/Cargo.toml`], cwd: 'repo', expectFail: true },
  },
  {
    id: 'rust-doc',
    group: 'functionality',
    tier: 'thorough',
    lane: 'cargo',
    title: 'Rust documentation builds without warnings (cargo doc)',
    estSeconds: 120, weight: 'heavy', scale: 'crates',
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['doc', '--workspace', '--no-deps'], cwd: 'repo', env: { RUSTDOCFLAGS: '-D warnings' } },
    scopeArgs: scopeFor('rust-doc', (names) => ['doc', ...pkgArgs(names), '--no-deps']),
    selfTest: { cmd: 'cargo', args: ['doc', '--no-deps', '--manifest-path', `${FIX}/tools/rustdoc-broken/Cargo.toml`], cwd: 'repo', env: { RUSTDOCFLAGS: '-D warnings' }, expectFail: true, expectMatch: 'unresolved link' },
  },
  {
    id: 'rust-deny',
    optIn: 'deny',
    group: 'security',
    tier: 'fast',
    lane: 'free',
    weight: 'light',
    title: 'Rust dependency policy: licenses, banned crates, sources (cargo deny)',
    estSeconds: 20,
    needs: ['cargo-deny'],
    install: 'cargo install cargo-deny',
    paths: ['Cargo.lock', '**/Cargo.toml', 'deny.toml'],
    run: { cmd: 'cargo', args: ['deny', 'check', 'bans', 'licenses', 'sources'], cwd: 'repo' },
    selfTest: { cmd: 'cargo', args: ['deny', '--manifest-path', `${FIX}/tools/cargo-deny/Cargo.toml`, 'check', 'licenses'], cwd: 'repo', expectFail: true, expectMatch: 'GPL|license' },
  },
]

export default CHECKS.map((c) => ({ ...c, appliesTo: ['Cargo.toml', '**/Cargo.toml'] }))
