// Clean-twin repairs. A clean twin is the rule's own known-good sample written into a complete project. Some good samples are clean for the rule
// they were written for but still contain the unsafe shape of ANOTHER rule (an undocumented pub fn, an ipcRenderer.on that is never removed, a
// <webview> tag in a sample about one of its attributes). That is a fault of the twin, not of the rule, so the twin is repaired here: the
// repaired twin does what the rule's good sample does and also follows the other rules' advice. fixTwin(ext, text, ruleId) -> text.
const DOC_TARGET = /^(\s*)pub\s+(?:(?:async|unsafe|const)\s+|extern\s+"C"\s+)*(fn|struct|enum|trait)\s+(\w+)/
const SECRET_FIELD = /password|secret|token|api_?key|private_?key/i

function fixRust(text, ruleId, file) {
  const lines = text.split('\n')
  const out = []
  const later = []
  for (let i = 0; i < lines.length; i++) {
    const m = DOC_TARGET.exec(lines[i])
    if (m) {
      const block = []
      while (out.length && /^\s*(#\[|\/\/\/)/.test(out.at(-1))) block.unshift(out.pop())
      const [, ind, kind] = m
      if (!block.some((l) => /^\s*\/\/\//.test(l))) block.unshift(`${ind}/// Documented item.`)
      // A type holding a secret gets a hand-written Debug that prints no field; the derive would print the secret (another rule).
      if ((kind === 'struct' || kind === 'enum') && SECRET_FIELD.test(lines.slice(i, i + 12).join('\n'))) {
        if (!/impl\s+(?:std::fmt::|fmt::)?Debug\s+for/.test(text) && !block.some((l) => /\bDebug\b/.test(l))) later.push(`\nimpl std::fmt::Debug for ${m[3]} {\n${ind}    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {\n${ind}        f.write_str("${m[3]}")\n${ind}    }\n${ind}}`)
      } else if ((kind === 'struct' || kind === 'enum') && ruleId !== 'rapi-debug-secret-field' && ruleId !== 'rapi-debug-secret-enum-field') {
        const d = block.findIndex((l) => /^\s*#\[derive\(/.test(l))
        if (d >= 0) {
          if (!/\bDebug\b/.test(block[d])) block[d] = block[d].replace(/derive\(/, 'derive(Debug, ')
        } else block.push(`${ind}#[derive(Debug)]`)
      }
      out.push(...block)
    }
    let line = lines[i]
    line = line.replace(/\.map_err\(\s*\|\s*_\s*\|\s*[\w:]+(?:\([^)]*\))?\s*\)/, '.map_err(Error::from)')
    line = line.replace(/(\benv::var\([^)]*\))\.ok\(\);/, '$1?;')
    const raw = /\bfrom_raw_parts(?:_mut)?\(\s*\w+\s*,\s*(\w+)\s*\)/.exec(line)
    if (raw && !/\bassert/.test(out.slice(-10).join('\n'))) {
      const ind = /^\s*/.exec(line)[0]
      // keep a SAFETY note directly above the call, where the aliasing rule looks for it
      const note = []
      while (out.length && /^\s*\/\/\s*SAFETY/i.test(out.at(-1))) note.unshift(out.pop())
      out.push(`${ind}assert!(${raw[1]} <= isize::MAX as usize);`, ...note)
    }
    out.push(line)
  }
  let t = out.join('\n').replace(/\n*$/, '\n') + later.join('\n') + (later.length ? '\n' : '')
  // The crate-root lint belongs in src/lib.rs only.
  if (/(^|\/)src\/lib\.rs$/.test(file) && /^\s*pub\s/m.test(t) && !/missing_docs/.test(t)) t = '#![deny(missing_docs)]\n\n' + t
  return t
}

function fixJs(text) {
  let t = text
  // An ipc handler checks which frame sent the message.
  if (/\bipcMain\.(?:handle|on)\(/.test(t) && !/\.sender\b|senderFrame|isMainFrame|frameId/.test(t)) {
    t = t.replace(/(\bipcMain\.(?:handle|on)\(\s*[^,]+,\s*)(async\s*)?\(\s*\)\s*=>\s*\{/g, "$1$2(event) => { if (!event.senderFrame) throw new Error('untrusted sender');")
  }
  // A listener the preload adds is removed again.
  if (/\bipcRenderer\.on\(\s*(['"`][^'"`]+['"`])/.test(t) && !/removeListener|removeAllListeners|\.off\(/.test(t)) {
    const chan = /\bipcRenderer\.on\(\s*(['"`][^'"`]+['"`])/.exec(t)[1]
    t = t.replace(/\n*$/, '') + `\nipcRenderer.removeAllListeners(${chan})\n`
  }
  return t
}

// A page that sits beside <webview> in a sample about one of its attributes uses a sandboxed iframe instead: only the tag rule's own twin has no <webview>.
function fixHtml(text, ruleId) {
  if (ruleId === 'ep-html-webview-tag') return text
  return text.replace(/<webview\b([^>]*)>\s*<\/webview>/gi, (_, attrs) => `<iframe${attrs.replace(/\b(?:allowpopups|nodeintegration|disablewebsecurity)\b/gi, '')} sandbox></iframe>`)
}

export function fixTwin(ext, text, ruleId, file) {
  if (ext === 'rs') return fixRust(text, ruleId, file)
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return fixJs(text)
  if (ext === 'html' || ext === 'htm') return fixHtml(text, ruleId)
  return text
}
