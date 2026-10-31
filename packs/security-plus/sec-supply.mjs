// The security-plus pack: git-history and supply-chain checks that fit any project. Turn it on with { "packs": ["security-plus"] } in meerkat.config.json.
//   git-history-secrets       secrets ever committed, even if removed since (thorough)
//   env-files-in-history      key and environment files that were ever committed
//   install-scripts           code that runs when a package is installed
//   typosquat-names           dependency names one letter away from a popular package
//   docker-base-pinning       Docker base images that float, downloads piped into a shell, root containers
//   actions-secrets-echo      workflows that print or leak secrets, or keep git credentials they do not need
//   requirements-hashes       Python, npm and Cargo installs that are not pinned, or use plain http
//   lockfile-registry-hosts   packages fetched from a host other than the registry the project chose
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const SC = `${MK}/thorough/sec-supply.mjs`
const check = (id, title, { tier = 'fast', weight = 'tiny', git = false } = {}) => ({
  id,
  group: 'security',
  tier,
  lane: 'free',
  weight,
  title,
  estSeconds: git ? 10 : 3,
  needs: git ? ['node', 'git'] : ['node'],
  run: { cmd: 'node', args: [SC, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [SC, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  check('git-history-secrets', 'Git history: secrets ever committed, even if removed since', { tier: 'thorough', weight: 'light', git: true }),
  check('env-files-in-history', 'Git history: key and environment files that were ever committed', { git: true }),
  check('install-scripts', 'Code that runs on install: the project scripts and dependency install scripts'),
  check('typosquat-names', 'Dependency names that look like a misspelt popular package'),
  check('docker-base-pinning', 'Docker: base images pinned, no download piped into a shell, a non-root user'),
  check('actions-secrets-echo', 'GitHub Actions: no secrets printed or leaked, no broad permissions'),
  check('requirements-hashes', 'Installs pinned to a version or hash, and not fetched over plain http'),
  check('lockfile-registry-hosts', 'Lockfiles: every package comes from the registry the project chose'),
]
