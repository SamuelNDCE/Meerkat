// A model command for the AI checks that talks to any OpenAI-compatible service (OpenAI, OpenRouter, a local server).
// The AI checks write a prompt to a command's stdin and read its answer from stdout: this is such a command.
//   node thorough/ai-openai.mjs            reads the prompt on stdin, prints the model's answer
// The key comes only from the environment, and is never printed or written anywhere:
//   OPENAI_API_KEY      OpenAI (base URL https://api.openai.com/v1, model gpt-4o-mini)
//   OPENROUTER_API_KEY  OpenRouter (base URL https://openrouter.ai/api/v1, model openai/gpt-4o-mini)
//   MEERKAT_AI_KEY      any other service; set MEERKAT_AI_BASE_URL (and MEERKAT_AI_MODEL) with it
// MEERKAT_AI_MODEL and MEERKAT_AI_BASE_URL override the defaults. A base URL must be https, or http only for this machine.
// It is run only by the AI checks, which are off unless asked for, and which say what they send before sending.
import { readFileSync } from 'node:fs'

const env = process.env
const pick = () => {
  if (env.MEERKAT_AI_KEY) return { key: env.MEERKAT_AI_KEY, base: env.MEERKAT_AI_BASE_URL, model: env.MEERKAT_AI_MODEL }
  if (env.OPENROUTER_API_KEY) return { key: env.OPENROUTER_API_KEY, base: env.MEERKAT_AI_BASE_URL ?? 'https://openrouter.ai/api/v1', model: env.MEERKAT_AI_MODEL ?? 'openai/gpt-4o-mini' }
  if (env.OPENAI_API_KEY) return { key: env.OPENAI_API_KEY, base: env.MEERKAT_AI_BASE_URL ?? 'https://api.openai.com/v1', model: env.MEERKAT_AI_MODEL ?? 'gpt-4o-mini' }
  return null
}

const fail = (message, code = 1) => {
  console.error(message)
  process.exit(code)
}

const cfg = pick()
if (!cfg) fail('NOT RUN: no model key found. Set OPENAI_API_KEY, OPENROUTER_API_KEY, or MEERKAT_AI_KEY (with MEERKAT_AI_BASE_URL and MEERKAT_AI_MODEL).', 75)
if (!cfg.base || !cfg.model) fail('NOT RUN: with MEERKAT_AI_KEY, also set MEERKAT_AI_BASE_URL and MEERKAT_AI_MODEL.', 75)
if (!/^https:\/\//i.test(cfg.base) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(cfg.base)) fail('NOT RUN: the base URL must be https (or http for this machine only).', 75)

const prompt = readFileSync(0, 'utf8')
const url = `${cfg.base.replace(/\/+$/, '')}/chat/completions`
try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(120000),
  })
  const text = await res.text()
  if (!res.ok) fail(`the model service answered ${res.status}: ${text.slice(0, 300).replace(cfg.key, '<key>')}`)
  const answer = JSON.parse(text)?.choices?.[0]?.message?.content
  if (typeof answer !== 'string') fail('the model service sent an answer in a shape this command does not understand')
  process.stdout.write(`${answer}\n`)
} catch (e) {
  fail(`the model service could not be reached: ${String(e.cause?.code ?? e.message).replace(cfg.key, '<key>')}`)
}
