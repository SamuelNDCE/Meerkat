// The one way Meerkat talks to the configured model (see lib/aimodel.mjs): start the command, write the prompt on stdin, read the answer.
// Used by the AI checks (thorough/ai.mjs) and by AI verification (lib/aiverify.mjs). The command runs in an empty temporary folder.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.noDeprecation = true // the claude shim needs a shell on Windows (see lib/aiconfig.mjs)
const safeText = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120)

export const ask = (choice, prompt, timeoutMs = 180000) =>
  new Promise((ok, bad) => {
    const cwd = mkdtempSync(join(tmpdir(), 'meerkat-ai-'))
    const done = (fn, v) => {
      clearTimeout(t)
      rmSync(cwd, { recursive: true, force: true })
      fn(v)
    }
    const cmd = choice.cmd
    const ch = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...choice.env }, shell: process.platform === 'win32' && cmd[0] === 'claude', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let err = ''
    const t = setTimeout(() => {
      ch.kill()
      done(bad, new Error('the model took too long'))
    }, timeoutMs)
    ch.stdout.on('data', (b) => (out += b))
    ch.stderr.on('data', (b) => (err += b))
    ch.on('error', (e) => done(bad, e))
    ch.on('close', (code) => (code === 0 ? done(ok, out) : done(bad, new Error(`model command exited ${code}: ${safeText(err)}`))))
    ch.stdin.on('error', () => {})
    ch.stdin.end(prompt)
  })
