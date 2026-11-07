// The code-patterns pack: six checks, one per language family, that read the source for dangerous calls and settings
// (shell and process calls, unsafe deserialization, disabled TLS checks, weak crypto, world-writable modes, and so on).
// Turn it on with { "packs": ["code-patterns"] } in meerkat.config.json. Each check prints one sub-check per rule
// (see docs/suites.md). A language that is not in the project reports NA for its rules, never a failure.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'
import { CHECK_TABLES } from '../../thorough/rules-code-patterns.mjs'

const CP = `${MK}/thorough/code-patterns.mjs`
const check = (id, title, suite) => ({
  id,
  group: 'security',
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  title,
  estSeconds: 1,
  suite,
  subs: CHECK_TABLES[id].length,
  needs: ['node'],
  run: { cmd: 'node', args: [CP, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [CP, id, '--fixtures'], cwd: 'repo', expectFail: true, expectMatch: 'found' },
})

export default [
  check('cp-python', 'Python: no shell or process call from variables, no unsafe loads, no disabled TLS, no weak modes', 'risky-calls'),
  check('cp-js', 'JavaScript and TypeScript: no command or require built from variables, no timing-unsafe secret checks, no hidden characters, no duplicate imports, no raw error text from a Deno handler, no unguarded fetch after a debit', 'risky-calls'),
  check('cp-go', 'Go: no hardcoded secrets, no unbounded servers, no command or path from requests, no weak crypto', 'risky-calls'),
  check('cp-rust', 'Rust: unsafe blocks carry a SAFETY note, no weak hashes, no secrets printed', 'risky-calls'),
  check('cp-java', 'Java: no runtime exec or object deserialization from untrusted input, no trust-all TLS, no expression injection', 'injection-patterns'),
  check('cp-dotnet-php-ruby', 'C#, PHP and Ruby: no unsafe deserialization, no eval of input, no disabled checks, no unscoped params', 'injection-patterns'),
]
