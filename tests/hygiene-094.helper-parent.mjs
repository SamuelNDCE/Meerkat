// Helper for tests/hygiene-094.test.ts: a parent that runs a sleeping check through runCommand and is then stopped.
import { runCommand } from '../lib/exec.mjs'
const how = process.argv[2] ?? 'signal'
runCommand({ cmd: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 600000 })
setTimeout(() => {
  if (how === 'signal') process.emit('SIGTERM')
  else if (how === 'error') throw new Error('boom')
  else process.exit(0)
}, 2000)
setTimeout(() => {}, 60000)
