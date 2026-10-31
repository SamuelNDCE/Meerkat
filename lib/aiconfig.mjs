// `meerkat ai ...`: which model the opt-in AI checks use. The choice is saved in ~/.meerkat-ai.json (outside any repository), and a
// key is never saved by Meerkat: it stays in an environment variable you set yourself.
//   meerkat ai status                       what is chosen, and whether the command and keys are visible
//   meerkat ai use claude [model]           your own Claude Code login; the model is optional (haiku, sonnet, opus, or a full id such as claude-haiku-5-5)
//   meerkat ai use openai [model]           OpenAI: set OPENAI_API_KEY (default model gpt-4o-mini)
//   meerkat ai use openrouter [model]       OpenRouter: set OPENROUTER_API_KEY; any model it serves, for example deepseek/deepseek-chat
//   meerkat ai test                         send one tiny prompt to the chosen model and show its answer (the only thing it sends)
// `provider:model` works too: meerkat ai use openrouter:deepseek/deepseek-chat. A model name is passed through as you type it, so use the
// exact name the provider lists.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROVIDERS, readAiFile, resolveAi, validModel } from './aimodel.mjs'
import { findBinary } from './which.mjs'

const file = (home = homedir()) => join(home, '.meerkat-ai.json')
const KEYS = { openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY' }

export function aiStatus(env = process.env, home = homedir()) {
  const r = resolveAi(env, home)
  const saved = readAiFile(home)
  const lines = []
  if (r.error) lines.push(`Problem: ${r.error}`)
  else lines.push(`The AI checks will use: ${r.label}`)
  lines.push(saved.provider ? `Chosen with meerkat ai use (${file(home)}).` : 'Nothing chosen yet: your Claude Code login is used if the claude command exists, else a key in the environment.')
  lines.push(`claude command: ${findBinary('claude', env) ? 'found' : 'not found'}`)
  for (const [name, key] of Object.entries(KEYS)) lines.push(`${key}: ${env[key] ? 'set' : 'not set'} (${name})`)
  lines.push('The AI checks are opt-in: they run only with --ai (or --include ai, or the release and security-ai presets), and say what they send first.')
  return lines.join('\n')
}

// `args` is what follows `use`: ["claude"], ["claude", "haiku"] or ["openrouter:deepseek/deepseek-chat"].
export function aiUse(args, env = process.env, home = homedir()) {
  const [first, second] = args
  const [provider, inline] = String(first ?? '').split(/:(.+)/)
  const model = second ?? inline ?? null
  if (!PROVIDERS.includes(provider)) return { ok: false, text: 'usage: meerkat ai use claude|openai|openrouter [model], or meerkat ai status' }
  if (model !== null && !validModel(model)) return { ok: false, text: `"${model}" is not a model name this command accepts (letters, digits and . _ : / @ + - only)` }
  writeFileSync(file(home), `${JSON.stringify({ provider, ...(model ? { model } : {}) }, null, 2)}\n`)
  const r = resolveAi(env, home)
  const key = KEYS[provider]
  const keyNote = key ? ` Meerkat never stores a key: set ${key} in your environment${env[key] ? ' (it is set now)' : ' (it is not set yet)'}.` : ''
  return { ok: true, text: `The AI checks will use ${r.label}.${keyNote}\nTry it: meerkat ai test` }
}

// One tiny prompt, so a person can see the choice works before an AI check sends any code.
export function aiTest(env = process.env, home = homedir(), timeoutMs = 90000) {
  const r = resolveAi(env, home)
  if (r.error) return Promise.resolve({ ok: false, text: r.error })
  return new Promise((resolve) => {
    const cwd = mkdtempSync(join(tmpdir(), 'meerkat-ai-'))
    const finish = (res) => {
      clearTimeout(timer)
      rmSync(cwd, { recursive: true, force: true })
      resolve(res)
    }
    const child = spawn(r.cmd[0], r.cmd.slice(1), { cwd, env: { ...env, ...r.env }, shell: process.platform === 'win32' && r.cmd[0] === 'claude', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, text: `${r.label}: no answer after ${timeoutMs / 1000} s` })
    }, timeoutMs)
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (err += b))
    child.on('error', (e) => finish({ ok: false, text: `${r.label}: could not start (${e.code ?? e.message})` }))
    child.on('close', (code) => finish(code === 0 && out.trim() ? { ok: true, text: `${r.label} answered: ${out.trim().slice(0, 200)}` } : { ok: false, text: `${r.label} failed (exit ${code}): ${(err || out).trim().slice(0, 300)}` }))
    child.stdin.on('error', () => {})
    child.stdin.end('Reply with the single word OK and nothing else.')
  })
}
