// The rust-plus pack: six checks of deeper Rust rules (unsafe code, error handling, async, performance and style, Cargo and cargo-deny
// configuration, API, FFI, WebAssembly and serde). Turn it on with { "packs": ["rust-plus"] } in meerkat.config.json. Each check prints
// one sub-check per rule (see docs/suites.md). A project with no Rust or Cargo files reports NA for every rule, never a failure.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'
import { CHECK_TABLES } from '../../thorough/rules-rust-plus.mjs'

const RP = `${MK}/thorough/rust-plus.mjs`
const check = (id, group, title) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 2,
  suite: 'rust',
  subs: CHECK_TABLES[id].length,
  needs: ['node'],
  run: { cmd: 'node', args: [RP, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [RP, id, '--fixtures'], cwd: 'repo', expectFail: true, expectMatch: 'found' },
})

export default [
  check('rp-safety', 'security', 'Rust unsafe code: SAFETY notes, unsafe fns and traits documented, no static mut or transmute misuse'),
  check('rp-errors', 'functionality', 'Rust error handling: no empty expect, no panics in library code, no lost error sources'),
  check('rp-async', 'functionality', 'Rust async: no blocking calls inside async fns, no held std locks across await, no dropped spawn handles'),
  check('rp-perf-style', 'performance', 'Rust performance and style: is_empty over len, no needless collect or clone, no regex compiled per call'),
  check('rp-cargo', 'functionality', 'Cargo manifests and cargo-deny config: metadata, release profile, no wildcard or unpinned git deps, no machine paths'),
  check('rp-api-ffi-wasm', 'functionality', 'Rust API, FFI, WebAssembly and serde: documented public items, C ABI symbols, no HTML injection, no serialized secrets'),
]
