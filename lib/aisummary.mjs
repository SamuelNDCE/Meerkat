// The first line of every MCP run result, written for an AI client that reads one line and decides what to do.
// Shape: "Meerkat <STATUS>: <n> failed, <n> warned, <n> passed. Top: file:line, file:line, file:line"
// "warned" is checks that could not run (NOT RUN, hang, crash-free skips): they are not failures, but they were not checked either.

const place = (f) => (f && f.file ? (f.line ? `${f.file}:${f.line}` : String(f.file)) : null)

// top: findings, most severe first (findingsSummary().top). Returns up to three file:line strings.
export function topPlaces(top, max = 3) {
  const seen = []
  for (const f of Array.isArray(top) ? top : []) {
    const p = place(f)
    if (p && !seen.includes(p)) seen.push(p)
    if (seen.length >= max) break
  }
  return seen
}

export function headline({ failed = 0, warned = 0, passed = 0, top = [] }) {
  const status = failed > 0 ? 'FAIL' : warned > 0 ? 'WARN' : 'PASS'
  const places = topPlaces(top)
  return `Meerkat ${status}: ${failed} failed, ${warned} warned, ${passed} passed.${places.length ? ` Top: ${places.join(', ')}` : ''}`
}

// A run with no checks is never an empty result: say which preset or scope it was and why nothing ran.
export function emptyRunText({ preset, scope, reason }) {
  const what = preset ? `the "${preset}" preset` : scope ? `the scope "${scope}"` : 'this selection'
  return `Meerkat ran no checks for ${what}. Reason: ${reason || 'no check matched the selection and the project'}. Nothing passed and nothing failed. Use meerkat_list to see which checks exist for this project, or meerkat_presets to pick another preset.`
}
