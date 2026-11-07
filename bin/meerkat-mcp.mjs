#!/usr/bin/env node
// Meerkat as an MCP server over stdio. Register it with an AI client; see docs/for-ai-agents.md.
// Only JSON-RPC messages go to stdout. Anything else goes to stderr.
import { createContext, createReader, handleLine, TOOLS } from '../lib/mcp.mjs'
import { VERSION } from '../lib/version.mjs'

// `node bin/meerkat-mcp.mjs --list-tools`: the version and the tools this server registers, read from the registration, then exit. Nothing is started.
if (process.argv.includes('--list-tools')) {
  process.stdout.write(`${JSON.stringify({ version: VERSION, count: TOOLS.length, tools: TOOLS.map((t) => t.name) }, null, 2)}\n`)
  process.exit(0)
}

const ctx = createContext()
const reader = createReader()
let pending = 0
let ended = false
const maybeExit = () => {
  if (ended && pending === 0) process.exit(0)
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  for (const line of reader.feed(chunk)) {
    pending++
    handleLine(line, ctx)
      .then((reply) => {
        if (reply) process.stdout.write(`${reply}\n`)
      })
      .catch((e) => process.stderr.write(`meerkat-mcp: ${e instanceof Error ? e.message : String(e)}\n`))
      .finally(() => {
        pending--
        maybeExit()
      })
  }
})
process.stdin.on('end', () => {
  ended = true
  maybeExit()
})
process.stderr.write(`meerkat-mcp ${ctx.version} ready (folder: ${ctx.cwd})\n`)
