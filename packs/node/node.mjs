// The node pack: tools a JavaScript or TypeScript project installs for itself (npm i -D ...). Turn it on with { "packs": ["node"] }.
// A tool the project has not installed is NOT RUN, with the line that installs it. Meerkat looks in node_modules/.bin as well as on PATH.
import { tool } from '../../lib/tool-check.mjs'

const JS = ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx', '**/*.ts', '**/*.tsx']

export default [
  tool({ id: 'eslint', expect: 'no-unused-vars', bin: 'eslint', args: ['.'], fixture: ['--no-config-lookup', '--rule', 'no-unused-vars: error', 'fixtures/tools/eslint/broken.js'], install: 'npm i -D eslint', title: "ESLint: the project's own lint rules", estSeconds: 30, scale: 'files', paths: JS }),
  tool({ id: 'tsc', expect: 'TS2322', bin: 'tsc', args: ['--noEmit'], fixture: ['--noEmit', '--strict', 'fixtures/tools/tsc/broken.ts'], install: 'npm i -D typescript', title: 'TypeScript: no type errors', estSeconds: 60, weight: 'medium', scale: 'files', paths: ['**/*.ts', '**/*.tsx', 'tsconfig*.json'] }),
  tool({ id: 'prettier', expect: 'Code style issues', bin: 'prettier', args: ['--check', '.'], fixture: ['--check', 'fixtures/tools/prettier/broken.js'], install: 'npm i -D prettier', title: 'Prettier: code is formatted', estSeconds: 30, scale: 'files', weight: 'tiny', paths: JS }),
  tool({ id: 'circular-imports', expect: 'a\.js', bin: 'madge', args: ['--circular', '--extensions', 'js,ts,tsx,jsx', '.'], fixture: ['--circular', 'fixtures/tools/madge'], install: 'npm i -D madge', title: 'No circular imports (madge)', group: 'refactor', tier: 'thorough', estSeconds: 20, scale: 'files', paths: JS }),
]
