// Reading cargo's output: a compile failure (issues 14g, 14b) and the crate being built (18d).
// A crate whose test target does not compile makes every cargo check fail the same way; that is a problem with the build, not a finding.
// Text from cargo is untrusted: everything quoted is stripped of control characters and capped.
import { stripControl } from './tui/safe.mjs'

// "error: could not compile `nv-agents` (test "board_hostile_markdown") due to 1 previous error"
const COULD_NOT = /^\s*(?:error: )?could not compile [`'"]?([^`'"\s]+)[`'"]?(?: \(([^)]*)\))?/m
export const COMPILE_ERROR_RE = /^COMPILE ERROR: /
const FIRST_ERROR = /^error(?:\[E\d+\])?: (?!could not compile)(.+)$/m
const COMPILING = /^\s*Compiling ([A-Za-z0-9_.-]+) v\S+/

const clean = (s, n) => stripControl(String(s)).replace(/\s+/g, ' ').trim().slice(0, n)

// -> { crate, target, firstError, reason } or null.
export function parseCompileFailure(output) {
  const text = String(output ?? '')
  const m = COULD_NOT.exec(text)
  if (!m) return null
  const crate = clean(m[1], 80)
  const target = m[2] ? clean(m[2], 80) : null
  const first = FIRST_ERROR.exec(text)
  const firstError = first ? clean(`error: ${first[1]}`, 200) : null
  return { crate, target, firstError, reason: `COMPILE ERROR: could not compile ${crate}${target ? ` (${target})` : ''}${firstError ? `: ${firstError}` : ''}` }
}

// The crate named by one "Compiling <crate> v<version>" line, or null.
export function compilingCrate(line) {
  const m = COMPILING.exec(String(line ?? '').replace(/\r$/, ''))
  return m ? clean(m[1], 80) : null
}
