// The security pack: checks that fit any project. Turn it on with { "packs": ["security"] } in meerkat.config.json.
//   secret-scan     keys, tokens and private keys in the files git tracks (fast, no tools to install)
//   npm-audit-all   known advisories in every npm dependency, dev ones included (thorough)
// A Rust project also gets cargo-audit and more from the "rust" pack.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const ST = `${MK}/thorough/static.mjs`
const staticCheck = (id, title, tier = 'fast') => ({
  id,
  group: 'security',
  tier,
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 3,
  needs: ['node'],
  run: { cmd: 'node', args: [ST, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [ST, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  staticCheck('risky-code', 'Risky calls: eval, shell strings, disabled TLS checks, weak hashes, plain http'),
  staticCheck('workflow-security', 'GitHub Actions: pinned actions, limited permissions, no script injection'),
  staticCheck('dependency-pinning', 'Dependencies name a fixed version, not latest or *'),
  staticCheck('lockfile-integrity', 'Locked packages are fetched securely and checksummed'),
  {
    id: 'secret-scan',
    group: 'security',
    tier: 'fast',
    lane: 'free',
    weight: 'tiny',
    title: 'Secret scan: keys, tokens and private keys in tracked files',
    estSeconds: 3,
    needs: ['node'],
    run: { cmd: 'node', args: [`${MK}/thorough/secret-scan.mjs`], cwd: 'repo' },
    selfTest: { cmd: 'node', args: [`${MK}/thorough/secret-scan.mjs`, '--fixtures'], cwd: 'repo', expectFail: true },
  },
  {
    id: 'npm-audit-all',
    group: 'security',
    tier: 'thorough',
    lane: 'free',
    weight: 'tiny',
    title: 'npm audit, high severity, every dependency including dev ones',
    estSeconds: 5,
    needs: ['npm'],
    paths: ['package.json', 'package-lock.json', '**/package.json', '**/package-lock.json'],
    run: { cmd: 'node', args: [`${MK}/thorough/npm-audit.mjs`], cwd: 'app' },
    // An offline registry makes audit fail, which is the failure this proves is not swallowed.
    selfTest: { cmd: 'npm', args: ['audit', '--audit-level=high', '--registry', 'http://127.0.0.1:9'], cwd: 'app', expectFail: true },
  },
]
