import { execFile } from 'node:child_process'

export function listDir(dir, done) {
  execFile('ls', ['-l', dir], done)
}
