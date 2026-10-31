// The a11y pack: accessibility, markup and performance checks on pages and styles, with no browser and no tool to install. Switched on with { "packs": ["a11y"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const SCRIPT = `${MK}/thorough/a11y.mjs`
const PAGES = ['**/*.html', '**/*.htm', '**/*.jsx', '**/*.tsx', '**/*.vue', '**/*.svelte']
const STYLES = ['**/*.css', '**/*.scss']

const make = (id, group, title, paths) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  paths,
  run: { cmd: 'node', args: [SCRIPT, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [SCRIPT, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('aria-valid', 'ui', 'ARIA attributes and roles are real, and nothing focusable is hidden from screen readers', PAGES),
  make('link-text', 'ui', 'Every link has text that says where it goes (no empty or "click here" links)', PAGES),
  make('focus-visible', 'ui', 'No stylesheet removes the keyboard focus outline without putting another indicator in its place', STYLES),
  make('zoom-allowed', 'ui', 'The viewport setting allows pinch zoom', PAGES),
  make('reduced-motion', 'ui', 'Animations and transitions have a prefers-reduced-motion option', STYLES),
  make('iframe-title', 'ui', 'Every iframe has a title', PAGES),
  make('table-headers', 'ui', 'Data tables have header cells, and each header is tied to its row or column', PAGES),
  make('image-alt-quality', 'ui', 'Image descriptions say what the picture shows (not a file name or a bare word like "image")', PAGES),
  make('media-captions', 'ui', 'Videos have captions, and autoplaying media is muted or has controls', PAGES),
  make('sri-missing', 'security', 'Scripts and stylesheets loaded from another site have an integrity hash', PAGES),
  make('mixed-content', 'security', 'Nothing is loaded over plain http on a page that is otherwise https', [...PAGES, ...STYLES]),
  make('render-blocking', 'performance', 'Head scripts do not block drawing, and images have a size and load lazily', PAGES),
]
