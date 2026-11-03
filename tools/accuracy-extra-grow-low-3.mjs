// Grown planted defects, LOW impact, part 3: EXTREME ones. The problem only shows when three or more files are read together (a Node version that
// four files disagree on, a workspace range that excludes the sibling, a package that ships its tests, a code path that sends telemetry the README never mentions).
// Each has a clean twin. Keys: `grow-low-x-*`.
import { V, build } from './accuracy-extra-grow-low-1.mjs'

const pk = (name, extra) => JSON.stringify({ name, version: '1.0.0', license: 'MIT', private: true, ...extra }, null, 2).split('\n')

export function projects(ctx) {
  return build(ctx, [
    ['x-node-four-way', 'node-version-mismatch', 'the Node major differs between .nvmrc, engines, the Dockerfile and the workflow', {
      '.nvmrc': [V('18', '20')],
      'package.json': ['{', '  "name": "low-node", "version": "1.0.0", "license": "MIT", "private": true,', '  "engines": { "node": ">=20" }', '}'],
      Dockerfile: [V('FROM node:16-alpine', 'FROM node:20-alpine'), 'WORKDIR /app', 'USER node'],
      '.github/workflows/ci.yml': ['name: ci', 'on: [push]', 'permissions:', '  contents: read', 'jobs:', '  t:', '    runs-on: ubuntu-24.04', '    timeout-minutes: 10', '    steps:', '      - uses: actions/setup-node@60edb5dd545a775178f52524783378180af0d1f8', '        with:', '          node-version: 20'],
    }, { root: true }],
    ['x-ws-range-excludes', 'workspace-internal-ranges', 'a workspace asks for a version of its sibling that the sibling is not at', {
      'package.json': ['{', '  "name": "low-ws", "version": "1.0.0", "license": "MIT", "private": true,', '  "workspaces": ["packages/*"]', '}'],
      'packages/core/package.json': pk('@low/core', { version: '1.4.0' }),
      'packages/ui/package.json': ['{', '  "name": "@low/ui", "version": "1.0.0", "license": "MIT", "private": true,', V('  "dependencies": { "@low/core": "^2.0.0" }', '  "dependencies": { "@low/core": "^1.4.0" }'), '}'],
      'packages/cli/package.json': pk('@low/cli', { dependencies: { '@low/ui': '^1.0.0' } }),
    }, { root: true }],
    ['x-ws-cycle', 'workspace-cycles', 'three workspaces that depend on each other in a circle', {
      'package.json': ['{', '  "name": "low-cyc", "version": "1.0.0", "license": "MIT", "private": true,', '  "workspaces": ["packages/*"]', '}'],
      'packages/a/package.json': pk('@low/a', { dependencies: { '@low/b': '1.0.0' } }),
      'packages/b/package.json': pk('@low/b', { dependencies: { '@low/c': '1.0.0' } }),
      'packages/c/package.json': ['{', '  "name": "@low/c", "version": "1.0.0", "license": "MIT", "private": true,', V('  "dependencies": { "@low/a": "1.0.0" }', '  "dependencies": {}'), '}'],
    }, { root: true, absent: '*' }],
    ['x-ws-same-name', 'workspace-name-unique', 'two workspaces that carry the same package name', {
      'package.json': ['{', '  "name": "low-dup", "version": "1.0.0", "license": "MIT", "private": true,', '  "workspaces": ["packages/*"]', '}'],
      'packages/web/package.json': pk('@low/shared', {}),
      'packages/admin/package.json': ['{', V('  "name": "@low/shared", "version": "1.0.0", "license": "MIT", "private": true', '  "name": "@low/admin", "version": "1.0.0", "license": "MIT", "private": true'), '}'],
      'packages/docs/package.json': pk('@low/docs', {}),
    }, { root: true, absent: '*' }],
    ['x-pack-ships-tests', 'npm-pack-junk', 'the files list of a published package includes the tests folder', {
      'package.json': ['{', '  "name": "low-pack", "version": "1.0.0", "license": "MIT", "main": "index.js",', V('  "files": ["index.js", "tests/"]', '  "files": ["index.js"]'), '}'],
      'index.js': ['module.exports = 1'],
      'tests/a.test.js': ["const assert = require('node:assert')", "const pack = require('../index.js')", "test('exports the value', () => { assert.equal(pack, 1) })"],
    }],
    ['x-telemetry-undisclosed', 'telemetry-disclosure', 'the code reports usage to an analytics service and the README never says so', {
      'package.json': ['{', '  "name": "low-tel", "version": "1.0.0", "license": "MIT", "private": true,', '  "dependencies": { "@sentry/node": "8.0.0" }', '}'],
      'src/track.js': ["import * as Sentry from '@sentry/node'", V("Sentry.init({ dsn: process.env.SENTRY_DSN })", "Sentry.init({ dsn: process.env.SENTRY_DSN })"), 'export const report = (err) => Sentry.captureException(err)'],
      'README.md': ['# low-tel', '', 'A small service.', '', '## Install', '', 'Run the install command.', '', '## Usage', '', 'Start the service.', '', V('', '## Privacy\n\nThe service sends telemetry (crash reports) to Sentry, an error-reporting service. Set SENTRY_DSN to an empty value to turn this off.'), '', '## Licence', '', 'MIT, see LICENSE.'],
    }, { root: true }],
    ['x-i18n-three-locales', 'i18n-keys-match', 'the German file lacks a key that English has, next to a complete French file', {
      'locales/en.json': ['{"title":"Orders","empty":"No orders yet, add the first one from the button above"}'],
      'locales/fr.json': ['{"title":"Commandes","empty":"Aucune commande, ajoutez la premiere avec le bouton ci-dessus"}'],
      'locales/de.json': [V('{"title":"Bestellungen"}', '{"title":"Bestellungen","empty":"Noch keine Bestellungen, fuegen Sie die erste mit der Schaltflaeche oben hinzu"}')],
    }],
    ['x-i18n-ph-three', 'i18n-placeholders', 'a Spanish string drops a placeholder both other languages keep', {
      'locales/en.json': ['{"left":"You have {count} items left in {cart}"}'],
      'locales/fr.json': ['{"left":"Il vous reste {count} articles dans {cart}"}'],
      'locales/es.json': [V('{"left":"Le quedan articulos en el carrito"}', '{"left":"Le quedan {count} articulos en {cart}"}')],
    }],
    ['x-barrel-missing', 'broken-imports', 'an index file re-exports a helper that was removed in a rename', {
      'src/index.js': ["export * from './util/format.js'", V("export * from './util/dates.js'", "export * from './util/dates.js'")],
      'src/util/format.js': ['export const money = (n) => n.toFixed(2)'],
      'src/app.js': ["import { money } from './index.js'", 'console.log(money(5))'],
    }, { goodOnly: { 'src/util/dates.js': ['export const today = () => new Date().toISOString()'] } }],
    ['x-sql-gap', 'sql-migrations-order', 'migrations numbered 001, 002 and 004 with no 003', {
      'db/migrations/001_users.sql': ['CREATE TABLE users (id INT);'],
      'db/migrations/002_orders.sql': ['CREATE TABLE orders (id INT);'],
      'db/migrations/004_notes.sql': [V('CREATE TABLE notes (id INT);', 'CREATE TABLE notes (id INT);')],
    }, { goodOnly: { 'db/migrations/003_items.sql': ['CREATE TABLE items (id INT);'] } }],
    ['x-exports-missing', 'npm-entry-exist', 'an exports map names a CLI build file that is not built', {
      'package.json': ['{', '  "name": "low-exp", "version": "1.0.0", "license": "MIT", "main": "dist/index.js", "types": "dist/index.d.ts",', V('  "exports": { ".": "./dist/index.js", "./cli": "./dist/cli.js" },', '  "exports": { ".": "./dist/index.js", "./cli": "./dist/cli.js" },'), '  "files": ["dist"]', '}'],
      'dist/index.js': ['module.exports = {}'],
      'dist/index.d.ts': ['export {}'],
    }, { root: true, goodOnly: { 'dist/cli.js': ['#!/usr/bin/env node', 'console.log("cli")'] } }],
    ['x-version-three-way', 'version-sync', 'package.json, pyproject.toml and Cargo.toml in one folder, one at another version', {
      'package.json': pk('low-tri', {}),
      'pyproject.toml': ['[project]', 'name = "low-tri"', 'version = "1.0.0"'],
      'Cargo.toml': ['[package]', 'name = "low-tri"', V('version = "1.1.0"', 'version = "1.0.0"')],
    }],
    ['x-reusable-chain', 'github-actions-reusable', 'a release workflow calls a reusable workflow that calls one that is not there', {
      '.github/workflows/release.yml': ['name: release', 'on: [push]', 'permissions:', '  contents: read', 'jobs:', '  r:', '    uses: ./.github/workflows/package.yml'],
      '.github/workflows/package.yml': ['name: package', 'on: workflow_call', 'permissions:', '  contents: read', 'jobs:', '  p:', V('    uses: ./.github/workflows/sign.yml', '    uses: ./.github/workflows/sign.yml')],
    }, { root: true, goodOnly: { '.github/workflows/sign.yml': ['name: sign', 'on: workflow_call', 'permissions:', '  contents: read', 'jobs:', '  s:', '    runs-on: ubuntu-24.04', '    timeout-minutes: 10', '    steps:', '      - run: echo sign'] } }],
    ['x-pypi-package-layout', 'pypi-entry-points', 'a console script names a module whose package folder has no such file', {
      'pyproject.toml': ['[project]', 'name = "tool2"', 'version = "1.0.0"', '', '[project.scripts]', V('tool2 = "tool2.commands.run:main"', 'tool2 = "tool2.commands.run:main"')],
      'tool2/__init__.py': [''],
      'tool2/commands/__init__.py': [''],
    }, { goodOnly: { 'tool2/commands/run.py': ['def main():', '    pass'] } }],
  ], 'xtr')
}
