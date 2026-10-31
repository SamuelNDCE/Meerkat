// The content pack: documents, data files, localisation and project metadata, with no tool to install. Turn it on with { "packs": ["content"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const CS = `${MK}/thorough/content.mjs`
const make = (id, title) => ({
  id,
  group: 'functionality',
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
  make('markdown-headings', 'Markdown headings nest one level at a time, with one H1 and no trailing punctuation'),
  make('markdown-code-fences', 'Markdown code fences are closed and name their language'),
  make('markdown-anchors', 'Same-page #anchor links in Markdown match a heading or an anchor'),
  make('changelog-version-headings', 'CHANGELOG.md has version headings, with Unreleased first and newest first'),
  make('changelog-vs-version', 'The package.json version is written down in CHANGELOG.md'),
  make('readme-install-usage', 'README is over 200 characters and has install and usage sections'),
  make('i18n-keys-match', 'Every locale file has the same keys as the largest one'),
  make('i18n-placeholders', 'Every translation uses the same {name} or %s placeholders as the reference'),
  make('json-duplicate-keys', 'No JSON object repeats a key'),
  make('csv-consistent', 'Every CSV row has as many columns as its header'),
  make('dead-assets', 'Every image or font under public, assets or static is mentioned by some text file'),
  make('large-json-or-data', 'No tracked JSON, CSV or SQL file is over the size budget (content.maxDataKb, default 512 KB)'),
  make('spell-common-typos', 'No very common misspelling in the docs or comments'),
  make('unicode-control-chars', 'No bidirectional override or invisible zero-width character in tracked text'),
]
