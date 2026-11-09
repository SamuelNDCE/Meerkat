// Helper: starts the MCP server with stdin piped, closes stdin, and prints how long the server took to exit (ms), or -1 after 6 s.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'meerkat-mcp.mjs')
const c = spawn(process.execPath, [server], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
setTimeout(() => {
  const t0 = Date.now()
  c.stdin.end()
  c.on('exit', () => { console.log(Date.now() - t0); process.exit(0) })
  setTimeout(() => { console.log(-1); c.kill(); process.exit(0) }, 6000)
}, 1500)
