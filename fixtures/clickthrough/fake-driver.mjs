// A fake driver for the click-through tests. It models a tiny one-page "app" in a JSON file in the session folder.
// The page shows "Welcome" and a "Save" button; clicking Save shows "Saved" unless MEERKAT_FAKE_BREAK_SAVE is set.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let raw = ''
process.stdin.setEncoding('utf8')
for await (const c of process.stdin) raw += c
const req = JSON.parse(raw)
const file = join(req.session, 'fake-state.json')
const st = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { url: null, text: [], typed: {} }
const save = () => writeFileSync(file, JSON.stringify(st))
const out = (o) => {
  console.log(JSON.stringify(o))
  process.exit(0)
}
const s = req.step

if (s.type === 'open') {
  st.url = s.url
  st.text = ['Welcome', 'Save']
  save()
  out({ ok: true, state: st.url })
}
if (s.type === 'click') {
  if (s.text === 'Save' && st.text.includes('Save')) {
    if (!process.env.MEERKAT_FAKE_BREAK_SAVE) st.text.push('Saved')
    save()
    out({ ok: true, state: 'clicked Save' })
  }
  out({ ok: false, actual: `no element with text "${s.text ?? s.selector}"` })
}
if (s.type === 'type') {
  st.typed[s.selector ?? s.text] = s.value
  save()
  out({ ok: true })
}
if (s.type === 'wait-for' || s.type === 'assert') {
  if (s.text) out(st.text.includes(s.text) ? { ok: true } : { ok: false, actual: `page shows: ${st.text.join(', ')}` })
  if (s.urlMatches) out(new RegExp(s.urlMatches).test(st.url ?? '') ? { ok: true } : { ok: false, actual: `url is ${st.url}` })
  out({ ok: true })
}
if (s.type === 'screenshot') {
  // A tiny valid PNG header is enough for the runner, which only checks the file exists and is not empty.
  writeFileSync(s.path, Buffer.from('iVBORw0KGgo=', 'base64'))
  out({ ok: true })
}
out({ ok: true })
