// `meerkat ai ...`: which model the opt-in AI checks use. The choice is saved in ~/.meerkat-ai.json (outside any repository), and a
// key is never saved by Meerkat: it stays in an environment variable you set yourself.
//   meerkat ai status            what is chosen and whether a key is visible
//   meerkat ai use claude        your own Claude Code login (the default; needs the `claude` command)
//   meerkat ai use openai        OpenAI: set OPENAI_API_KEY (model gpt-4o-mini, change it with MEERKAT_AI_MODEL)
//   meerkat ai use openrouter    OpenRouter: set OPENROUTER_API_KEY (model openai/gpt-4o-mini)
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { MEERKAT_DIR } from './paths.mjs'
import { findBinary } from './which.mjs'

const file = (home = homedir()) => join(home, '.meerkat-ai.json')
const script = () => `${MEERKAT_DIR}/thorough/ai-openai.mjs`

const KEYS = { openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' }

export function aiStatus(env = process.env, home = homedir()) {
  let saved = null
  try {
    saved = JSON.parse(readFileSync(file(home), 'utf8'))
  } catch {
    /* none */
  }
  const lines = []
  if (env.MEERKAT_AI_CMD) lines.push('MEERKAT_AI_CMD is set: that command is used.')
  else if (saved?.cmd) lines.push(`A model command is saved in ${file(home)} (${saved.provider ?? 'custom'}).`)
  else lines.push('Nothing is saved: your Claude Code login is used if the claude command exists, else a key in the environment.')
  lines.push(`claude command: ${findBinary('claude', env) ? 'found' : 'not found'}`)
  for (const [name, key] of Object.entries(KEYS)) lines.push(`${key}: ${env[key] ? 'set' : 'not set'} (${name})`)
  lines.push('The AI checks are opt-in: they run only with --include ai (or the release and security-ai presets), and say what they send first.')
  return lines.join('\n')
}

export function aiUse(provider, env = process.env, home = homedir()) {
  if (provider === 'claude') {
    if (existsSync(file(home))) rmSync(file(home))
    return { ok: true, text: 'The AI checks will use your Claude Code login (the claude command).' }
  }
  if (!KEYS[provider]) return { ok: false, text: 'usage: meerkat ai use claude|openai|openrouter, or meerkat ai status' }
  writeFileSync(file(home), `${JSON.stringify({ provider, cmd: [process.execPath, script()] }, null, 2)}\n`)
  const key = KEYS[provider]
  return { ok: true, text: `The AI checks will use ${provider}. Meerkat never stores a key: set ${key} in your environment${env[key] ? ' (it is set now)' : ' (it is not set yet)'}.` }
}
