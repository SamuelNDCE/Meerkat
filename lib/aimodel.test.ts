// The OpenAI-compatible model command, tested against a local stand-in server: no real key, no real service.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const script = join(process.cwd(), 'thorough', 'ai-openai.mjs')

const run = (env: Record<string, string>, input = 'hello') =>
  new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(process.execPath, [script], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (err += b))
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.end(input)
  })

describe('ai-openai: a model command for any OpenAI-compatible service', () => {
  test('without a key it is NOT RUN (exit 75) and says what to set', async () => {
    const r = await run({})
    expect(r.code).toBe(75)
    expect(r.err).toContain('OPENAI_API_KEY')
  })
  test('a base URL that is not https (and not this machine) is refused', async () => {
    const r = await run({ MEERKAT_AI_KEY: 'k', MEERKAT_AI_BASE_URL: 'http://example.org/v1', MEERKAT_AI_MODEL: 'm' })
    expect(r.code).toBe(75)
  })
  test('it posts the prompt with the key as a bearer token and prints the answer; the key never appears in output', async () => {
    let seen: any = null
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (b) => (body += b))
      req.on('end', () => {
        seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as any).port
    try {
      const r = await run({ MEERKAT_AI_KEY: 'sk-test-secret', MEERKAT_AI_BASE_URL: `http://127.0.0.1:${port}/v1`, MEERKAT_AI_MODEL: 'test-model' }, 'review this')
      expect(r.code).toBe(0)
      expect(r.out.trim()).toBe('OK')
      expect(seen.url).toBe('/v1/chat/completions')
      expect(seen.auth).toBe('Bearer sk-test-secret')
      expect(seen.body.model).toBe('test-model')
      expect(seen.body.messages[0].content).toBe('review this')
      expect(r.out + r.err).not.toContain('sk-test-secret')
    } finally {
      server.closeAllConnections?.()
      server.close()
    }
  })
  test('a service error is reported without the key', async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 401
      res.end('bad key sk-test-secret')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as any).port
    try {
      const r = await run({ MEERKAT_AI_KEY: 'sk-test-secret', MEERKAT_AI_BASE_URL: `http://127.0.0.1:${port}/v1`, MEERKAT_AI_MODEL: 'm' })
      expect(r.code).toBe(1)
      expect(r.err).toContain('401')
      expect(r.err).not.toContain('sk-test-secret')
    } finally {
      server.closeAllConnections?.()
      server.close()
    }
  })
})
