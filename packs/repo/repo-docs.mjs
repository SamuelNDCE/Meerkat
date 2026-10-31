// The repo pack: the documents and config a healthy project carries (README, security policy, licence, CI, dependency updates). Turn it on with { "packs": ["repo"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const SCRIPT = `${MK}/thorough/repo-docs.mjs`
const make = (id, title, group = 'functionality') => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 2,
  needs: ['node'],
  run: { cmd: 'node', args: [SCRIPT, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [SCRIPT, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('readme-sections', 'README has a title, a how-to-run heading and a licence mention'),
  make('security-policy', 'SECURITY.md says how to report a security problem', 'security'),
  make('contributing-file', 'CONTRIBUTING.md exists once a project has a README and several source files'),
  make('codeowners-valid', 'CODEOWNERS: every pattern has a real owner, and no pattern is listed twice'),
  make('gitignore-essentials', '.gitignore covers dependencies, secrets and OS junk, and nothing it ignores is committed'),
  make('editorconfig-present', '.editorconfig exists once a project has several source files'),
  make('changelog-format', 'CHANGELOG.md has version headings, newest first'),
  make('license-matches', 'The LICENSE file agrees with the licence declared in package.json or Cargo.toml', 'security'),
  make('ci-present', 'An automated check config (CI) exists'),
  make('dependency-updates-configured', 'A dependency update bot (Dependabot or Renovate) is configured', 'security'),
]
