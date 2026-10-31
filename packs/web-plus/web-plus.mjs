// The web-plus pack: markup, security header, image, robots and manifest checks, and !important overuse, with no tool to install. Turn it on with { "packs": ["web-plus"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const WP = `${MK}/thorough/web-plus.mjs`
const make = (id, group, title, paths) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 3,
  needs: ['node'],
  ...(paths ? { paths } : {}),
  run: { cmd: 'node', args: [WP, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [WP, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('html-valid-basics', 'ui', 'Pages have a doctype, and their common tags nest and close in order', ['**/*.html']),
  make('duplicate-ids', 'ui', 'No id is used twice in one page', ['**/*.html']),
  make('inline-event-handlers', 'security', 'Markup has no inline script handlers (onclick and similar) or javascript: links', ['**/*.html']),
  make('target-blank-noopener', 'security', 'Every link that opens a new tab has rel="noopener"', ['**/*.html', '**/*.jsx', '**/*.tsx', '**/*.vue', '**/*.svelte']),
  make('csp-present', 'security', 'A site with HTML pages sends a Content-Security-Policy', ['**/*.html']),
  make('image-dimensions', 'ui', 'Every image has a width and height, and large local images load lazily', ['**/*.html']),
  make('robots-sitemap', 'ui', 'A web root with an index.html has a robots.txt or a sitemap.xml', ['**/index.html']),
  make('manifest-valid', 'ui', 'Web app manifests are valid JSON with a name, icons and a start_url', ['**/*.webmanifest', '**/manifest.json']),
  make('css-important-overuse', 'ui', 'The number of !important rules stays within the budget (default 20)', ['**/*.css', '**/*.scss', '**/*.less']),
]
