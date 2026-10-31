// The health pack: static performance smells and dependency health, with no tool to install. Turn it on with { "packs": ["health"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const HS = `${MK}/thorough/health.mjs`
const make = (id, group, title) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  run: { cmd: 'node', args: [HS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [HS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('sync-fs-in-handlers', 'performance', 'No blocking file or process call inside a server request or event handler'),
  make('json-parse-in-loop', 'performance', 'JSON parse and stringify inside loops stay within their budget'),
  make('regex-in-loop', 'performance', 'No RegExp is built inside a loop'),
  make('dom-query-in-loop', 'performance', 'No document lookup is repeated inside a frontend loop'),
  make('large-inline-assets', 'performance', 'No inline data URI is over its size budget (default 20 KB)'),
  make('unoptimised-images', 'performance', 'No image is over its size budget (default 500 KB), and no bmp or tiff'),
  make('duplicate-dependencies', 'functionality', 'No package is listed twice in package.json'),
  make('wildcard-versions', 'functionality', 'Dependencies name a version, not *, latest, empty or a git or URL spec'),
  make('dependency-count', 'functionality', 'Direct dependency count stays within its budget (default 150)'),
  make('dev-deps-in-prod', 'functionality', 'No build or test tool is listed under dependencies in an application'),
  make('deprecated-apis', 'functionality', 'No deprecated or removed Node API is called'),
  make('node-version-mismatch', 'functionality', 'The Node major in .nvmrc, engines, Dockerfiles and workflows agree'),
  make('lockfile-in-sync', 'functionality', 'package-lock.json and package.json name the same direct dependencies'),
  make('unused-dependencies-quick', 'functionality', 'Every listed dependency is mentioned by some tracked source or script'),
]
