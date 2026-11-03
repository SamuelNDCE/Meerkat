#!/usr/bin/env node
// Runs Lighthouse against a static folder served on 127.0.0.1 (random port, nothing leaves this computer) and prints Lighthouse's JSON.
//   node thorough/lh-run.mjs <rootDir> <page> <lighthouse-cli.js>
// Chrome is found by Lighthouse itself (CHROME_PATH or the usual install places); with no Chrome it fails and the check reports NOT RUN.
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' }

export function serve(rootDir) {
  const root = realpathSync(resolve(rootDir))
  const server = createServer((req, res) => {
    let rel
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    } catch {
      res.statusCode = 400
      return res.end()
    }
    const full = resolve(root, `.${rel}`)
    // Never serve anything outside the folder (.. segments, symlinks).
    let real = null
    try {
      real = existsSync(full) && statSync(full).isFile() ? realpathSync(full) : null
    } catch {
      real = null
    }
    if (!real || (real !== root && !real.startsWith(root + sep))) {
      res.statusCode = 404
      return res.end()
    }
    res.setHeader('content-type', TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream')
    createReadStream(real).pipe(res)
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

async function main(argv) {
  const [dir, page, cli] = argv
  if (!dir || !page || !cli) return 2
  const server = await serve(dir)
  const url = `http://127.0.0.1:${server.address().port}/${encodeURI(page)}`
  const args = [cli, url, '--output', 'json', '--output-path', 'stdout', '--quiet', '--only-categories', 'accessibility,best-practices', '--chrome-flags=--headless=new --no-sandbox', '--no-enable-error-reporting']
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } })
  child.stdout.pipe(process.stdout)
  let err = ''
  child.stderr.on('data', (d) => (err += d))
  const code = await new Promise((ok) => child.on('close', ok))
  server.close()
  if (code !== 0) {
    console.error(err.trim().split('\n').slice(-3).join(' | ').slice(0, 300))
    return 3
  }
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).then((c) => process.exit(c))
