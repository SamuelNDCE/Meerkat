// A store file Meerkat keeps for itself (a history, a baseline, a dismissal list, a pointer to the newest run) that has gone bad is never
// deleted and never silently replaced by an empty one: it is moved aside to <name>.corrupt-<time>, the command says so in one line on
// stderr, and the command carries on as if there were no file. The next save then writes a fresh file and the old data is still on disk.
import { existsSync, readFileSync, renameSync } from 'node:fs'

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

// Moves a damaged file aside. Returns the new path, or null when it could not be moved (a read-only folder, say).
export function moveAside(file, { say = (t) => process.stderr.write(`${t}\n`), why = 'is not valid JSON (damaged or cut off)' } = {}) {
  const target = `${file}.corrupt-${stamp()}`
  try {
    renameSync(file, target)
    say(`meerkat: ${file} ${why}; moved aside to ${target} and started again without it. Nothing was deleted.`)
    return target
  } catch (e) {
    say(`meerkat: ${file} ${why} and could not be moved aside (${e?.code ?? 'error'}); it is ignored for this command. Move or delete it by hand.`)
    return null
  }
}

// { ok: true, value } | { ok: false, missing: true } | { ok: false, corrupt: true, movedTo }
export function readJsonStore(file, opts = {}) {
  if (!existsSync(file)) return { ok: false, missing: true }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, missing: true }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, corrupt: true, movedTo: moveAside(file, opts) }
  }
}
