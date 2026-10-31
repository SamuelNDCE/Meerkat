#!/usr/bin/env node
// Meerkat as an MCP server over stdio. Register it with an AI client; see docs/for-ai-agents.md.
// Only JSON-RPC messages go to stdout. Anything else goes to stderr.
import { createContext, createReader, handleLine } from '../lib/mcp.mjs'

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
