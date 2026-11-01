// The docs pack: the documents are checked like code. Turn it on with { "packs": ["docs"] }.
import { tool } from '../../lib/tool-check.mjs'

const MD = ['**/*.md']

export default [
  tool({ id: 'markdownlint', expect: 'MD0', bin: 'markdownlint-cli2', args: ['**/*.md', '#**/node_modules', '#**/fixtures', '#.git', '#.claude', '#**/vendor', '#**/dist', '#**/build', '#**/target'], fixture: ['fixtures/tools/markdownlint/broken.md'], install: 'npm i -D markdownlint-cli2', title: 'Markdown: well-formed documents', weight: 'tiny', estSeconds: 5, paths: MD, fallback: 'markdown' }),
  tool({ id: 'typos', expect: 'recieve', bin: 'typos', args: [], fixture: ['fixtures/tools/typos/broken.txt'], install: 'cargo install typos-cli (or your package manager)', title: 'Typos in code and documents', weight: 'tiny', estSeconds: 3, fallback: 'typos' }),
  tool({ id: 'local-links', expect: 'missing', bin: 'lychee', args: ['--offline', '--no-progress', '**/*.md'], fixture: ['--offline', '--no-progress', 'fixtures/tools/lychee/broken.md'], install: 'cargo install lychee (or your package manager)', title: 'Links between documents and files (lychee, offline)', weight: 'tiny', estSeconds: 60, paths: MD, fallback: 'links' }),
]
