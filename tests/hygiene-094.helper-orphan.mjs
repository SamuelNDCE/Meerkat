// Helper: registers a sleeping child, prints its pid, then dies WITHOUT cleanup (hard kill), leaving the child behind.
import { spawn } from 'node:child_process'
import { trackChild } from '../lib/childreg.mjs'
const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore', windowsHide: true })
trackChild(c, 'sleeping-orphan')
c.unref()
console.log(c.pid)
setTimeout(() => process.kill(process.pid, 'SIGKILL'), 300)
