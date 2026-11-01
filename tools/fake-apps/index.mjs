// Realistic fake apps, generated into a temp folder. Each app has a CLEAN variant (well written: no failures, no findings) and a
// DEFECTIVE variant with a known list of planted defects. A defect is { check, rule?, file, severity }: the check (and the rule, when
// the check reports sub-checks) that must report it, the project-relative file, and the lowest acceptable severity.
// Deterministic, no network, nothing installed.
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from './electron-app.mjs'
import express from './express-api.mjs'
import flask from './flask-app.mjs'
import { commit, writeTree } from './kit.mjs'
import react from './react-ts.mjs'
import rust from './rust-crate.mjs'

export const APPS = { 'express-api': express, 'notes-ui': react, 'ledger-core': rust, 'tasks-app': flask, 'clip-desk': electron }

// Write one variant ('clean' or 'defective') of an app under `parent` (a new temp folder when omitted) and commit it. Returns the project folder.
export function generate(name, variant, parent = mkdtempSync(join(tmpdir(), 'meerkat-fakeapp-'))) {
  const app = APPS[name]
  if (!app || !app[variant]) throw new Error(`no fake app ${name}/${variant}`)
  const dir = join(parent, app.name)
  mkdirSync(dir, { recursive: true })
  writeTree(dir, app[variant])
  commit(dir)
  return dir
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const [name, variant = 'clean', parent] = process.argv.slice(2)
  console.log(generate(name, variant, parent))
}
