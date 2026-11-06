// A fake PERSISTENT driver (protocol 2) for the click-through tests. One process serves every step, so the page lives in memory.
// The page shows "Welcome" and a "Save" button; clicking Save shows "Saved" unless MEERKAT_FAKE_BREAK_SAVE is set.
// Test switches (environment): MEERKAT_FAKE_NO_READY=1 exits before ready; MEERKAT_FAKE_HANG_STEP=<index> never answers that step;
// MEERKAT_FAKE_NOT_OK=1 answers ready with ok false. Every start appends a line to <session>/starts.log.
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const page = { url: null, text: [] }
let hello = null

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.type === 'hello') {
    hello = m
    appendFileSync(join(m.session, 'starts.log'), `start protocol ${m.protocol}\n`)
    if (process.env.MEERKAT_FAKE_NO_READY) process.exit(3)
    if (process.env.MEERKAT_FAKE_NOT_OK) return send({ type: 'ready', ok: false, detail: 'no display here' })
    return send({ type: 'ready', ok: true, capabilities: ['click', 'type', 'assert', 'screenshot'] })
  }
  if (m.type === 'stop') {
    send({ type: 'stopped' })
    return process.exit(0)
  }
  if (m.type !== 'step') return
  if (String(m.index) === process.env.MEERKAT_FAKE_HANG_STEP) return // never answers
  const s = m.step
  const reply = (o) => send({ id: m.id, ...o })
  if (s.type === 'open') {
    page.url = s.url
    page.text = ['Welcome', 'Save']
    return reply({ ok: true, state: page.url })
  }
  if (s.type === 'click') {
    if (s.text === 'Save' && page.text.includes('Save')) {
      if (!process.env.MEERKAT_FAKE_BREAK_SAVE) page.text.push('Saved')
      return reply({ ok: true, state: 'clicked Save' })
    }
    return reply({ ok: false, actual: `no element with text "${s.text ?? s.selector}"` })
  }
  if (s.type === 'wait-for' || s.type === 'assert') {
    if (s.text) return reply(page.text.includes(s.text) ? { ok: true } : { ok: false, actual: `page shows: ${page.text.join(', ')}` })
    if (s.urlMatches) return reply(new RegExp(s.urlMatches).test(page.url ?? '') ? { ok: true } : { ok: false, actual: `url is ${page.url}` })
    return reply({ ok: true })
  }
  if (s.type === 'screenshot') {
    // A tiny PNG header is enough: the runner only checks the file exists and is not empty.
    writeFileSync(s.path, Buffer.from('iVBORw0KGgo=', 'base64'))
    return reply({ ok: true })
  }
  return reply({ ok: true })
})
rl.on('close', () => process.exit(0))
