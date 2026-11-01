// The terminal side of the results screen (lib/tui/results.mjs draws and decides; this reads keys and carries out what it asks for).
// Full screen on the alternate screen: entered once, restored on every way out (a key, Ctrl+C, an exit of the process), so the cursor is
// never left hidden and the terminal's earlier text comes back untouched. Everything that touches the world is passed in (`deps`), so a
// test drives it with a fake terminal and a fake clipboard.
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { colorLevel } from './color.mjs'
import { initialResultsState, renderResults, resultsStep } from './results.mjs'
const promptName = (file) => basename(String(file))

const ESC = '\x1b['

// deps: parseKeys(text) -> key names, copyText(text, env) -> boolean, showWhy(id, env) -> { text }, showLast(env) -> { text },
// repoChangesText(cwd) -> text. Returns 'done', 'menu' or 'again'.
export function runResultsScreen({ data: firstData, stdin = process.stdin, stdout = process.stdout, env = process.env, cwd = process.cwd(), deps, exists = existsSync }) {
  let data = firstData
  const color = Boolean(stdout.isTTY) && !env.NO_COLOR && !env.MEERKAT_PLAIN
  const level = color ? colorLevel(env) : false
  let state = initialResultsState({ message: data.runDir ? `Findings written to ${data.runDir}` : '' })
  const size = () => ({ width: stdout.columns || 100, rows: stdout.rows || 30 })
  const draw = () => {
    const { width, rows } = size()
    const lines = renderResults(state, data, { width, rows, color, level, env })
    stdout.write(`${ESC}H${lines.map((l) => `${l}${ESC}K`).join('\n')}${ESC}J`)
  }
  const view = (title, text) => {
    state = { ...state, view: { title, lines: String(text).split('\n'), scroll: 0 } }
  }
  const copy = (what, path) => {
    const ok = path ? deps.copyText(path, env) : false
    return ok ? `${what}: ${path}  (path copied to clipboard)` : `${what}: ${path}  (no clipboard tool found, copy the path from here)`
  }
  // Returns a result when the screen should close.
  const carryOut = (action) => {
    if (!action) return null
    if (['done', 'menu', 'again'].includes(action.type)) return action.type
    if (action.type === 'copyFolder') {
      const dir = data.runDir
      state.message = dir && exists(join(dir, 'findings.json')) ? copy('Findings folder created', dir) : `This run saved no findings folder${dir ? ` (the run folder is ${dir})` : ''}.`
    } else if (action.type === 'copyLog') {
      const c = data.checks.find((x) => x.id === action.id)
      state.message = c?.logFile ? copy('Log path', c.logFile) : 'That check has no log file.'
    } else if (action.type === 'log') view(`Log of ${action.id}`, deps.showWhy(action.id, env).text)
    else if (action.type === 'report') view('Report of this run', deps.showLast(env).text)
    else if (action.type === 'changes') view('Repo changes', deps.repoChangesText(cwd))
    else if (action.type === 'prompt') {
      const r = data.runDir && deps.createPrompt ? deps.createPrompt(env, null, { dir: data.runDir }) : null
      state.message = !r ? 'This run saved no findings folder, so there is nothing to write a prompt from.' : r.ok ? (r.copied ? `Prompt saved: ${promptName(r.file)}  (a short instruction is on your clipboard)` : `Prompt saved: ${promptName(r.file)}  (no clipboard tool: tell the AI to read this file)`) : String(r.text)
    } else if (action.type === 'verifyOffer') {
      const plan = data.runDir && deps.aiVerifyPlan ? deps.aiVerifyPlan(data.runDir, { env }) : null
      if (!plan) state.message = 'AI verification needs a run with findings.'
      else if (!plan.ok) state.message = plan.text
      else state = { ...state, view: { title: 'AI verification (optional)', lines: `${plan.text}\n\nPress y to send this, any other key to cancel.`.split('\n'), scroll: 0, confirm: 'verify' } }
    } else if (action.type === 'verifyGo') {
      state.message = 'Asking the model... this can take a minute. The screen updates when it is done.'
      Promise.resolve(deps.aiVerify(data.runDir, { env, yes: true }))
        .then((r) => {
          const next = r.ok && deps.reload ? deps.reload(data.runDir) : null
          if (next) data = next
          state = { ...state, message: r.text }
        })
        .catch((e) => {
          state = { ...state, message: `AI verification: NOT RUN (${String(e?.message ?? e).slice(0, 120)})` }
        })
        .finally(() => draw())
    }
    return null
  }
  return new Promise((resolve) => {
    let active = false
    const leave = () => {
      if (!active) return
      active = false
      stdin.off?.('data', onData)
      stdout.off?.('resize', draw)
      try {
        stdin.setRawMode?.(false)
      } catch {
        /* the terminal is already gone */
      }
      stdin.pause?.()
      stdout.write(`${ESC}0m${ESC}?25h${ESC}?1049l`)
    }
    const finish = (result) => {
      leave()
      process.off('exit', leave)
      resolve(result)
    }
    const onData = (buf) => {
      for (const key of deps.parseKeys(String(buf))) {
        const next = resultsStep(state, key, data, { rows: size().rows })
        state = next.state
        const result = carryOut(next.action)
        if (result) return finish(result)
      }
      draw()
    }
    active = true
    process.once('exit', leave)
    stdout.write(`${ESC}?1049h${ESC}?25l`)
    stdin.setRawMode?.(true)
    stdin.resume?.()
    stdin.on('data', onData)
    stdout.on?.('resize', draw)
    draw()
  })
}
