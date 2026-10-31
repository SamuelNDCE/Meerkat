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

export function redact(text) {
  let hard = 0
  let soft = 0
  let out = text
  for (const re of HARD) out = out.replace(re, () => (hard++, '<hidden>'))
  out = out.replace(SOFT, (_, head) => (soft++, `${head}<hidden>`))
  return { text: out, hard, soft }
}

// Paths whose contents are never sent, even in a diff.
export const SENSITIVE_PATH = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|ed25519|ecdsa)|\.npmrc|\.netrc|credentials(\.json)?|secrets?\.[a-z]+)$/i
