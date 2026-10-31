// The packaging pack: monorepo consistency and publish readiness (workspaces, npm, PyPI, crates.io, versions that must agree). Turn it on with { "packs": ["packaging"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const PS = `${MK}/thorough/packaging.mjs`
const make = (id, suite, title) => ({
  id,
  group: 'functionality',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  suite,
  needs: ['node'],
  run: { cmd: 'node', args: [PS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [PS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('workspaces-resolve', 'release-versioning', 'Every workspace pattern matches a folder with a package.json'),
  make('workspace-name-unique', 'release-versioning', 'No two workspaces share a package name'),
  make('workspace-version-alignment', 'dependencies', 'A dependency shared by several workspaces uses one version range (reported unless required)'),
  make('workspace-internal-ranges', 'dependencies', 'A workspace depending on a sibling uses a range that includes the sibling version'),
  make('workspace-cycles', 'dependencies', 'No circular dependencies between workspaces'),
  make('root-private', 'release-versioning', 'A monorepo root package.json is marked private'),
  make('npm-publish-files', 'release-versioning', 'A publishable npm package says what to ship (files field or .npmignore)'),
  make('npm-entry-exist', 'release-versioning', 'Every npm entry point (main, module, types, bin, exports) exists'),
  make('npm-pack-junk', 'release-versioning', 'No publishable npm package would ship tests, fixtures or env files'),
  make('pypi-metadata', 'release-versioning', 'A PyPI pyproject has name, version, description, readme, license, requires-python and classifiers'),
  make('pypi-entry-points', 'release-versioning', 'Every PyPI script or entry point names a module that exists'),
  make('crate-publish-ready', 'release-versioning', 'A publishable crate has its metadata and no path-only dependency'),
  make('version-sync', 'release-versioning', 'package.json, Cargo.toml, pyproject and pubspec in one folder agree on the version'),
  make('provenance-hints', 'release-versioning', 'npm release workflows ask for provenance (reported unless required)'),
]
