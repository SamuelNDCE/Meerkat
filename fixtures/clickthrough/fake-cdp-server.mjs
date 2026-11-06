// A fake CDP client for tests. Node has a WebSocket client but no server, so tests skip the socket and give the
// driver an object with the same shape as the real client: send(method, params), on(), close().
// It models one page with body text and a "Save" button; clicking Save adds "Saved" to the text.
export function fakeCdp({ text = 'Welcome Save', url = 'http://app.test/' } = {}) {
  const calls = []
  let body = text
  let currentUrl = url
  return {
    calls,
    closed: false,
    on() {},
    close() {
      this.closed = true
    },
    async send(method, params = {}) {
      calls.push({ method, params })
      if (method === 'Page.navigate') {
        currentUrl = params.url
        return {}
      }
      if (method === 'Page.captureScreenshot') return { data: 'iVBORw0KGgo=' }
      if (method === 'Runtime.evaluate') {
        const e = params.expression
        if (e.includes('document.readyState')) return { result: { value: 'complete' } }
        if (e === 'location.href') return { result: { value: currentUrl } }
        if (e.includes('document.body.innerText')) return { result: { value: body } }
        if (e.includes('getBoundingClientRect')) {
          // click finder: only the word "Save" resolves to an element
          const m = /const want = "([^"]*)"/.exec(e)
          return { result: { value: m && m[1] === 'save' ? { x: 10, y: 20 } : null } }
        }
        if (e.startsWith('!!document.querySelector')) return { result: { value: e.includes('#present') } }
        return { result: { value: true } }
      }
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') body += ' Saved'
      return {}
    },
  }
}
