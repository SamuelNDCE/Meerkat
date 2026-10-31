// Your own checks, no JavaScript needed. A project (meerkat.config.json) or a person (~/.meerkat.json) lists them as data:
//
//   "customChecks": [{ "id": "e2e", "title": "End-to-end tests", "cmd": "npm", "args": ["run", "test:e2e"], "suite": "my-app",
//                      "group": "functionality", "tier": "thorough", "cwd": ".", "timeoutSeconds": 600, "weight": "heavy",
//                      "needs": ["npm"], "install": "install Node.js" }]
//   "suites": { "my-app": { "label": "My app", "purpose": "The tests only this app has." } }
//
// Everything here is pure (text in, text or objects out) except the three small file helpers at the bottom. Nothing is ever run through a
// shell by this file: a check is a program name and a list of arguments, and anything that looks like shell syntax is refused.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SUITE_IDS } from './suites.mjs'
import { stripControl } from './tui/safe.mjs'

export const GROUPS = ['security', 'functionality', 'ui', 'performance', 'refactor']
export const TIERS = ['fast', 'thorough']
export const WEIGHTS = ['tiny', 'light', 'medium', 'heavy', 'alone']
export const KNOWN_KEYS = ['id', 'title', 'cmd', 'args', 'suite', 'group', 'tier', 'cwd', 'timeoutSeconds', 'estSeconds', 'weight', 'needs', 'install']
export const DEFAULT_SUITE = 'my-app'
export const PROJECT_SUITE_RE = /^[a-z0-9][a-z0-9-]{0,40}$/
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/
const CMD_RE = /^[A-Za-z0-9_.][A-Za-z0-9_.+-]*(?:[\\/][A-Za-z0-9_.+-]+)*$/
// Characters a shell would act on. Refused in a command line, and in every argument (npm and npx are run through cmd.exe on Windows,
// so the arguments must not carry anything cmd.exe would read either).
const SHELL_CHARS = /[;|&<>`^%\r\n\0]|\$\(|\$\{|"/

const clean = (x) => stripControl(String(x ?? ''))

// ---- where a check came from ----
const ORIGINS = ['bundled', 'personal', 'project']
export const originLabel = (origin) => (origin === 'personal' ? 'yours' : origin === 'project' ? 'project' : '')
export const isOwn = (c) => c?.origin === 'personal' || c?.origin === 'project'

// ---- the command line ----

// "npm run test:e2e" -> { ok, cmd, args }. Quote-aware ('a b' and "a b" are one word). Shell syntax (; | & < > ` $( ) is refused, not understood.
export function splitCommand(line) {
  const text = String(line ?? '').trim()
  if (!text) return { ok: false, error: 'type the command to run, for example: npm run test:e2e' }
  if (/[;|&<>`^%\0\r\n]|\$\(|\$\{/.test(text)) return { ok: false, error: 'shell characters (; | & < > ` $( ) are not allowed: Meerkat runs one program with its arguments, never a shell line' }
  const words = []
  let cur = ''
  let quote = null
  let has = false
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (/\s/.test(ch)) {
      if (has || cur) words.push(cur)
      cur = ''
      has = false
    } else cur += ch
  }
  if (quote) return { ok: false, error: 'a quote is not closed' }
  if (has || cur) words.push(cur)
  const [cmd, ...args] = words
  const bad = commandError(cmd, args)
  return bad ? { ok: false, error: bad } : { ok: true, cmd, args }
}

// null when fine, else the reason. A program is a plain name or a relative path: no spaces, no drive, no leading slash, no "..".
export function commandError(cmd, args) {
  if (typeof cmd !== 'string' || !cmd) return 'cmd is missing'
  if (cmd.length > 120 || !CMD_RE.test(cmd) || /^[\\/]/.test(cmd) || cmd.split(/[\\/]/).includes('..')) return 'cmd must be a plain program name (npm) or a relative path (scripts/test.sh): no spaces, no shell characters, no ..'
  if (!Array.isArray(args)) return 'args must be a list of text'
  if (args.length > 50) return 'at most 50 args'
  for (const a of args) {
    if (typeof a !== 'string') return 'args must all be text'
    if (a.length > 500) return 'an arg is longer than 500 characters'
    if (SHELL_CHARS.test(a) || /[\u0000-\u001f\u007f]/.test(a)) return `arg "${clean(a).slice(0, 40)}" has a character a shell would read ( ; | & < > \` $( ^ % " ); Meerkat never uses a shell`
  }
  return null
}

export const commandText = (cmd, args = []) => [cmd, ...args].map((w) => (/[\s']/.test(w) ? `"${w}"` : w)).join(' ')

// ---- one entry ----

const relPath = (v) => typeof v === 'string' && v.length <= 200 && !/^([a-zA-Z]:|[\\/])/.test(v) && !v.split(/[\\/]/).includes('..') && !/[\u0000-\u001f]/.test(v)
const wholeIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

// Check one raw entry. Returns { entry, error } (entry is the cleaned, stored shape) and { notes } for keys that were ignored.
export function validateEntry(raw, { known = new Set(), builtinOnly = false } = {}) {
  const notes = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'must be an object', notes }
  const id = raw.id
  if (typeof id !== 'string' || !ID_RE.test(id)) return { error: 'id must be kebab-case (lowercase letters, digits, dashes; up to 61 characters)', notes }
  const tag = `customChecks "${id}"`
  if (known.has(id)) return { error: `id "${id}" is already used by another check (ids are unique across every pack)`, notes }
  const bad = commandError(raw.cmd, raw.args ?? [])
  if (bad) return { error: bad, notes }
  const e = { id, title: raw.title === undefined ? id : raw.title, cmd: raw.cmd, args: raw.args ?? [], suite: raw.suite ?? DEFAULT_SUITE, group: raw.group ?? 'functionality', tier: raw.tier ?? 'thorough' }
  if (typeof e.title !== 'string' || !clean(e.title).trim() || e.title.length > 120) return { error: 'title must be text, up to 120 characters', notes }
  e.title = clean(e.title).trim()
  if (typeof e.suite !== 'string' || !(SUITE_IDS.includes(e.suite) || (!builtinOnly && PROJECT_SUITE_RE.test(e.suite)))) return { error: `suite must be one of Meerkat's suites or a name of your own (lowercase letters, digits, dashes; up to 41 characters)`, notes }
  if (!GROUPS.includes(e.group)) return { error: `group must be one of ${GROUPS.join(', ')}`, notes }
  if (!TIERS.includes(e.tier)) return { error: 'tier must be fast or thorough', notes }
  if (raw.cwd !== undefined) {
    if (!relPath(raw.cwd)) return { error: 'cwd must be a folder inside the project, written relative to it (for example "." or "web")', notes }
    if (raw.cwd !== '.') e.cwd = raw.cwd
  }
  if (raw.timeoutSeconds !== undefined) {
    if (!wholeIn(raw.timeoutSeconds, 1, 7200)) return { error: 'timeoutSeconds must be a whole number from 1 to 7200', notes }
    e.timeoutSeconds = raw.timeoutSeconds
  }
  if (raw.estSeconds !== undefined) {
    if (!wholeIn(raw.estSeconds, 1, 7200)) return { error: 'estSeconds must be a whole number from 1 to 7200', notes }
    e.estSeconds = raw.estSeconds
  }
  if (raw.weight !== undefined) {
    if (!WEIGHTS.includes(raw.weight)) return { error: `weight must be one of ${WEIGHTS.join(', ')}`, notes }
    e.weight = raw.weight
  }
  if (raw.needs !== undefined) {
    if (!Array.isArray(raw.needs) || raw.needs.length > 10 || !raw.needs.every((n) => typeof n === 'string' && /^[A-Za-z0-9_.+-]{1,60}$/.test(n))) return { error: 'needs must be a list (up to 10) of program names', notes }
    e.needs = raw.needs
  }
  if (raw.install !== undefined) {
    if (typeof raw.install !== 'string' || raw.install.length > 200) return { error: 'install must be text, up to 200 characters', notes }
    e.install = clean(raw.install)
  }
  for (const k of Object.keys(raw)) if (!KNOWN_KEYS.includes(k)) notes.push(`${tag}: "${clean(k).slice(0, 40)}" is not a known key; ignored`)
  return { entry: e, notes }
}

// A list of raw entries -> { entries, notes }. Bad ones are skipped with a note. `known` (a Set) gets every accepted id.
export function validateCustomChecks(raw, { known = new Set(), label = 'customChecks' } = {}) {
  if (raw === undefined) return { entries: [], notes: [] }
  if (!Array.isArray(raw)) return { entries: [], notes: [`"${label}" must be a list of checks; ignored`] }
  const entries = []
  const notes = []
  raw.forEach((r, i) => {
    const v = validateEntry(r, { known })
    notes.push(...v.notes)
    if (v.error) notes.push(`${label} #${i + 1}${typeof r?.id === 'string' ? ` "${clean(r.id).slice(0, 40)}"` : ''}: ${v.error}; skipped`)
    else {
      known.add(v.entry.id)
      entries.push(v.entry)
    }
  })
  return { entries, notes }
}

// The word for a suite id, "my-app" -> "My app".
export const defaultLabel = (id) => {
  const t = String(id).replace(/-/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// "suites" in the config -> [{ id, label, purpose }] (only names that are not Meerkat's own suites), with notes for mistakes.
export function validateSuites(raw) {
  const notes = []
  const list = []
  if (raw === undefined) return { list, notes }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { list, notes: ['"suites" must be an object such as { "my-app": { "label": "My app", "purpose": "..." } }; ignored'] }
  for (const [id, v] of Object.entries(raw)) {
    if (!PROJECT_SUITE_RE.test(id)) {
      notes.push(`suites "${clean(id).slice(0, 40)}": the name must be lowercase letters, digits and dashes (up to 41 characters); ignored`)
      continue
    }
    if (SUITE_IDS.includes(id)) {
      notes.push(`suites "${id}": that is one of Meerkat's own suites; ignored`)
      continue
    }
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    const label = typeof o.label === 'string' && clean(o.label).trim() ? clean(o.label).trim().slice(0, 40) : defaultLabel(id)
    const purpose = typeof o.purpose === 'string' && clean(o.purpose).trim() ? clean(o.purpose).trim().slice(0, 200) : 'Checks only this app has.'
    if (v !== undefined && (typeof v !== 'object' || Array.isArray(v) || v === null)) notes.push(`suites "${id}" must be an object with label and purpose; defaults used`)
    for (const k of Object.keys(o)) if (!['label', 'purpose'].includes(k)) notes.push(`suites "${id}": "${clean(k).slice(0, 40)}" is not a known key; ignored`)
    list.push({ id, label, purpose })
  }
  return { list, notes }
}

// Entries + declared suites -> the project suites to register (declared ones, plus any name an entry uses that is not one of Meerkat's).
export function suitesFor(entries, declared = []) {
  const out = [...declared]
  for (const e of entries) if (!SUITE_IDS.includes(e.suite) && !out.some((s) => s.id === e.suite)) out.push({ id: e.suite, label: defaultLabel(e.suite), purpose: 'Checks only this app has.' })
  return out
}

// An entry -> the check object the runner understands. The program is a normal `run` (spawned without a shell by the runner's own rules).
export function entryToCheck(e, { origin, source, where }) {
  const plain = !/[\\/]/.test(e.cmd)
  return {
    id: e.id,
    title: e.title,
    group: e.group,
    tier: e.tier,
    lane: 'free',
    weight: e.weight ?? 'medium',
    estSeconds: e.estSeconds ?? 30,
    ...(e.timeoutSeconds ? { timeoutSeconds: e.timeoutSeconds } : {}),
    suite: e.suite,
    needs: e.needs ?? (plain ? [e.cmd] : []),
    ...(e.install ? { install: e.install } : {}),
    run: { cmd: e.cmd, args: e.args, ...(e.cwd ? { cwd: e.cwd } : {}) },
    origin,
    source,
    where,
    custom: true,
  }
}

// ---- reading and writing the file a check lives in ----
// Other keys, their order and the file's line endings (CRLF or LF) are kept.

export function readJsonObject(file) {
  const text = readFileSync(file, 'utf8')
  const raw = JSON.parse(text.replace(/^﻿/, ''))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a JSON object')
  return { raw, crlf: text.includes('\r\n') }
}

// Apply fn(list) -> list to the file's customChecks. Creates the file when asked. dryRun returns the text and writes nothing.
export function updateCustomList(file, fn, { create = false, dryRun = false, seed = null } = {}) {
  let raw = seed && typeof seed === 'object' ? { ...seed } : {}
  let crlf = false
  if (existsSync(file)) ({ raw, crlf } = readJsonObject(file))
  else if (!create) throw new Error(`${file} does not exist`)
  const list = Array.isArray(raw.customChecks) ? raw.customChecks : []
  const next = fn(list)
  const out = { ...raw }
  if (next.length) out.customChecks = next
  else delete out.customChecks
  let text = `${JSON.stringify(out, null, 2)}\n`
  if (crlf) text = text.replace(/\n/g, '\r\n')
  if (!dryRun) {
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  return { text, count: next.length }
}

export const addEntry = (file, entry, opts) => updateCustomList(file, (l) => [...l, entry], { create: true, ...opts })
export const replaceEntry = (file, id, entry, opts) => updateCustomList(file, (l) => l.map((x) => (x?.id === id ? entry : x)), opts)
export const removeEntry = (file, id, opts) => updateCustomList(file, (l) => l.filter((x) => x?.id !== id), opts)
