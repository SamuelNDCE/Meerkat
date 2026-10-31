// Which model the opt-in AI checks use, in one place. Used by the AI checks (thorough/ai.mjs) and by `meerkat ai ...` (lib/aiconfig.mjs).
// The choice lives in ~/.meerkat-ai.json: { "provider": "claude" | "openai" | "openrouter", "model": "<name>" }. A key is never stored:
// it is read from the environment by the command that talks to the service. Order of precedence:
//   1. MEERKAT_AI_CMD (a JSON array: any command that reads a prompt on stdin and prints an answer)
//   2. a command saved by hand in the file ("cmd": [...])
//   3. the provider and model you chose with `meerkat ai use <provider> [model]`
//   4. nothing chosen: your Claude Code login if the claude command exists, else a key in the environment (OpenRouter, then OpenAI)
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBinary } from './which.mjs'

export const CLAUDE_DEFAULT_MODEL = 'haiku'
export const PROVIDERS = ['claude', 'openai', 'openrouter']
const OPENAI_SCRIPT = fileURLToPath(new URL('../thorough/ai-openai.mjs', import.meta.url))
const DEFAULTS = { openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }, openrouter: { base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' } }
const MODEL_OK = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,100}$/

export const validModel = (m) => typeof m === 'string' && MODEL_OK.test(m)

export function readAiFile(home = homedir()) {
  try {
    const j = JSON.parse(readFileSync(join(home, '.meerkat-ai.json'), 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

const claudeCmd = (model) => ['claude', '-p', '--model', model, '--tools', '', '--setting-sources', 'user', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']
const strings = (v) => (Array.isArray(v) && v.length && v.every((a) => typeof a === 'string') ? v : null)

// Returns { cmd, env, label, provider, model } or { error }. `env` holds extra variables the command needs (the model name).
export function resolveAi(env = process.env, home = homedir()) {
  if (env.MEERKAT_AI_CMD) {
    let cmd = null
    try {
      cmd = strings(JSON.parse(env.MEERKAT_AI_CMD))
    } catch {
      /* not JSON */
    }
    return cmd ? { cmd, env: {}, label: cmd[0], provider: 'custom', model: null } : { error: 'MEERKAT_AI_CMD is not a JSON array of strings' }
  }
  const saved = readAiFile(home)
  const savedCmd = strings(saved.cmd)
  if (savedCmd && !PROVIDERS.includes(saved.provider)) return { cmd: savedCmd, env: {}, label: savedCmd[0], provider: 'custom', model: null }
  const hasKey = Boolean(env.MEERKAT_AI_KEY || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY)
  let provider = PROVIDERS.includes(saved.provider) ? saved.provider : !findBinary('claude', env) && hasKey ? (env.OPENROUTER_API_KEY ? 'openrouter' : 'openai') : 'claude'
  const model = validModel(saved.model) ? saved.model : validModel(env.MEERKAT_AI_MODEL) ? env.MEERKAT_AI_MODEL : null
  if (provider === 'claude') {
    const m = model ?? CLAUDE_DEFAULT_MODEL
    return { cmd: claudeCmd(m), env: {}, label: `Claude ${m} (your own Claude Code login)`, provider, model: m }
  }
  const d = DEFAULTS[provider] ?? DEFAULTS.openai
  const m = model ?? d.model
  let host = env.MEERKAT_AI_BASE_URL ?? d.base
  try {
    host = new URL(host).host
  } catch {
    /* keep as written */
  }
  return { cmd: [process.execPath, OPENAI_SCRIPT], env: { MEERKAT_AI_MODEL: m }, label: `${m} through ${provider} (${host})`, provider, model: m }
}
