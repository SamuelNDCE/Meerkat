// The security-plus pack: checks that read the code for common security mistakes (CORS, cookies, JWT, SQL built from strings, paths, redirects, regex blow-ups, weak crypto, URL passwords, XML and deserialization). Turn it on with { "packs": ["security-plus"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const SC = `${MK}/thorough/sec-code.mjs`
const make = (id, title) => ({
  id,
  group: 'security',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  needs: ['node'],
  run: { cmd: 'node', args: [SC, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [SC, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('cors-wildcard', 'CORS: no site may read responses with credentials, and Origin is not copied back unchecked'),
  make('cookie-flags', 'Cookies are set with HttpOnly, Secure and SameSite'),
  make('jwt-weak', 'JWTs: no "none" algorithm, no decode used as a sign-in check, no secret typed into the code'),
  make('hardcoded-ip', 'No public IP address written into the code'),
  make('debug-enabled', 'Debug mode is not switched on where it should be off'),
  make('sql-concat', 'SQL is not built by joining text and values together'),
  make('path-traversal-pattern', 'Files are not read or sent with a path taken straight from the request'),
  make('open-redirect-pattern', 'Redirects do not go to a request address without an allow-list check'),
  make('regex-dos', 'No regular expression that can take exponential time'),
  make('weak-crypto-modes', 'No weak cipher, ECB mode, fixed key, guessable token or MD5 password'),
  make('credentials-in-urls', 'No user name and password written into a web address'),
  make('xxe-and-deserialize', 'XML parsers are locked down and untrusted data is not deserialized'),
]
