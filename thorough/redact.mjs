// Cleans text before it is sent to a model. `hard` counts values in a known secret format (a key, token or private-key block):
// the AI checks refuse to send anything that has one, because blanking is a safety net, not permission to send a secret.
// `soft` counts values that merely look like secrets in an assignment; those are blanked and the text is still sent.
const HARD = [
  /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bsk-[A-Za-z0-9_-]{32,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
]
// name = value or name: value, quoted or not, where the name says it is a secret.
const SOFT = /\b((?:[a-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|passwd|credential|authorization|bearer|private[_-]?key)[a-z0-9_.-]*)["'`]?\s*[:=]\s*(?:Bearer\s+)?["'`]?)([^\s"'`,;)}\]]{6,})/gi

const NAME = String.raw`[a-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|passwd|credential|authorization|bearer|private[_-]?key)[a-z0-9_.-]*`
// A quoted value of any content up to its closing quote, and an auth header's whole line (any scheme, not just Bearer).
const QUOTED = new RegExp(String.raw`\b(${NAME}["'\`]?\s*[:=]\s*)(["'\`])(?:\\.|(?!\2)[^\n\\]){3,500}?\2`, 'gi')
// An opening quote after a secret-named assignment with nothing closing it on the line, including a quote at the very end of the line
// (the value starts on the next line). An empty string ('' or "") is not matched.
const OPEN_QUOTE = new RegExp(String.raw`\b(${NAME}["'\`]?[ \t]*[:=][ \t]*(?:\r?\n[ \t]*){0,3}(["'\`]))(?!<hidden>)([^\n]*)$`, 'gim')
const AUTH_LINE = /\b(authorization["'`]?\s*[:=]\s*)(.+)$/gim

const MAX_LINE = 4000

export function redact(text) {
  // A very long line (minified code, a pasted blob) cannot be cleaned safely or quickly, so nothing is scanned and the caller must not send it.
  if (text.split('\n').some((l) => l.length > MAX_LINE)) return { text: '', hard: 0, soft: 0, long: true }
  let hard = 0
  let soft = 0
  let out = text
  for (const re of HARD) out = out.replace(re, () => (hard++, '<hidden>'))
  out = out.replace(AUTH_LINE, (_, head) => (soft++, `${head}<hidden>`))
  out = out.replace(QUOTED, (_, head) => (soft++, `${head}"<hidden>"`))
  // A secret-named assignment that opens a quote the pattern above could not close (a multi-line value, or one ending in a backslash):
  // the extent of the value is unknown, so it counts as a hard find and nothing is sent.
  out = out.replace(OPEN_QUOTE, (whole, head, quote, rest) => {
    // A truly empty string ending the statement ('' or "" then at most a closing mark) is fine; checked here in linear time.
    if (rest[0] === quote && rest[1] !== quote && /^[ \t]*[,;)}\]]?[ \t]*\r?$/.test(rest.slice(1))) return whole
    hard++
    return `${head}<hidden>`
  })
  out = out.replace(SOFT, (_, head) => (soft++, `${head}<hidden>`))
  return { text: out, hard, soft }
}

// Paths whose contents are never sent, even in a diff.
export const SENSITIVE_PATH = /(^|\/)([^/]*(credential|secret)[^/]*|\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ed25519|ecdsa)|\.npmrc|\.netrc)$/i
// Of those, the ones that are positively key or environment files and not code: nothing is lost by leaving these out of a review.
export const SECRET_FILE = /(^|\/)(\.env(\.(local|production|prod|development|dev|staging|test|example|sample))?|.*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ed25519|ecdsa)|\.npmrc|\.netrc)$/i
