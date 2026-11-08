// Allow-file entries keyed on the flagged line's text instead of its line number, so an accepted finding survives the file moving.
//   <key> | <snippet> # <reason>        key is what the check already uses (a11y: "<rule> <file>")
// The snippet is matched against the TRIMMED text of the flagged line: it matches when that line still contains the snippet, wherever in the file the line now is.
// A trailing " # reason" is dropped from any entry (line-number entries too). Entries without " | " keep their old meaning.
export function parseAllowText(text) {
  return new Set(String(text ?? '').split(/\r?\n/).map((l) => l.replace(/\s+#\s.*$/, '').trim()).filter((l) => l && !l.startsWith('#')))
}

export function allowedBySnippet(allow, key, lineText) {
  const line = String(lineText ?? '').trim()
  if (!line) return false
  const head = `${key} | `
  for (const e of allow) if (e.startsWith(head) && e.length > head.length && line.includes(e.slice(head.length).trim())) return true
  return false
}

// The exact line to paste into the allow file to accept this finding, in the snippet form.
export function snippetAllowLine(key, lineText, max = 160) {
  const line = String(lineText ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
  return line ? `${key} | ${line} # reason` : null
}
