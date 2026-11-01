// `meerkat prompt [folder|run-id] [--last] [--no-copy] [--print]`: writes ai-prompt.md into the run folder (lib/aiprompt.mjs) and puts a
// short line on the clipboard that points an AI at it. Reads findings.json of the run; runs nothing.
import { copyText } from './clipboard.mjs'
import { writeAiPrompt } from './aiprompt.mjs'
import { resolveFindingsRun } from './findingscmd.mjs'
import { stripControl } from './tui/safe.mjs'

// The same thing the results screen's `p` key does. `copy(text)` returns true when the text reached the clipboard.
// `dir` names a run folder directly (the results screen knows it); otherwise `target` is resolved like `meerkat findings`.
export function createPrompt(env, target, { copy = (t) => copyText(t, env), noCopy = false, dir = null } = {}) {
  const r = dir ? { ok: true, dir } : resolveFindingsRun(env, target)
  if (!r.ok) return r
  const w = writeAiPrompt(r.dir)
  if (!w.ok) return w
  const copied = noCopy ? false : copy(w.short)
  return { ok: true, dir: r.dir, file: w.file, short: w.short, copied, text: w.text, doc: w.doc }
}

export function promptCommand(plan, ctx) {
  const { out, err, env = process.env } = ctx
  const f = plan.flags ?? {}
  const r = createPrompt(env, plan.target, { noCopy: Boolean(f.noCopy) || Boolean(f.print), ...(ctx.copy ? { copy: ctx.copy } : {}) })
  if (!r.ok) return (err(stripControl(r.text)), 1)
  if (f.print) {
    out(r.text.trimEnd())
    return 0
  }
  if (f.json) {
    out(JSON.stringify({ file: r.file, short: r.short, copied: r.copied, findings: r.doc.counts.total }, null, 2))
    return 0
  }
  out(`Wrote ${r.file} (${r.doc.counts.total} finding(s), every one in full).`)
  out(r.copied ? `Copied to the clipboard: ${r.short}` : f.noCopy ? `Give this to an AI: ${r.short}` : `No clipboard tool found. Give this to an AI: ${r.short}`)
  return 0
}
