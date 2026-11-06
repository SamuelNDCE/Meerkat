// Reference click-through driver for Meerkat, speaking persistent protocol v2 over stdin/stdout (one JSON object per line).
// It drives a page through the Chrome DevTools Protocol with zero dependencies (Node 22+ built-in fetch and WebSocket).
//
// Start the target with a debugging port, then point CDP_PORT at it (default 9222):
//   Electron app:  <your-app> --remote-debugging-port=9222        (the app must be started with this flag)
//   Web:           Chrome or Edge started with --remote-debugging-port=9222 (Edge ships with Windows)
//
// Protocol:
//   in  {"type":"hello",...}                      out {"type":"ready","ok":true,"capabilities":[...]} or {"type":"ready","ok":false,"detail":"..."}
//   in  {"id":N,"type":"step","step":{...},...}   out {"id":N,"ok":true|false,"actual","expected","state","detail"}
//   in  {"type":"stop"}                           out {"type":"stopped"}, then exit 0
// Logs go to stderr only. One CDP connection is kept for the whole run.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

export const CAPABILITIES = ['open', 'click', 'type', 'wait-for', 'assert', 'screenshot']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => process.stderr.write(a.join(' ') + '\n')

// Connect to the first page target and return a small CDP client: { send, on, close }.
export async function connectCdp(port = process.env.CDP_PORT || '9222') {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error(`no page target on port ${port}`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', () => fail(new Error('websocket error')), { once: true })
  })
  let next = 0
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.error ? p.fail(new Error(m.error.message)) : p.ok(m.result)
    } else if (m.method) for (const cb of listeners.get(m.method) ?? []) cb(m.params)
  })
  return {
    send: (method, params = {}) =>
      new Promise((ok, fail) => {
        const id = ++next
        pending.set(id, { ok, fail })
        ws.send(JSON.stringify({ id, method, params }))
      }),
    on: (method, cb) => listeners.set(method, [...(listeners.get(method) ?? []), cb]),
    close: () => ws.close(),
  }
}

// Evaluate an expression in the page and return its value.
async function evalIn(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
const bodyText = (cdp) => evalIn(cdp, 'document.body ? document.body.innerText : ""')
const pageShows = async (cdp) => `page shows: ${String(await bodyText(cdp)).replace(/\s+/g, ' ').trim().slice(0, 200)}`

// Page-side finder: returns {x,y} of the centre of a visible element, or null.
const finder = (s) => `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' }
  let el = null
  ${
    s.selector
      ? `el = document.querySelector(${JSON.stringify(s.selector)})`
      : `const want = ${JSON.stringify(String(s.text ?? '').trim().toLowerCase())}
  const all = [...document.querySelectorAll('button,a,[role=button],input,label,summary,li,span,div,h1,h2,h3,p,td')].filter(vis)
  const txt = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase()
  el = all.find((e) => txt(e) === want) || all.filter((e) => txt(e).includes(want)).sort((a, b) => txt(a).length - txt(b).length)[0] || null`
  }
  if (!el || !vis(el)) return null
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`

async function waitLoaded(cdp, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      if ((await evalIn(cdp, 'document.readyState')) === 'complete') return true
    } catch {
      // the execution context can vanish mid-navigation; keep polling
    }
    await sleep(100)
  }
  return false
}

const urlOf = (cdp) => evalIn(cdp, 'location.href')

// Run one step against a CDP client. Returns a reply object without the id.
export async function runStep(cdp, step, timeoutMs = 10000) {
  switch (step.type) {
    case 'open': {
      await cdp.send('Page.navigate', { url: step.url })
      await sleep(50)
      const ok = await waitLoaded(cdp, timeoutMs)
      return ok ? { ok: true, state: await urlOf(cdp) } : { ok: false, expected: `${step.url} loaded`, actual: 'page did not finish loading in time' }
    }
    case 'click': {
      const what = step.selector ? `element matching ${step.selector}` : `element with text ${step.text}`
      const pt = await evalIn(cdp, finder(step))
      if (!pt) return { ok: false, expected: what, actual: `not found, ${await pageShows(cdp)}` }
      const base = { x: pt.x, y: pt.y, button: 'left', clickCount: 1 }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
      return { ok: true, state: `clicked ${step.selector ?? step.text}` }
    }
    case 'type': {
      const focused = await evalIn(cdp, `(() => { const e = document.querySelector(${JSON.stringify(step.selector)}); if (!e) return false; e.focus(); if (e.select) e.select(); return true })()`)
      if (!focused) return { ok: false, expected: `element matching ${step.selector}`, actual: `not found, ${await pageShows(cdp)}` }
      await cdp.send('Input.insertText', { text: String(step.value ?? '') })
      return { ok: true, state: `typed into ${step.selector}` }
    }
    case 'wait-for': {
      const end = Date.now() + timeoutMs
      const want = step.text ?? step.url ?? step.urlMatches
      for (;;) {
        const found =
          step.text !== undefined
            ? String(await bodyText(cdp)).includes(step.text)
            : step.urlMatches
              ? new RegExp(step.urlMatches).test(await urlOf(cdp))
              : String(await urlOf(cdp)).includes(step.url)
        if (found) return { ok: true }
        if (Date.now() >= end) break
        await sleep(200)
      }
      const actual = step.text !== undefined ? await pageShows(cdp) : `url is ${await urlOf(cdp)}`
      return { ok: false, expected: step.text !== undefined ? `text "${want}" appears within ${timeoutMs} ms` : `url ${want} within ${timeoutMs} ms`, actual }
    }
    case 'assert': {
      if (step.text !== undefined) {
        const ok = String(await bodyText(cdp)).includes(step.text)
        return ok ? { ok: true } : { ok: false, expected: `text "${step.text}" is present`, actual: await pageShows(cdp) }
      }
      if (step.element) {
        const ok = await evalIn(cdp, `!!document.querySelector(${JSON.stringify(step.element)})`)
        return ok ? { ok: true } : { ok: false, expected: `element ${step.element} exists`, actual: `not found, ${await pageShows(cdp)}` }
      }
      if (step.urlMatches) {
        const url = await urlOf(cdp)
        return new RegExp(step.urlMatches).test(url) ? { ok: true } : { ok: false, expected: `url matches ${step.urlMatches}`, actual: `url is ${url}` }
      }
      return { ok: false, expected: 'assert with text, element or urlMatches', actual: 'no check given' }
    }
    case 'screenshot': {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(step.path, Buffer.from(r.data, 'base64'))
      return { ok: true, state: step.path }
    }
    default:
      return { ok: false, expected: `a step type in ${CAPABILITIES.join(', ')}`, actual: `unsupported step type "${step.type}"` }
  }
}

// Message handler, separate from stdio so tests can drive it. `connect` returns a CDP client.
// handle(msg) resolves to { reply, exit } where reply may be null.
export function createHandler(connect = () => connectCdp()) {
  let cdp = null
  return async function handle(msg) {
    if (msg.type === 'hello') {
      try {
        cdp = await connect()
        return { reply: { type: 'ready', ok: true, capabilities: CAPABILITIES } }
      } catch (e) {
        return { reply: { type: 'ready', ok: false, detail: `cannot connect to CDP on port ${process.env.CDP_PORT || '9222'}: ${e.message}. Start the app or browser with --remote-debugging-port.` } }
      }
    }
    if (msg.type === 'step') {
      if (!cdp) return { reply: { id: msg.id, ok: false, detail: 'not connected, send hello first' } }
      try {
        const r = await runStep(cdp, msg.step ?? {}, msg.timeoutMs ?? 10000)
        return { reply: { id: msg.id, ...r } }
      } catch (e) {
        return { reply: { id: msg.id, ok: false, detail: `driver error: ${e.message}` } }
      }
    }
    if (msg.type === 'stop') {
      try {
        cdp?.close()
      } catch {
        // already closed
      }
      return { reply: { type: 'stopped' }, exit: true }
    }
    return { reply: null }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const handle = createHandler()
  let chain = Promise.resolve()
  createInterface({ input: process.stdin }).on('line', (line) => {
    chain = chain.then(async () => {
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        return log('bad json line ignored')
      }
      const { reply, exit } = await handle(msg)
      if (reply) process.stdout.write(JSON.stringify(reply) + '\n')
      if (exit) process.exit(0)
    })
  })
}
