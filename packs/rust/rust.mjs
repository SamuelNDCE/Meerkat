// The Rust pack: checks for any Cargo project (a single crate or a workspace). Turn it on with { "packs": ["rust"] } in meerkat.config.json,
// and add "builtin": false when the project is not the app Meerkat was first written for. Every command runs from the repository root.
//   rust-fmt            cargo fmt --check
//   rust-clippy         cargo clippy, warnings are errors
//   rust-test           cargo test for the whole workspace
//   rust-audit          cargo audit (known advisories in the dependencies)
//   rust-build-release  cargo build --release (catches what only breaks in a release build), thorough
// Cargo jobs share the machine-wide cargo lock, so only one Rust build runs at a time, however many checks there are.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

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
    id: 'rust-clippy',
    group: 'functionality',
    tier: 'fast',
    lane: 'cargo',
    title: 'Rust lints (cargo clippy, warnings are errors)',
    estSeconds: 180, weight: 'heavy', scale: 'crates',
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'], cwd: 'repo' },
    selfTest: { cmd: 'cargo', args: ['clippy', '--manifest-path', `${FIX}/clippy-broken/Cargo.toml`, '--', '-D', 'warnings'], cwd: 'repo', expectFail: true },
  },
  {
    id: 'rust-test',
    group: 'functionality',
    tier: 'fast',
    lane: 'cargo',
    cost: { cpu: 8, memGB: 4 },
    title: 'Rust tests (cargo test, the whole workspace)',
    estSeconds: 300, weight: 'heavy', scale: 'crates',
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['test', '--workspace'], cwd: 'repo' },
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
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['build', '--workspace', '--release'], cwd: 'repo' },
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
