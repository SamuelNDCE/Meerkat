// The ui pack: static checks on pages and styles, with no browser and no tool to install. Turn it on with { "packs": ["ui"] }.
// For real-window checks (clicking through the running app) see the examples folder; for markup and style linters see the "web" pack.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const ST = `${MK}/thorough/static.mjs`
const make = (id, title, paths, group = 'ui') => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  ...(paths ? { paths } : {}),
  run: { cmd: 'node', args: [ST, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [ST, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('html-structure', 'Pages: one h1, headings in order, unique ids, labelled inputs, keyboard-reachable click handlers', ['**/*.html']),
  make('css-contrast', 'Text and background colours written together have enough contrast (WCAG 4.5:1)', ['**/*.css', '**/*.html', '**/*.scss']),
  make('meta-seo', 'Pages have a title and description of a useful length', ['**/*.html']),
  make('image-weight', 'No image is over its size limit (default 500 KB)', ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp'], 'performance'),
]
