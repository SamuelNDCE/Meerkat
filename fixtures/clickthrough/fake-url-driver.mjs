// A fake persistent driver (protocol 2) that reports the final URL and page title with every step answer.
// Environment: MEERKAT_FAKE_FINAL_URL and MEERKAT_FAKE_TITLE set what it reports; MEERKAT_FAKE_NO_REPORT=1 reports neither.
import { createInterface } from 'node:readline'

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  if (m.type === 'hello') return send({ type: 'ready', ok: true, capabilities: ['open'] })
  if (m.type === 'stop') { send({ type: 'stopped' }); return process.exit(0) }
  if (m.type !== 'step') return
  const report = process.env.MEERKAT_FAKE_NO_REPORT ? {} : { url: process.env.MEERKAT_FAKE_FINAL_URL ?? m.step.url, title: process.env.MEERKAT_FAKE_TITLE ?? 'Home' }
  send({ id: m.id, ok: true, ...report })
})
rl.on('close', () => process.exit(0))
