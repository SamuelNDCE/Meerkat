// Output for CI systems and git hooks. Nothing here runs a check.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { buildComment } from './github.mjs'

const live = (doc) => (doc?.findings ?? []).filter((f) => f.status !== 'accepted')
const escData = (s) => String(s ?? '').replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
const levelOf = (sev) => (sev === 'critical' || sev === 'high' ? 'error' : sev === 'medium' ? 'warning' : 'notice')

export function githubAnnotations(doc) {
  const out = []
  for (const f of live(doc)) {
    if (!f.file) continue
    const line = Number(f.line) > 0 ? Number(f.line) : 1
    out.push(`::${levelOf(f.severity)} file=${escProp(f.file)},line=${line},title=${escProp(f.rule || f.check || f.title)}::${escData(f.message ?? f.title)}`)
  }
  return out
}

// The pull request comment body. Built in lib/github.mjs: blocking count and top five first, linked file:line, one hidden marker.
export function prComment(doc, opts = {}) {
  return buildComment(doc, opts)
}

import { blockRe } from './hook-safety.mjs'
export { prePushBlock, hookRefusals, hookStatus, shq } from './hook-safety.mjs'

export function installHook(file, block) {
  try {
    if (!existsSync(file)) {
      writeFileSync(file, `#!/bin/sh\n${block}\n`, { mode: 0o755 })
      return { ok: true, detail: 'created' }
    }
    const text = readFileSync(file, 'utf8')
    if (blockRe.test(text)) {
      writeFileSync(file, text.replace(blockRe, () => `${block}\n`))
      return { ok: true, detail: 'replaced' }
    }
    writeFileSync(file, `${text}${text.endsWith('\n') || !text ? '' : '\n'}${block}\n`)
    return { ok: true, detail: 'appended' }
  } catch (e) {
    return { ok: false, detail: String(e?.message ?? e) }
  }
}

export function removeHook(file) {
  try {
    if (!existsSync(file)) return { ok: true, detail: 'no hook file' }
    const text = readFileSync(file, 'utf8')
    if (!blockRe.test(text)) return { ok: true, detail: 'no meerkat block' }
    writeFileSync(file, text.replace(blockRe, ''))
    return { ok: true, detail: 'removed' }
  } catch (e) {
    return { ok: false, detail: String(e?.message ?? e) }
  }
}
