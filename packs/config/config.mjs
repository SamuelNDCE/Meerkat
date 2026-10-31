// The config pack: YAML and TOML that read as valid, line endings and ignore rules that match what git tracks, Docker Compose hygiene,
// GitHub Actions timeouts and pinned runtimes, and the Node and TypeScript settings a project declares. No tool to install. Turn it on with { "packs": ["config"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const CS = `${MK}/thorough/config.mjs`
const make = (id, group, title) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  run: { cmd: 'node', args: [CS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [CS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('yaml-valid', 'functionality', 'Tracked YAML files read as valid (no tab indentation, repeated top-level keys or unclosed quotes)'),
  make('toml-valid', 'functionality', 'Tracked TOML files read as valid (no unclosed strings, repeated keys or bad table headers)'),
  make('gitattributes-eol', 'functionality', 'Text files use one line-ending style, or a .gitattributes file says which'),
  make('gitignored-but-tracked', 'functionality', 'No file that .gitignore says to ignore is still tracked by git'),
  make('compose-hygiene', 'security', 'Docker Compose: pinned images, no privileged containers or host networking, no open database ports, no passwords in the file'),
  make('ci-timeouts', 'functionality', 'Every GitHub Actions job sets timeout-minutes'),
  make('ci-node-version-pinned', 'functionality', 'GitHub Actions setup steps name a real runtime version, not latest or a floating alias'),
  make('node-engines', 'functionality', 'package.json declares engines.node, and .nvmrc is not below it'),
  make('tsconfig-strict', 'functionality', 'A TypeScript project has a tsconfig.json with strict turned on'),
]
