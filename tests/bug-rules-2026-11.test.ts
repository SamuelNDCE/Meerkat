// Rules added from five real NeuralVault bug-fix commits Meerkat had missed. Each rule: its bad sample is found, its clean twin is not, and the shape
// of the real bug (the commit's before and after) behaves the same way. Narrowing cases show what the rules leave alone.
import { describe, expect, test } from 'vitest'
import { selfProve } from '../thorough/rules.mjs'
import { API_FFI_WASM, ERRORS } from '../thorough/rules-rust-plus.mjs'
import { JS } from '../thorough/rules-code-patterns.mjs'

const NEW_IDS = ['rapi-debug-secret-enum-field', 'rerr-swallowed-read-then-write', 'js-duplicate-import-binding', 'js-deno-handler-raw-error', 'js-await-after-debit']
const rule = (id: string) => [...API_FFI_WASM, ...ERRORS, ...JS].find((r: any) => r.id === id) as any
const hits = (id: string, text: string, file: string) => {
  const r = rule(id)
  const lines = text.split(/\r?\n/)
  return lines.map((l, index) => (r.skipLine?.test(l) ? false : r.test(l, { file, lines, index, text }))).filter(Boolean).length
}

describe('selfProve for the new rules', () => {
  test.each(NEW_IDS)('%s: bad found, good clean', (id) => {
    expect(selfProve([rule(id)])).toEqual([])
  })
})

describe('rapi-debug-secret-enum-field', () => {
  const id = 'rapi-debug-secret-enum-field'
  test('the Backend enum from commit dd36a1a52 is found, the hand-written Debug is not', () => {
    const bad = '#[derive(Clone, Debug)]\npub enum Backend {\n    Ollama,\n    Cloud,\n    Claude { api_key: String, model: String },\n}\n'
    const good = '#[derive(Clone)]\npub enum Backend {\n    Ollama,\n    Claude { api_key: String, model: String },\n}\n\nimpl std::fmt::Debug for Backend {}\n'
    expect(hits(id, bad, 'src/types.rs')).toBe(1)
    expect(hits(id, good, 'src/types.rs')).toBe(0)
  })
  test('a secret-named field in a struct is left to rapi-debug-secret-field, and a skip note silences it', () => {
    expect(hits(id, '#[derive(Debug)]\npub struct S {\n    api_key: String,\n}\n', 'src/a.rs')).toBe(0)
    expect(hits(id, '#[derive(Debug)]\nenum B {\n    // redacted by hand\n    C { api_key: String },\n}\n', 'src/a.rs')).toBe(0)
  })
})

describe('rerr-swallowed-read-then-write', () => {
  const id = 'rerr-swallowed-read-then-write'
  const bad = 'fn add(path: &Path) -> Result<(), String> {\n    let text = std::fs::read_to_string(&path).unwrap_or_default();\n    let cols = parse(&text);\n    std::fs::write(&path, render(&cols)).map_err(|e| e.to_string())\n}\n'
  test('the board writer from commit 383c8107f is found', () => expect(hits(id, bad, 'src/pages.rs')).toBe(1))
  test('unwrap_or(String::new()) is the same shape', () => expect(hits(id, bad.replace('unwrap_or_default()', 'unwrap_or(String::new())'), 'src/pages.rs')).toBe(1))
  test('a temp file plus rename, or a NotFound check, is the repair and is not reported', () => {
    expect(hits(id, bad.replace('std::fs::write(&path,', 'std::fs::rename(&tmp, &path); std::fs::write(&tmp,'), 'src/pages.rs')).toBe(0)
    expect(hits(id, bad.replace('    let cols', '    // ErrorKind::NotFound is handled by the caller\n    let cols'), 'src/pages.rs')).toBe(0)
  })
  test('a read in one function and a write in another is not reported', () => {
    expect(hits(id, 'fn a(p: &Path) -> String {\n    let t = std::fs::read_to_string(p).unwrap_or_default();\n    t\n}\nfn b(p: &Path) {\n    std::fs::write(p, "x").ok();\n}\n', 'src/a.rs')).toBe(0)
  })
  test('a read whose result never reaches the write is not reported', () => {
    expect(hits(id, 'fn a(p: &Path) {\n    let t = std::fs::read_to_string(p).unwrap_or_default();\n    log(&t);\n    std::fs::write(p, "fixed").ok();\n}\n'.replace('log(&t);\n    ', ''), 'src/a.rs')).toBe(0)
  })
})

describe('js-duplicate-import-binding', () => {
  const id = 'js-duplicate-import-binding'
  test('the duplicate "can" from commit 5bdbac49e is found on the second import', () => {
    const t = "import { useEntitlements } from '../stores/entitlements'\nimport { can, pageAllowed } from '../entitlements'\nimport { x } from './x'\nimport type { Thing } from './t'\nimport {\n  can,\n  other,\n} from './perms'\n"
    expect(hits(id, t, 'src/ChatPage.tsx')).toBe(1)
  })
  test('aliases, type modifiers, default and namespace imports are read correctly', () => {
    expect(hits(id, "import a, { b as c, type D } from 'm'\nimport * as ns from 'n'\nimport { b } from 'o'\n", 'src/a.ts')).toBe(0)
    expect(hits(id, "import a, { b as c } from 'm'\nimport c from 'o'\n", 'src/a.ts')).toBe(1)
    expect(hits(id, "import type { T } from 'm'\nimport { T } from 'o'\n", 'src/a.ts')).toBe(1)
  })
  test('declaration files and indented imports (module augmentation) are left alone', () => {
    expect(hits(id, "import { a } from 'm'\nimport { a } from 'o'\n", 'src/a.d.ts')).toBe(0)
    expect(hits(id, "import { a } from 'm'\ndeclare module 'x' {\n  import { a } from 'o'\n}\n", 'src/a.ts')).toBe(0)
  })
})

describe('js-deno-handler-raw-error', () => {
  const id = 'js-deno-handler-raw-error'
  const bad = 'Deno.serve(async (req) => {\n  try {\n    return ok()\n  } catch (e) {\n    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })\n  }\n})\n'
  test('the metrics-collector handler from commit d38509789 is found', () => expect(hits(id, bad, 'index.ts')).toBe(1))
  test('e.message and a template with the error are found too', () => {
    expect(hits(id, bad.replace('String(e)', 'e.message'), 'index.ts')).toBe(1)
    expect(hits(id, bad.replace('String(e)', '`failed: ${e}`'), 'index.ts')).toBe(1)
  })
  test('a caller check before the response, a fixed word, or no Deno.serve is not reported', () => {
    expect(hits(id, bad.replace('try {', 'const caller = await checkCaller(req)\n  try {'), 'index.ts')).toBe(0)
    expect(hits(id, bad.replace('String(e)', "'internal'"), 'index.ts')).toBe(0)
    expect(hits(id, bad.replace('Deno.serve(', 'app.get('), 'index.ts')).toBe(0)
  })
})

describe('js-await-after-debit', () => {
  const id = 'js-await-after-debit'
  const bad = 'Deno.serve(async (req) => {\n  const hold = await reserveManagedChatBudget(db, acct, 50)\n  const upstream = await fetch(URL, { method: "POST" })\n  const rawBody = await upstream.text()\n  return new Response(rawBody)\n})\n'
  test('the managed-chat handler from commit 16413feac is found (fetch and body read)', () => expect(hits(id, bad, 'index.ts')).toBe(2))
  test('a try around the call, or a .catch, is not reported', () => {
    expect(hits(id, bad.replace('  const upstream', '  try {\n  const upstream').replace('  return new', '  } catch (err) { await refund() }\n  return new'), 'index.ts')).toBe(0)
    expect(hits(id, 'async function f() {\n  await debitCredits(1)\n  const r = await fetch(U).catch(() => null)\n}\n', 'a.ts')).toBe(0)
  })
  test('a fetch with no debit before it, or a debit in another function, is not reported', () => {
    expect(hits(id, 'async function f() {\n  const r = await fetch(U)\n  return r.text()\n}\n', 'a.ts')).toBe(0)
    expect(hits(id, 'async function a() {\n  await debitCredits(1)\n}\nasync function b() {\n  const r = await fetch(U)\n}\n', 'a.ts')).toBe(0)
  })
})
