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

export default [
  {
    id: 'rust-fmt',
    group: 'functionality',
    tier: 'fast',
    lane: 'cargo',
    title: 'Rust formatting (cargo fmt --check)',
    estSeconds: 4,
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
    estSeconds: 120,
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
    estSeconds: 150,
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
    estSeconds: 4,
    needs: ['cargo-audit'],
    paths: ['Cargo.lock', '.cargo/audit.toml'],
    run: { cmd: 'cargo', args: ['audit'], cwd: 'repo' },
    selfTest: { cmd: 'cargo', args: ['audit', '--no-fetch', '--file', `${FIX}/cargo-audit/Cargo.lock`], cwd: 'repo', expectFail: true },
  },
  {
    id: 'rust-build-release',
    group: 'functionality',
    tier: 'thorough',
    lane: 'cargo',
    cost: { cpu: 8, memGB: 4 },
    title: 'Rust release build (cargo build --release)',
    estSeconds: 300,
    timeoutSeconds: 1800,
    needs: ['cargo'],
    paths: RUST_PATHS,
    run: { cmd: 'cargo', args: ['build', '--workspace', '--release'], cwd: 'repo' },
    selfTest: { cmd: 'cargo', args: ['build', '--manifest-path', `${FIX}/build-broken/Cargo.toml`], cwd: 'repo', expectFail: true },
  },
]
