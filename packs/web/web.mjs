// The web pack: markup and style checks for sites and web apps. Turn it on with { "packs": ["web"] }.
import { tool } from '../../lib/tool-check.mjs'

export default [
  tool({ id: 'htmlhint', expect: 'alt-require', bin: 'htmlhint', args: ['**/*.html', '!node_modules/**', '!dist/**', '!build/**'], fixture: ['--rules', 'alt-require', 'fixtures/tools/htmlhint/broken.html'], install: 'npm i -D htmlhint', title: 'HTML: valid, accessible markup (htmlhint)', group: 'ui', weight: 'tiny', estSeconds: 5, paths: ['**/*.html'] }),
  tool({ id: 'stylelint', expect: 'color-no-invalid-hex', bin: 'stylelint', args: ['**/*.css', '--ignore-path', '.gitignore'], fixture: ['--config', 'fixtures/tools/stylelint/config.json', 'fixtures/tools/stylelint/broken.css'], install: 'npm i -D stylelint', title: 'CSS: no invalid styles (stylelint)', group: 'ui', weight: 'tiny', estSeconds: 5, paths: ['**/*.css'] }),
]
