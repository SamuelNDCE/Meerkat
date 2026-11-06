import { exec } from 'node:child_process'

export function listDir(dir, done) {
  exec('ls -l ' + dir, done)
}
