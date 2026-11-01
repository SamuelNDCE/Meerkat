// Rust rule tables, deeper than the rs-* rules in rules-code-patterns.mjs. One table per check (rp-safety, rp-errors, rp-async,
// rp-perf-style, rp-cargo, rp-api-ffi-wasm); the runner is thorough/rust-plus.mjs and the pack is packs/rust-plus/rust-plus.mjs.
// The rules are Meerkat's own: written from the mistakes Clippy's groups (correctness, suspicious, perf, style, complexity, pedantic
// selections), the RustSec and cargo-deny config settings, and the Rust API guidelines describe, not copied from any tool's rule files.
// Each rule carries a bad and a good sample (selfProve). Regexes are linear (bounded {0,n} spans, no nested open quantifiers).
// Limits (per rule where it matters): a rule reads one line, or a few lines around it (before/after windows). Test code is skipped
// by path (tests/, benches/, examples/) and by the #[cfg(test)] block for library rules. Rules that need a whole project say so in
// `needs`. Rules whose title says "informational" are severity info and still count as a finding in the exit code.

const SLASH_SKIP = /^\s*(\/\/|\/\*|\*)/
const TOML_SKIP = /^\s*#/
// Tests, docs, examples, benches and vendored code, plus this engine's own files (their samples quote the dangerous code on purpose).
// Agent worktrees (.claude/worktrees) are duplicate checkouts of the same code, so they are excluded too.
const TEST_OUT = /(^|\/)\.claude\/|(^|\/)(tests?|__tests__|spec|specs|examples?|docs?|fixtures?|testdata|vendor|third_party|benches?)\/|\.(test|spec)\.[a-z]+$|(^|\/)(rules-rust-plus|rust-plus)\.mjs$|(^|\/)[^/]*_tests?\.rs$|(^|\/)tests?\.rs$|(^|\/)[^/]*_test\.rs$|(^|\/)packs\/rust-plus\//i
// Library code: every src file except the binary entry point and src/bin/.
const LIB = /(^|\/)src\/(?!main\.rs$|bin\/)(?:[^/]+\/)*[^/]+\.rs$/
const CARGO = /(^|\/)Cargo\.toml$/
const CARGO_CONF = /(^|\/)\.cargo\/config(?:\.toml)?$/
const DENY = /(^|\/)deny\.toml$/
const TOOLCHAIN = /(^|\/)rust-toolchain(?:\.toml)?$/
const BUILD_RS = /(^|\/)build\.rs$/

// A regex test that is true only when the match lies OUTSIDE a string literal (quotes tracked left to right, with escapes).
// Linear: the quote state is carried forward from one match to the next. Same approach as thorough/rules-code-patterns.mjs.
const outsideStrings = (re) => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  return (line) => {
    let state = null
    let pos = 0
    let esc = false
    for (const m of line.matchAll(g)) {
      while (pos < m.index) {
        const c = line[pos++]
        if (state) {
          if (esc) esc = false
          else if (c === '\\') esc = true
          else if (c === state) state = null
        } else if (c === '"' || c === "'" || c === '`') state = c
      }
      if (!state) return true
    }
    return false
  }
}

// The regex test, outside strings, with an extra condition on the context.
const T = (re, more) => {
  const ol = outsideStrings(re)
  return (line, ctx) => ol(line) && (more ? more(ctx) : true)
}
const reT = (re) => (line) => re.test(line)

// Context helpers. ctx = { file, lines, index, text } as the engine passes it.
const before = (ctx, n) => ctx.lines.slice(Math.max(0, ctx.index - n), ctx.index).join('\n')
const after = (ctx, n) => ctx.lines.slice(ctx.index + 1, ctx.index + 1 + n).join('\n')

// True when the line sits after a #[cfg(test)] line in the same file (test modules sit at the bottom of a file). The index is cached per lines array.
import { rustTestLines } from './kit.mjs'
const cfgTestAt = new WeakMap()
const inTestBlock = (ctx) => {
  // The exact #[cfg(test)] module (matched braces), not "everything after the first attribute": code after the module, or after a lone #[cfg(test)] item, is shipped code.
  let inTest = cfgTestAt.get(ctx.lines)
  if (inTest === undefined) {
    inTest = rustTestLines(ctx.file ?? 'a.rs', ctx.text ?? ctx.lines.join('\n'))
    cfgTestAt.set(ctx.lines, inTest)
  }
  return inTest(ctx.index + 1)
}

// The nearest function header above the line (within 300 lines), and whether that function is async.
const FN_LINE = /\bfn\s+\w+/
const enclosingFn = (ctx) => {
  for (let i = ctx.index - 1; i >= 0 && i >= ctx.index - 300; i--) if (FN_LINE.test(ctx.lines[i])) return ctx.lines[i]
  return ''
}
const inAsyncFn = (ctx) => /\basync\s+fn\b/.test(enclosingFn(ctx))

// True when the nearest trait header above the line (within 200 lines) is public.
const TRAIT_LINE = /^\s*(pub(?:\([^)]{0,20}\))?\s+)?trait\s+\w+/
const inPubTrait = (ctx) => {
  for (let i = ctx.index - 1; i >= 0 && i >= ctx.index - 200; i--) {
    const m = TRAIT_LINE.exec(ctx.lines[i])
    if (m) return !!m[1]
  }
  return false
}

// True when the item above (skipping blank lines and #[...] attributes) is a /// or //! doc line.
const hasDocAbove = (ctx) => {
  for (let i = ctx.index - 1; i >= 0; i--) {
    const l = ctx.lines[i]
    if (/^\s*$/.test(l) || /^\s*#\[/.test(l)) continue
    return /^\s*\/\/[/!]/.test(l)
  }
  return false
}

// TOML: the table a line belongs to, and the body of a named table in a whole file.
const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/
const tomlTable = (ctx) => {
  for (let i = ctx.index; i >= 0; i--) {
    const m = HEADER.exec(ctx.lines[i])
    if (m) return m[1]
  }
  return ''
}
const tomlBody = (text, name) => {
  const out = []
  let on = false
  for (const l of text.split(/\r?\n/)) {
    const m = HEADER.exec(l)
    if (m) {
      on = m[1] === name
      continue
    }
    if (on) out.push(l)
  }
  return out.join('\n')
}

// Rust source rule: outside string literals, skipping comment lines, test paths (TEST_OUT) by default.
const R = (id, title, re, bad, good, extra = {}) => ({
  id,
  title,
  ext: extra.files ? undefined : ['rs'],
  skipLine: SLASH_SKIP,
  notIn: TEST_OUT,
  bad,
  good,
  ...(re ? { re } : {}),
  ...(re && !extra.test ? { test: outsideStrings(re) } : {}),
  ...extra,
})
// Library rule: src files only, and not inside a #[cfg(test)] block.
const LIBR = (id, title, re, bad, good, more, extra = {}) =>
  R(id, title, re, bad, good, { files: LIB, sample: 'src/lib.rs', test: re ? T(re, (c) => !inTestBlock(c) && (more ? more(c) : true)) : undefined, ...extra })
// Manifest rule: a Cargo.toml line (or header) test, with TOML comments skipped.
const CARGO_R = (id, title, test, bad, good, extra = {}) => ({ id, title, files: CARGO, sample: 'Cargo.toml', skipLine: TOML_SKIP, test, bad, good, ...extra })
const CONF_R = (id, title, re, bad, good, extra = {}) => ({ id, title, files: CARGO_CONF, sample: '.cargo/config.toml', skipLine: TOML_SKIP, test: reT(re), bad, good, ...extra })
const DENY_R = (id, title, re, bad, good, extra = {}) => ({ id, title, files: DENY, sample: 'deny.toml', skipLine: TOML_SKIP, test: reT(re), bad, good, ...extra })

const PKG_HEADER = /^\s*\[package\]\s*$/

// ---------------------------------------------------------------- Safety (rp-safety)
export const SAFETY = [
  R('rsafe-unsafe-fn-no-safety-doc', 'an unsafe fn has no "# Safety" section in its doc comment', /\bunsafe\s+fn\s+\w+/, 'pub unsafe fn read_raw(p: *const u8) -> u8 {\n    *p\n}', '/// Reads one byte.\n///\n/// # Safety\n/// `p` must be valid for reads.\npub unsafe fn read_raw(p: *const u8) -> u8 {\n    *p\n}', {
    test: (line, ctx) => /\bunsafe\s+fn\s+\w+/.test(line) && !/#\s*Safety/.test(before(ctx, 12)),
  }),
  R('rsafe-unsafe-trait-no-safety-doc', 'an unsafe trait has no "# Safety" section in its doc comment', /\bunsafe\s+trait\s+\w+/, 'pub unsafe trait Zeroable {}', '/// # Safety\n/// Implementors must be valid when all bytes are zero.\npub unsafe trait Zeroable {}', {
    test: (line, ctx) => /\bunsafe\s+trait\s+\w+/.test(line) && !/#\s*Safety/.test(before(ctx, 12)),
  }),
  R('rsafe-unsafe-impl-send-sync', 'unsafe impl Send or Sync has no SAFETY note above it', /\bunsafe\s+impl\s*(?:<[^>\n]{0,80}>\s*)?(?:Send|Sync)\s+for\b/, 'unsafe impl Send for Buffer {}', '// SAFETY: the raw pointer is never shared between threads.\nunsafe impl Send for Buffer {}', {
    test: (line, ctx) => /\bunsafe\s+impl\s*(?:<[^>\n]{0,80}>\s*)?(?:Send|Sync)\s+for\b/.test(line) && !/SAFETY/.test(before(ctx, 3)),
  }),
  R('rsafe-transmute-copy', 'mem::transmute_copy reads bytes as a type without a size or alignment check', /\btransmute_copy\b/, 'let x: u32 = mem::transmute_copy(&bytes);', 'let x = u32::from_le_bytes(bytes);'),
  R('rsafe-transmute-slice-ref', 'a slice reference is transmuted to another element type (length and alignment change)', /\btransmute::<\s*&\s*\[/, 'let s: &[u8] = mem::transmute::<&[u32], &[u8]>(words);', 'let s: &[u8] = bytemuck::cast_slice::<u32, u8>(words);'),
  R('rsafe-zeroed-non-pod', 'mem::zeroed builds a String, Vec, Box, Rc or Arc, which is not valid when zeroed', /\blet\s+\w+\s*:\s*(?:String|Vec<[^>\n]{0,40}>|Box<[^>\n]{0,40}>|Rc<[^>\n]{0,40}>|Arc<[^>\n]{0,40}>)\s*=\s*(?:unsafe\s*\{\s*)?(?:std::)?mem::zeroed\(\)/, 'let name: String = unsafe { mem::zeroed() };', 'let count: u32 = unsafe { mem::zeroed() };'),
  R('rsafe-assume-init-no-write', 'MaybeUninit::assume_init is called with no write or init in the lines above', /\.assume_init\(\)/, 'let v = slot.assume_init();', 'let v = MaybeUninit::new(7);\nlet n = unsafe { v.assume_init() };', {
    test: (line, ctx) => /\.assume_init\(\)/.test(line) && !/\.write\(|MaybeUninit::new\(|ptr::write\(|\.as_mut_ptr\(\)/.test(before(ctx, 15)),
  }),
  R('rsafe-raw-ptr-offset-deref', 'a raw pointer is offset and dereferenced in one expression (no bounds check)', /\*\s*\w+\.(?:add|offset|sub|wrapping_add|wrapping_offset)\(/, 'let b = *base.add(i);', 'let b = base.get(i).copied().unwrap_or(0);'),
  R('rsafe-from-raw-parts-no-len-check', 'slice::from_raw_parts takes a length with no assert or range check above it', /\bfrom_raw_parts(?:_mut)?\(/, 'let s = unsafe { slice::from_raw_parts(ptr, len) };', 'assert!(len <= MAX_LEN);\nlet s = unsafe { slice::from_raw_parts(ptr, len) };', {
    test: (line, ctx) => /\bfrom_raw_parts(?:_mut)?\(/.test(line) && !/\bassert|\bif\b[^\n]{0,80}\blen\b|\.len\(\)\s*[<>=!]/.test(before(ctx, 10)),
  }),
  R('rsafe-from-raw-parts-mut-no-note', 'slice::from_raw_parts_mut has no SAFETY note about aliasing above it', /\bfrom_raw_parts_mut\(/, 'let s = unsafe { slice::from_raw_parts_mut(p, n) };', '// SAFETY: no other reference to this region exists.\nlet s = unsafe { slice::from_raw_parts_mut(p, n) };', {
    test: (line, ctx) => /\bfrom_raw_parts_mut\(/.test(line) && !/SAFETY|alias|no other reference/i.test(before(ctx, 3)),
  }),
  R('rsafe-static-mut', 'a static mut is declared (every access is unsafe and racy)', /^\s*(?:pub(?:\([^)]{0,20}\))?\s+)?static\s+mut\s+\w+/, 'static mut COUNTER: u32 = 0;', 'static COUNTER: AtomicU32 = AtomicU32::new(0);'),
  R('rsafe-extern-c-no-unwind-guard', 'a pub extern "C" fn has no catch_unwind, so a panic unwinds into C', /\bpub\s+(?:unsafe\s+)?extern\s+"C"\s+fn\s+\w+/, 'pub extern "C" fn add(a: i32, b: i32) -> i32 {\n    a + b\n}', 'pub extern "C" fn add(a: i32, b: i32) -> i32 {\n    std::panic::catch_unwind(|| a + b).unwrap_or(0)\n}', {
    test: (line, ctx) => /\bpub\s+(?:unsafe\s+)?extern\s+"C"\s+fn\s+\w+/.test(line) && !/catch_unwind/.test(after(ctx, 25)),
  }),
  R('rsafe-unaligned-ptr-read', 'ptr::read or ptr::write casts a byte pointer to a wider type (needs read_unaligned)', /\bptr::(?:read|write)\(\s*[^\n;]{0,120}\bas\s*\*\s*(?:const|mut)\s+(?:u16|u32|u64|i16|i32|i64|f32|f64)\b/, 'let v = ptr::read(buf.as_ptr().add(1) as *const u32);', 'let v = u32::from_le_bytes(buf[1..5].try_into().unwrap());'),
  R('rsafe-get-unchecked', 'get_unchecked skips the bounds check on an index', /\.get_unchecked(?:_mut)?\(/, 'let x = *v.get_unchecked(i);', 'let x = v.get(i).copied();'),
  R('rsafe-unwrap-unchecked', 'unwrap_unchecked turns a None or Err into undefined behaviour', /\.unwrap_unchecked\(\)/, 'let n = parsed.unwrap_unchecked();', 'let n = parsed.unwrap_or_default();'),
  R('rsafe-from-utf8-unchecked', 'from_utf8_unchecked skips UTF-8 validation', /\bfrom_utf8_unchecked\(/, 'let s = str::from_utf8_unchecked(bytes);', 'let s = str::from_utf8(bytes)?;'),
  R('rsafe-box-from-raw-no-into-raw', 'Box::from_raw is used in a file that never calls Box::into_raw (no matching owner)', /\bBox::from_raw\(/, 'let b = unsafe { Box::from_raw(p) };', 'let p = Box::into_raw(Box::new(7));\nlet b = unsafe { Box::from_raw(p) };', {
    test: (line, ctx) => /\bBox::from_raw\(/.test(line) && !/\binto_raw\(/.test(ctx.text),
  }),
  R('rsafe-union-no-repr', 'a union has no #[repr] attribute, so its layout is unspecified', /^\s*(?:pub(?:\([^)]{0,20}\))?\s+)?union\s+\w+/, 'union Bits { f: f32, u: u32 }', '#[repr(C)]\nunion Bits { f: f32, u: u32 }', {
    test: (line, ctx) => /^\s*(?:pub(?:\([^)]{0,20}\))?\s+)?union\s+\w+/.test(line) && !/repr\(/.test(before(ctx, 3)),
  }),
  R('rsafe-asm-macro', 'an inline asm! or global_asm! block is used (review the register and memory contract)', /\b(?:core::arch::|std::arch::)?(?:asm|global_asm)!\s*[([{]/, 'unsafe { asm!("nop") };', 'let n = count_nops();'),
  R('rsafe-repr-packed', 'a packed repr is used (references to its fields are undefined behaviour)', /#\[repr\([^)\n]{0,60}\bpacked\b/, '#[repr(C, packed)]\nstruct Header {\n    kind: u8,\n    len: u32,\n}', '#[repr(C)]\nstruct Header {\n    kind: u8,\n    len: u32,\n}'),
  R('rsafe-vec-set-len-no-capacity', 'Vec::set_len is called with no with_capacity or reserve above it', /\.set_len\(/, 'unsafe { v.set_len(n) };', 'let mut v = Vec::with_capacity(n);\nunsafe { v.set_len(n) };', {
    test: (line, ctx) => /\.set_len\(/.test(line) && !/with_capacity|reserve|capacity/.test(before(ctx, 10)),
  }),
  R('rsafe-alloc-no-null-check', 'alloc or alloc_zeroed result is not checked for null (no handle_alloc_error)', /(?<![\w.:])(?:alloc::)?(?:alloc|alloc_zeroed)\(\s*(?:layout|Layout::)/, 'let p = unsafe { alloc(layout) };', 'let p = unsafe { alloc(layout) };\nif p.is_null() { handle_alloc_error(layout); }', {
    test: (line, ctx) => /(?<![\w.:])(?:alloc::)?(?:alloc|alloc_zeroed)\(\s*(?:layout|Layout::)/.test(line) && !/is_null|handle_alloc_error/.test(after(ctx, 6)),
  }),
  LIBR('rsafe-env-set-var', 'env::set_var or remove_var is called (unsafe in edition 2024, racy with other threads)', /\benv::(?:set_var|remove_var)\(/, 'std::env::set_var("MODE", "fast");', 'let mode = std::env::var("MODE").unwrap_or_default();'),
  R('rsafe-allow-unsafe-code', 'the unsafe_code lint is allowed for code, or the crate allows it', /#!?\[allow\([^\]\n]{0,120}\bunsafe_code\b/, '#![allow(unsafe_code)]', '#![forbid(unsafe_code)]'),
  R('rsafe-nonnull-unchecked', 'NonNull::new_unchecked is used (undefined behaviour when the pointer is null)', /\bNonNull::new_unchecked\(/, 'let nn = unsafe { NonNull::new_unchecked(p) };', 'let nn = NonNull::new(p).expect("p is never null");'),
  R('rsafe-copy-nonoverlapping-no-note', 'ptr::copy_nonoverlapping has no note that the ranges do not overlap', /\bptr::copy_nonoverlapping\(/, 'ptr::copy_nonoverlapping(src, dst, n);', '// SAFETY: src and dst are disjoint buffers.\nptr::copy_nonoverlapping(src, dst, n);', {
    test: (line, ctx) => /\bptr::copy_nonoverlapping\(/.test(line) && !/SAFETY|disjoint|non-?overlapping|do not overlap/i.test(before(ctx, 3)),
  }),
  R('rsafe-reference-from-raw-deref', 'a reference is made from a raw pointer deref (&*p or &mut *p) that may outlive its data', /&(?:mut\s+)?\*\s*(?:raw_|self\.)?(?:ptr|raw|p)\b/, 'let r = unsafe { &mut *p };', 'let r: &u32 = &value;'),
  R('rsafe-manuallydrop-never-released', 'ManuallyDrop::new is used in a file that never drops or takes the value back', /\bManuallyDrop::new\(/, 'let g = ManuallyDrop::new(guard);', 'let g = ManuallyDrop::new(guard);\nlet inner = ManuallyDrop::into_inner(g);', {
    test: (line, ctx) => /\bManuallyDrop::new\(/.test(line) && !/ManuallyDrop::(?:drop|into_inner|take)\(/.test(ctx.text),
  }),
]

// ---------------------------------------------------------------- Errors (rp-errors)
export const ERRORS = [
  R('rerr-expect-empty-message', 'expect is called with an empty message, so a panic says nothing', /\.expect\(\s*""\s*\)/, 'let cfg = load().expect("");', 'let cfg = load().expect("config file is required");'),
  R('rerr-expect-generic-message', 'expect is called with a generic word ("failed", "error") instead of what failed', /\.expect\(\s*"(?:failed|error|oops|should work|unwrap|panic|todo|msg|unexpected)"\s*\)/i, 'let p = open().expect("failed");', 'let p = open().expect("config file opens");'),
  LIBR('rerr-panic-in-library', 'a library path calls panic!, so the caller cannot recover', /(?<![\w:])panic!\s*[([{]/, 'panic!("bad state");', 'return Err(Error::BadState);'),
  LIBR('rerr-unreachable-in-library', 'a library path calls unreachable!, which panics if the assumption is ever wrong', /(?<![\w:])unreachable!\s*[([{]/, 'unreachable!("tag {}", tag);', 'return Err(Error::UnknownTag(tag));'),
  LIBR('rerr-assert-in-library', 'a library path uses assert! (it stays in release builds and panics on bad input)', /(?<![\w:])(?:assert|assert_eq|assert_ne)!\s*\(/, 'assert!(len <= MAX);', 'if len > MAX { return Err(Error::TooLong); }'),
  R('rerr-len-narrowing-cast', 'a length is cast to a smaller integer with as, which can silently truncate', /\.(?:len|count)\(\)\s+as\s+(?:u8|u16|u32|i8|i16|i32)\b/, 'let n = items.len() as u16;', 'let n = u16::try_from(items.len())?;'),
  R('rerr-let-underscore-result', 'a Result from send, write, flush or remove is dropped with let _ =', /\blet\s+_\s*=\s*[\w.:]*\.(?:send|write|write_all|flush|sync_all|remove_file|create_dir_all|read_to_string|write_str|set_len)\(/, 'let _ = tx.send(msg);', 'tx.send(msg).map_err(|_| Error::Closed)?;'),
  R('rerr-ok-discards-error', 'a Result is turned into an Option with .ok() and the error is thrown away', /\.ok\(\);\s*(?:\/\/.*)?$/, 'remove_cache(path).ok();', 'remove_cache(path).or_else(ignore_missing)?;'),
  R('rerr-map-err-discards-source', 'map_err(|_| ...) drops the original error, so its cause is lost', /\.map_err\(\s*\|\s*_\s*\|/, 'read(path).map_err(|_| Error::Read)?;', 'read(path).map_err(|e| Error::Read(e))?;'),
  R('rerr-map-err-to-string', 'map_err turns the error into a String, which loses its type', /\.map_err\(\s*\|\s*(\w+)\s*\|\s*\1\.to_string\(\)\s*\)/, 'parse(s).map_err(|e| e.to_string())?;', 'parse(s).map_err(Error::Parse)?;'),
  LIBR('rerr-box-dyn-error-public', 'a public library function returns Box<dyn Error> (callers cannot match on it)', /\bpub\s+(?:async\s+)?fn\s+\w+[^{;\n]{0,200}->\s*(?:std::result::)?Result<[^\n]{0,200}Box<dyn\s+(?:std::error::)?Error\b/, 'pub fn load(p: &Path) -> Result<Config, Box<dyn Error>> {', 'pub fn load(p: &Path) -> Result<Config, LoadError> {'),
  LIBR('rerr-string-error-result', 'a library function returns Result with a String error', /->\s*(?:std::result::)?Result<[^\n{;]{0,120},\s*String\s*>/, 'fn parse(s: &str) -> Result<u32, String> {', 'fn parse(s: &str) -> Result<u32, ParseError> {'),
  LIBR('rerr-unit-error-type', 'a library function returns Result with the unit type () as its error', /->\s*(?:std::result::)?Result<[^\n{;]{0,120},\s*\(\s*\)\s*>/, 'fn read(&self) -> Result<Vec<u8>, ()> {', 'fn read(&self) -> Result<Vec<u8>, ReadError> {'),
  R('rerr-unwrap-or-builds-value', 'unwrap_or is given a value that is built eagerly (use unwrap_or_else or unwrap_or_default)', /\.unwrap_or\(\s*(?:[\w:]+::\w+\(|format!\(|vec!\[|\w+\.to_(?:string|owned)\(\))/, 'let s = opt.unwrap_or(String::from("none"));', 'let s = opt.unwrap_or_else(|| String::from("none"));'),
  R('rerr-error-no-display', 'an error enum has no Display impl, so it cannot be shown to a user', undefined, 'pub enum ParseError {\n    Empty,\n    Bad,\n}', 'pub enum ParseError {\n    Empty,\n}\n\nimpl std::fmt::Display for ParseError {\n    fn fmt(&self, f: &mut std::fmt::Formatter<\'_>) -> std::fmt::Result {\n        write!(f, "parse error")\n    }\n}', {
    test: (line, ctx) => /^\s*(?:pub\s+)?enum\s+\w*Error\b/.test(line) && !/impl(?:<[^>]*>)?\s+(?:std::fmt::|fmt::)?Display\s+for\b/.test(ctx.text),
  }),
  R('rerr-main-question-no-result', 'main uses ? but returns (), so an error is not reported by a non-zero exit', undefined, 'fn main() {\n    let c = read()?;\n    run(c);\n}', 'fn main() -> Result<(), Box<dyn Error>> {\n    let c = read()?;\n    Ok(())\n}', {
    files: /(^|\/)src\/main\.rs$/,
    sample: 'src/main.rs',
    test: (line, ctx) => /^\s*fn\s+main\s*\(\s*\)\s*\{/.test(line) && /\?;/.test(ctx.text) && !/->\s*(?:Result|ExitCode)/.test(ctx.text),
  }),
  LIBR('rerr-process-exit-in-library', 'a library calls process::exit, which skips every caller and every destructor', /(?<![\w:])(?:std::)?process::exit\(/, 'std::process::exit(2);', 'return Err(Error::Fatal);'),
  LIBR('rerr-catch-unwind-in-library', 'a library turns panics into values with catch_unwind (hides bugs from the caller)', /(?<![\w:])(?:std::panic::)?catch_unwind\(/, 'let r = std::panic::catch_unwind(|| work());', 'let r = work().map_err(Error::Work)?;'),
  R('rerr-lock-unwrap-poison', 'a lock is unwrapped, so one panic while it was held makes every later call panic', /\.(?:lock|read|write)\(\)\.unwrap\(\)/, 'let g = state.lock().unwrap();', 'let g = state.lock().unwrap_or_else(PoisonError::into_inner);'),
  R('rerr-parse-unwrap', 'parse().unwrap() panics on input the user typed', /\.parse(?:::<[^>\n]{1,40}>)?\(\)\.unwrap\(\)/, 'let n: u32 = arg.parse().unwrap();', 'let n: u32 = arg.parse().map_err(|_| Error::BadNumber)?;'),
  R('rerr-env-var-unwrap', 'an environment variable is read with unwrap or expect (panics when it is not set)', /\benv::var\(\s*"[^"\n]{1,80}"\s*\)\.(?:unwrap|expect)\(/, 'let home = env::var("HOME").unwrap();', 'let home = env::var("HOME").ok();'),
  LIBR('rerr-anyhow-in-library', 'a library exposes anyhow types, so callers cannot match its errors', /\banyhow::(?:Result|Error|anyhow|bail|ensure)\b/, 'pub fn load() -> anyhow::Result<Config> {', 'pub fn load() -> Result<Config, LoadError> {'),
  R('rerr-match-err-swallowed', 'an Err arm is matched with _ and an empty body, so the error disappears', /\bErr\(\s*_\s*\)\s*=>\s*(?:\{\s*\}|\(\))/, 'match read() { Ok(v) => v, Err(_) => {} }', 'match read() { Ok(v) => v, Err(e) => return Err(e.into()) }'),
  R('rerr-unwrap-in-drop', 'a Drop impl calls unwrap or expect, so a panic can happen during unwinding', /^\s*impl(?:<[^>]*>)?\s+Drop\s+for\b/, 'impl Drop for Conn {\n    fn drop(&mut self) {\n        self.flush().unwrap();\n    }\n}', 'impl Drop for Conn {\n    fn drop(&mut self) {\n        let _ = self.close();\n    }\n}', {
    test: (line, ctx) => /^\s*impl(?:<[^>]*>)?\s+Drop\s+for\b/.test(line) && /\.(?:unwrap|expect)\(/.test(after(ctx, 12)),
  }),
]

// ---------------------------------------------------------------- Async (rp-async)
export const ASYNC = [
  R('rasync-blocking-thread-sleep', 'thread::sleep is called inside an async fn, which blocks the whole runtime thread', /\bthread::sleep\(/, 'async fn poll() {\n    std::thread::sleep(Duration::from_secs(1));\n}', 'async fn poll() {\n    tokio::time::sleep(Duration::from_secs(1)).await;\n}', {
    test: (line, ctx) => /\bthread::sleep\(/.test(line) && inAsyncFn(ctx),
  }),
  R('rasync-blocking-fs', 'a blocking std::fs call runs inside an async fn', /(?<![\w:])(?:std::)?fs::(?:read|read_to_string|write|create_dir_all|remove_file|copy|rename|metadata|read_dir)\(/, 'async fn load() -> String {\n    std::fs::read_to_string("a.txt").unwrap()\n}', 'async fn load() -> String {\n    tokio::fs::read_to_string("a.txt").await.unwrap_or_default()\n}', {
    test: (line, ctx) => /(?<![\w:])(?:std::)?fs::(?:read|read_to_string|write|create_dir_all|remove_file|copy|rename|metadata|read_dir)\(/.test(line) && inAsyncFn(ctx),
  }),
  R('rasync-blocking-net', 'a blocking std::net connect or bind runs inside an async fn', /(?<![\w:])(?:std::)?net::(?:TcpStream|TcpListener|UdpSocket)::(?:connect|bind)\(/, 'async fn ping() {\n    let s = std::net::TcpStream::connect("10.0.0.1:80");\n}', 'async fn ping() {\n    let s = tokio::net::TcpStream::connect("10.0.0.1:80").await;\n}', {
    test: (line, ctx) => /(?<![\w:])(?:std::)?net::(?:TcpStream|TcpListener|UdpSocket)::(?:connect|bind)\(/.test(line) && inAsyncFn(ctx),
  }),
  R('rasync-reqwest-blocking', 'the reqwest blocking client is used, which blocks the calling thread', /\breqwest::blocking\b/, 'let body = reqwest::blocking::get(url)?.text()?;', 'let body = reqwest::get(url).await?.text().await?;'),
  R('rasync-std-mutex-across-await', 'a std Mutex guard is held across an .await in an async fn', /\blet\s+(?:mut\s+)?\w+\s*=\s*[\w.]+\.lock\(\)\.unwrap\(\);/, 'async fn save(&self) {\n    let g = self.state.lock().unwrap();\n    self.disk.write(&g).await;\n}', 'fn snapshot(&self) -> State {\n    let g = self.state.lock().unwrap();\n    g.clone()\n}\n\nasync fn save(&self) {\n    let s = self.snapshot();\n    self.disk.write(&s).await;\n}', {
    test: (line, ctx) => /\blet\s+(?:mut\s+)?\w+\s*=\s*[\w.]+\.lock\(\)\.unwrap\(\);/.test(line) && inAsyncFn(ctx) && /\.await\b/.test(after(ctx, 12)) && !/\bdrop\(/.test(after(ctx, 12)),
  }),
  R('rasync-spawn-handle-dropped', 'tokio::spawn is called as a statement, so its JoinHandle and its errors are dropped', /^\s*(?:tokio::)?(?:task::)?spawn\(/, 'tokio::spawn(run_worker(rx));', 'let worker = tokio::spawn(run_worker(rx));'),
  R('rasync-spawn-blocking-awaits', 'spawn_blocking contains an .await, which cannot run on a blocking thread', /\bspawn_blocking\(/, 'let v = tokio::task::spawn_blocking(move || {\n    cache.lock().await.get(k)\n});', 'let v = tokio::task::spawn_blocking(move || compute(k)).await?;', {
    test: (line, ctx) => /\bspawn_blocking\(/.test(line) && /\.await\b/.test(after(ctx, 8)),
  }),
  R('rasync-block-on-in-async', 'block_on is called inside an async fn (it nests runtimes and can deadlock)', /\bblock_on\(/, 'async fn fetch() {\n    let x = futures::executor::block_on(load());\n}', 'async fn fetch() {\n    let x = load().await;\n}', {
    test: (line, ctx) => /\bblock_on\(/.test(line) && inAsyncFn(ctx),
  }),
  R('rasync-pub-trait-async-no-send', 'a public trait has async fn with no Send bound or trait_variant note (futures may not be Send)', /^\s*(?:pub(?:\([^)]{0,20}\))?\s+)?async\s+fn\s+\w+/, 'pub trait Store {\n    async fn get(&self, k: &str) -> Option<String>;\n}', '#[trait_variant::make(Send)]\npub trait Store {\n    async fn get(&self, k: &str) -> Option<String>;\n}', {
    test: (line, ctx) => /^\s*(?:pub(?:\([^)]{0,20}\))?\s+)?async\s+fn\s+\w+/.test(line) && inPubTrait(ctx) && !/\bSend\b|trait_variant/.test(ctx.text),
  }),
  R('rasync-select-no-cancel-note', 'tokio::select! has no note that its branches are cancel safe', /\b(?:tokio::)?select!\s*\{/, 'tokio::select! {\n    msg = rx.recv() => handle(msg),\n    _ = stop.changed() => break,\n}', '// cancel-safe: recv() is cancel safe, so dropping the other branch loses nothing\ntokio::select! {\n    msg = rx.recv() => handle(msg),\n    _ = stop.changed() => break,\n}', {
    test: (line, ctx) => /\b(?:tokio::)?select!\s*\{/.test(line) && !/cancel/i.test(before(ctx, 6)),
  }),
  R('rasync-unbounded-channel', 'an unbounded channel is created, so a slow consumer lets memory grow without limit', /\bunbounded_channel\(|\bchannel::unbounded\(|\bcrossbeam(?:_channel)?::unbounded\(/, 'let (tx, rx) = tokio::sync::mpsc::unbounded_channel();', 'let (tx, rx) = tokio::sync::mpsc::channel(256);'),
  R('rasync-zero-sleep-busy-loop', 'sleep is given a zero duration, so a loop spins and uses a whole core', /\bsleep\(\s*(?:Duration::ZERO|Duration::from_(?:millis|micros|nanos|secs)\(0\))\s*\)/, 'loop {\n    tokio::time::sleep(Duration::from_millis(0)).await;\n}', 'loop {\n    tokio::time::sleep(Duration::from_millis(50)).await;\n}'),
  R('rasync-std-mpsc-in-async-file', 'a std mpsc channel is used in a file that has async code (its recv blocks)', /\bstd::sync::mpsc::|\bsync::mpsc::(?:channel|sync_channel)\(/, 'use std::sync::mpsc;\n\nasync fn run() {\n    let (tx, rx) = std::sync::mpsc::channel();\n}', 'use tokio::sync::mpsc;\n\nasync fn run() {\n    let (tx, rx) = mpsc::channel(8);\n}', {
    test: (line, ctx) => /\bstd::sync::mpsc::|\bsync::mpsc::(?:channel|sync_channel)\(/.test(line) && /\basync\s+fn\b/.test(ctx.text),
  }),
  R('rasync-future-call-discarded', 'an async fn is called with let _ = and never awaited (the future does nothing)', undefined, 'async fn flush() {}\n\nfn run() {\n    let _ = flush();\n}', 'async fn flush() {}\n\nasync fn run() {\n    let _ = flush().await;\n}', {
    test: (line, ctx) => {
      const m = /^\s*let\s+_\s*=\s*(\w+)\(/.exec(line)
      return !!m && !/\.await\b/.test(line) && new RegExp(`\\basync\\s+fn\\s+${m[1]}\\b`).test(ctx.text)
    },
  }),
  LIBR('rasync-main-in-library', 'a library defines a #[tokio::main] entry point, which takes over its callers runtime', /#\[(?:tokio|async_std)::main\]/, '#[tokio::main]\nasync fn serve() {}', 'pub async fn serve() {}'),
  R('rasync-thread-spawn-discarded', 'thread::spawn is called as a statement, so the thread is never joined', /^\s*(?:std::)?thread::spawn\(/, 'thread::spawn(move || worker(rx));', 'let h = thread::spawn(move || worker(rx));'),
  R('rasync-global-mutable-state', 'a global lazy lock holds mutable state shared by every caller (review the scope)', /\bstatic\s+\w+\s*:\s*(?:Lazy|LazyLock|OnceLock|once_cell::sync::Lazy)<\s*(?:std::sync::)?(?:Mutex|RwLock)</, 'static CACHE: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));', 'static LIMIT: u32 = 64;'),
  R('rasync-reqwest-no-timeout', 'a reqwest client is built with no timeout, so a stalled server hangs the caller forever', /\breqwest::Client::new\(\)|\bClient::builder\(\)\.build\(\)/, 'let http = reqwest::Client::new();', 'let http = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?;', {
    test: (line, ctx) => /\breqwest::Client::new\(\)|\bClient::builder\(\)\.build\(\)/.test(line) && /\breqwest\b/.test(ctx.text) && !/timeout/.test(ctx.text),
  }),
  R('rasync-runtime-built-per-call', 'a tokio runtime is built where it is used (build it once and share it; informational)', /\bRuntime::new\(\)|\bBuilder::new_(?:multi|current)_thread\(\)/, 'fn handle(req: Req) -> Resp {\n    let rt = tokio::runtime::Runtime::new().unwrap();\n    rt.block_on(run(req))\n}', 'static RUNTIME: OnceLock<Runtime> = OnceLock::new();', { severity: 'info' }),
  R('rasync-std-command-in-async', 'std::process::Command runs inside an async fn, so it blocks the runtime thread', /(?<![\w:])(?:std::process::|process::)?Command::new\(/, 'async fn version() -> String {\n    let out = std::process::Command::new("git").arg("-V").output().unwrap();\n}', 'async fn version() -> String {\n    let out = tokio::process::Command::new("git").arg("-V").output().await;\n}', {
    test: (line, ctx) => /(?<![\w:])(?:std::process::|process::)?Command::new\(/.test(line) && inAsyncFn(ctx) && !/tokio::process/.test(ctx.text),
  }),
  R('rasync-blocking-lock-in-async', 'a tokio blocking_* call runs inside an async fn, which panics at runtime', /\.blocking_(?:lock|send|recv)\(\)/, 'async fn put(&self, v: u32) {\n    self.slot.blocking_lock().push(v);\n}', 'async fn put(&self, v: u32) {\n    self.slot.lock().await.push(v);\n}', {
    test: (line, ctx) => /\.blocking_(?:lock|send|recv)\(\)/.test(line) && inAsyncFn(ctx),
  }),
  R('rasync-sync-recv-in-async', 'a recv() with no .await runs inside an async fn (a std receiver blocks the thread)', /\b\w+\.recv\(\)/, 'async fn drain(rx: Receiver<u32>) {\n    while let Ok(v) = rx.recv() {\n        sink(v);\n    }\n}', 'async fn drain(mut rx: Receiver<u32>) {\n    while let Some(v) = rx.recv().await {\n        sink(v);\n    }\n}', {
    test: (line, ctx) => /\b\w+\.recv\(\)/.test(line) && !/\.await\b/.test(line) && inAsyncFn(ctx),
  }),
  R('rasync-stdin-read-in-async', 'stdin is read with the blocking std API inside an async fn', /\bstdin\(\)\.(?:read_line|read_to_string|lines)\(/, 'async fn prompt() -> String {\n    let mut s = String::new();\n    std::io::stdin().read_line(&mut s).unwrap();\n    s\n}', 'async fn prompt() -> String {\n    let mut line = String::new();\n    BufReader::new(tokio::io::stdin()).read_line(&mut line).await.ok();\n    line\n}', {
    test: (line, ctx) => /\bstdin\(\)\.(?:read_line|read_to_string|lines)\(/.test(line) && inAsyncFn(ctx),
  }),
]

// ---------------------------------------------------------------- Performance and style (rp-perf-style)
export const PERF_STYLE = [
  R('rperf-len-compare-zero', 'len() is compared with 0 (use is_empty, which states the intent)', /\.len\(\)\s*(?:==\s*0\b|!=\s*0\b|>\s*0\b)/, 'if items.len() == 0 {', 'if items.is_empty() {'),
  R('rperf-format-to-string-arg', 'format!("{}", x.to_string()) allocates twice (use the value directly)', /\bformat!\(\s*"\{\}"\s*,\s*[\w.]+\.to_string\(\)\s*\)/, 'let s = format!("{}", name.to_string());', 'let s = name.to_string();'),
  R('rperf-format-no-args', 'format! has no arguments (use String::from or to_owned)', /\bformat!\(\s*"[^"{}\n]{0,200}"\s*\)/, 'let s = format!("ready");', 'let s = String::from("ready");'),
  R('rperf-push-str-format', 'push_str(&format!(..)) allocates a temporary String (write! into the buffer instead)', /\.push_str\(\s*&format!\(/, 'out.push_str(&format!("{}={}", k, v));', 'write!(out, "{}={}", k, v)?;'),
  R('rperf-collect-then-iterate', 'a collect into a Vec is iterated straight away (the collect is not needed)', /\.collect::<Vec<[^>\n]{0,80}>>\(\)\s*\.(?:iter|into_iter)\(\)/, 'let total: u32 = xs.iter().map(f).collect::<Vec<_>>().into_iter().sum();', 'let total: u32 = xs.iter().map(f).sum();'),
  R('rperf-iter-count', 'iter().count() walks the whole collection (len() is O(1) when it exists)', /\.iter(?:_mut)?\(\)\.count\(\)/, 'let n = items.iter().count();', 'let n = items.len();'),
  R('rperf-nth-zero', 'nth(0) is written instead of next()', /\.nth\(\s*0\s*\)/, 'let first = lines.nth(0);', 'let first = lines.next();'),
  R('rperf-map-identity', 'map(|x| x) does nothing (remove the map)', /\.map\(\s*\|\s*(\w+)\s*\|\s*\1\s*\)/, 'let v: Vec<u8> = raw.iter().map(|b| b).copied().collect();', 'let v: Vec<u8> = raw.iter().copied().collect();'),
  R('rperf-bool-eq-literal', 'a bool is compared with == true or == false', /[=!]=\s*(?:true|false)\b/, 'if ready == true {', 'if ready {'),
  R('rperf-index-range-loop', 'a loop indexes a vector by position over 0..len (iterate the items instead)', undefined, 'for i in 0..v.len() {\n    total += v[i];\n}', 'for x in v.iter() {\n    total += x;\n}', {
    test: (line, ctx) => {
      const m = /^\s*for\s+(\w+)\s+in\s+0\.\.(\w+)\.len\(\)/.exec(line)
      return !!m && new RegExp(`\\b${m[2]}\\[${m[1]}\\]`).test(after(ctx, 6))
    },
  }),
  R('rperf-ref-vec-or-string-param', 'a function takes &Vec or &String (take &[T] or &str, which accept more)', /\bfn\s+\w+[^{;\n]{0,200}:\s*&(?!mut\b)(?:Vec<|String\b)/, 'fn total(items: &Vec<u32>) -> u32 {', 'fn total(items: &[u32]) -> u32 {'),
  R('rperf-box-vec', 'Box<Vec<T>> adds a pointer hop for no gain (a Vec already owns the heap buffer)', /\bBox<Vec</, 'struct Store { items: Box<Vec<u8>> }', 'struct Store { items: Vec<u8> }'),
  R('rperf-option-option', 'Option<Option<T>> is written (flatten it or use a clearer type)', /\bOption<\s*Option</, 'fn peek(&self) -> Option<Option<u8>>', 'fn peek(&self) -> Option<u8>'),
  R('rperf-sort-float-partial-unwrap', 'floats are sorted with partial_cmp().unwrap(), which panics on NaN (total_cmp does not)', /\.partial_cmp\([^)\n]{0,80}\)\.unwrap\(\)/, 'scores.sort_by(|a, b| a.partial_cmp(b).unwrap());', 'scores.sort_by(|a, b| a.total_cmp(b));'),
  R('rperf-unwrap-or-new-container', 'unwrap_or(Vec::new()) builds the default every time (use unwrap_or_default)', /\.unwrap_or\(\s*(?:Vec|String|HashMap|BTreeMap|HashSet|BTreeSet)::new\(\)\s*\)/, 'let tags = map.get(k).cloned().unwrap_or(Vec::new());', 'let tags = map.get(k).cloned().unwrap_or_default();'),
  R('rperf-regex-compiled-per-call', 'Regex::new runs inside a function, so the pattern is compiled on every call', /\bRegex::new\(/, 'fn is_slug(s: &str) -> bool {\n    let re = Regex::new(r"^[a-z-]+$").unwrap();\n    re.is_match(s)\n}', 'static SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z-]+$").unwrap());', {
    test: T(/\bRegex::new\(/, (c) => !inTestBlock(c) && !/LazyLock|Lazy::new|OnceLock|OnceCell|lazy_static|Lazy</.test(before(c, 3) + '\n' + c.lines[c.index])),
  }),
  R('rperf-println-in-library', 'a library prints to stdout or stderr (the caller cannot silence or capture it)', /(?<![\w:])(?:e?println|e?print)!\s*\(/, 'println!("loaded {} items", n);', 'log::info!("loaded {} items", n);', {
    files: LIB,
    sample: 'src/lib.rs',
    test: T(/(?<![\w:])(?:e?println|e?print)!\s*\(/, (c) => !inTestBlock(c)),
  }),
  R('rperf-dbg-left-in', 'dbg! is left in the code (it prints to stderr in every build)', /(?<![\w:])dbg!\s*\(/, 'let n = dbg!(parse(s));', 'let n = parse(s);', {
    test: T(/(?<![\w:])dbg!\s*\(/, (c) => !inTestBlock(c)),
  }),
  R('rperf-allow-clippy-group', 'a whole clippy group is allowed for a file or crate (allow one lint, with a reason)', /#!?\[allow\([^\]\n]{0,120}clippy::(?:all|pedantic|nursery|correctness|restriction|perf|style|complexity)\b/, '#![allow(clippy::all)]', '#[allow(clippy::too_many_arguments)]'),
  R('rperf-allow-dead-code-crate', 'dead_code is allowed for the whole crate, which hides unused code', /^#!\[allow\([^\]\n]{0,120}\bdead_code\b/, '#![allow(dead_code)]', '#[allow(dead_code)]\nfn scaffold() {}'),
  R('rperf-clone-twice', 'clone() is called twice in a row (the second one copies the first copy)', /\.clone\(\)\s*\.clone\(\)/, 'let copy = name.clone().clone();', 'let copy = name.clone();'),
  R('rperf-to-vec-only-for-len', 'a vector is copied only to take its length', /\.to_vec\(\)\.len\(\)|\.collect::<Vec<[^>\n]{0,60}>>\(\)\.len\(\)/, 'let n = bytes.to_vec().len();', 'let n = bytes.len();'),
  R('rperf-is-some-then-unwrap', 'if x.is_some() is followed by x.unwrap() (use if let Some)', undefined, 'if cfg.is_some() {\n    run(cfg.unwrap());\n}', 'if let Some(c) = cfg {\n    run(c);\n}', {
    test: (line, ctx) => {
      const m = /^\s*if\s+(\w+)\.is_some\(\)/.exec(line)
      return !!m && new RegExp(`\\b${m[1]}\\.unwrap\\(\\)`).test(after(ctx, 3))
    },
  }),
  R('rperf-match-bool-literals', 'a match on a bool with true and false arms (use if else)', /\btrue\s*=>\s*[^,\n]{1,120},\s*false\s*=>/, 'let s = match ok { true => "yes", false => "no" };', 'let s = if ok { "yes" } else { "no" };'),
  R('rperf-vec-new-in-loop', 'a Vec is created with Vec::new inside a loop that pushes into it (size it once, or hoist it)', undefined, 'for row in rows {\n    let mut cells = Vec::new();\n    cells.push(row.a);\n}', 'let mut cells = Vec::with_capacity(rows.len());\nfor row in rows {\n    cells.push(row.a);\n}', {
    test: (line, ctx) => /let\s+mut\s+\w+\s*(?::\s*Vec<[^>\n]{0,60}>)?\s*=\s*Vec::new\(\)\s*;/.test(line) && /\bfor\b/.test(before(ctx, 2)) && !/with_capacity/.test(line),
  }),
]

// ---------------------------------------------------------------- Cargo and build configuration (rp-cargo)
// Each rule reads one manifest or config file. The package rules look at the [package] table (tomlBody), not the whole file.
// A crate with publish = false never goes to crates.io, so it needs no description or license of its own; fields inherited with key.workspace = true count as set.
const NOT_PUBLISHED = /^\s*publish\s*=\s*false/m
const PKG = (test) => (line, ctx) => PKG_HEADER.test(line) && test(ctx)
export const CARGO_RULES = [
  CARGO_R('rcargo-missing-description', 'the package has no description (crates.io and search show nothing)', PKG((c) => !/^\s*description(?:\.workspace)?\s*=/m.test(tomlBody(c.text, 'package')) && !NOT_PUBLISHED.test(tomlBody(c.text, 'package'))),
    '[package]\nname = "parser"\nversion = "0.1.0"\nedition = "2021"\nlicense = "MIT"', '[package]\nname = "parser"\nversion = "0.1.0"\nedition = "2021"\nlicense = "MIT"\ndescription = "Parses config files."'),
  CARGO_R('rcargo-missing-license', 'the package has no license or license-file', PKG((c) => !/^\s*(?:license|license-file)(?:\.workspace)?\s*=/m.test(tomlBody(c.text, 'package')) && !NOT_PUBLISHED.test(tomlBody(c.text, 'package'))),
    '[package]\nname = "parser"\nversion = "0.1.0"\nedition = "2021"', '[package]\nname = "parser"\nversion = "0.1.0"\nedition = "2021"\nlicense = "MIT"'),
  CARGO_R('rcargo-missing-edition', 'the package sets no edition, so it builds with the oldest edition', PKG((c) => !/^\s*edition(?:\.workspace)?\s*=/m.test(tomlBody(c.text, 'package'))),
    '[package]\nname = "parser"\nversion = "0.1.0"', '[package]\nname = "parser"\nversion = "0.1.0"\nedition = "2021"'),
  CARGO_R('rcargo-edition-old', 'the crate uses edition 2015 or 2018 (2021 or later has better defaults)', reT(/^\s*edition\s*=\s*"(?:2015|2018)"/), 'edition = "2018"', 'edition = "2021"'),
  CARGO_R('rcargo-wildcard-version', 'a dependency has version "*", so any release can be pulled in', reT(/^\s*[\w-]+\s*=\s*"\*"|\bversion\s*=\s*"\*"/), 'serde = "*"', 'serde = "1.0"'),
  CARGO_R('rcargo-path-dep-publishable', 'a path dependency with no version in a crate that is not publish = false (crates.io rejects it)', (line, ctx) =>
    /\{[^}\n]{0,200}\bpath\s*=\s*"/.test(line) && !/\bversion\s*=/.test(line) && tomlTable(ctx) === 'dependencies' && !/^\s*publish\s*=\s*false/m.test(ctx.text),
    '[package]\nname = "a"\n\n[dependencies]\nhelper = { path = "../helper" }', '[package]\nname = "a"\npublish = false\n\n[dependencies]\nhelper = { path = "../helper" }'),
  CARGO_R('rcargo-git-dep-unpinned', 'a git dependency has no rev or tag, so its code can change under the lock', (line) =>
    /^\s*[\w-]+\s*=\s*\{[^}\n]{0,200}\bgit\s*=\s*"/.test(line) && !/\b(?:rev|tag)\s*=/.test(line),
    'widget = { git = "https://github.com/acme/widget" }', 'widget = { git = "https://github.com/acme/widget", rev = "3f2a9c1" }'),
  CARGO_R('rcargo-test-crate-in-deps', 'a test-only crate is listed under [dependencies] (it ships to every user)', (line, ctx) =>
    /^\s*(?:mockall|criterion|proptest|tempfile|pretty_assertions|insta|rstest)\s*=/.test(line) && tomlTable(ctx) === 'dependencies',
    '[dependencies]\ntempfile = "3"', '[dev-dependencies]\ntempfile = "3"'),
  CARGO_R('rcargo-profile-release-debug', 'the release profile keeps debug info (larger binaries, can leak paths)', (line, ctx) =>
    /^\s*debug\s*=\s*(?:true|[12]|"(?:full|line-tables-only)")/.test(line) && tomlTable(ctx) === 'profile.release',
    '[profile.release]\ndebug = true', '[profile.release]\ndebug = false'),
  CARGO_R('rcargo-profile-release-opt-zero', 'the release profile uses opt-level 0 (an unoptimised release build)', (line, ctx) =>
    /^\s*opt-level\s*=\s*0\s*$/.test(line) && tomlTable(ctx) === 'profile.release',
    '[profile.release]\nopt-level = 0', '[profile.release]\nopt-level = 3'),
  CARGO_R('rcargo-profile-release-overflow-off', 'the release profile turns off overflow checks (wrapping arithmetic silently)', (line, ctx) =>
    /^\s*overflow-checks\s*=\s*false/.test(line) && tomlTable(ctx) === 'profile.release',
    '[profile.release]\noverflow-checks = false', '[profile.release]\noverflow-checks = true'),
  CARGO_R('rcargo-no-lockfile-binary', 'a binary crate has no Cargo.lock, so builds are not reproducible', PKG(() => true),
    '[package]\nname = "tool"\nedition = "2021"', '[workspace]\nmembers = []', {
      needs: (files) => files.some((f) => /(^|\/)src\/main\.rs$/.test(f)) && !files.some((f) => /(^|\/)Cargo\.lock$/.test(f)),
    }),
  {
    id: 'rcargo-toolchain-unpinned',
    title: 'the toolchain follows nightly, beta or stable without a version (builds drift)',
    files: TOOLCHAIN,
    sample: 'rust-toolchain.toml',
    skipLine: TOML_SKIP,
    test: reT(/^\s*channel\s*=\s*"(?:stable|beta|nightly)"\s*$/),
    bad: 'channel = "nightly"',
    good: 'channel = "1.82.0"',
  },
  CARGO_R('rcargo-workspace-no-resolver', 'a workspace root sets no resolver (2 or 3 is needed for the modern feature resolver)', (line, ctx) =>
    /^\s*\[workspace\]\s*$/.test(line) && !/^\s*resolver\s*=/m.test(tomlBody(ctx.text, 'workspace')),
    '[workspace]\nmembers = ["a", "b"]', '[workspace]\nresolver = "2"\nmembers = ["a", "b"]'),
  {
    id: 'rcargo-build-rs-network',
    title: 'a build script reaches the network or runs curl or wget (builds need the network and stop being reproducible)',
    files: BUILD_RS,
    sample: 'build.rs',
    skipLine: SLASH_SKIP,
    test: reT(/\b(?:reqwest|ureq|isahc|hyper)::|\bCommand::new\(\s*"(?:curl|wget)"\)|\bTcpStream::connect\(/),
    bad: 'let body = ureq::get(url).call()?;',
    good: 'println!("cargo:rerun-if-changed=src/schema.json");',
  },
  {
    id: 'rcargo-build-rs-url-literal',
    title: 'a build script names a web address, so it probably downloads something at build time',
    files: BUILD_RS,
    sample: 'build.rs',
    skipLine: SLASH_SKIP,
    re: /"https?:\/\/[^"\s]{3,}"/,
    bad: 'const SRC: &str = "https://example.com/schema.json";',
    good: 'const SRC: &str = "schema/schema.json";',
  },
  CARGO_R('rcargo-build-dependency-network', 'a build-dependency is a network crate (it runs at every build)', (line, ctx) =>
    /^\s*(?:reqwest|ureq|isahc|hyper)\s*=/.test(line) && tomlTable(ctx) === 'build-dependencies',
    '[build-dependencies]\nureq = "2"', '[build-dependencies]\ncc = "1"'),
  DENY_R('rcargo-deny-allows-any-licence', 'cargo-deny accepts every licence (allow = ["*"])', /^\s*allow\s*=\s*\[\s*"\*"/, 'allow = ["*"]', 'allow = ["MIT", "Apache-2.0"]'),
  DENY_R('rcargo-deny-unknown-registry-allowed', 'cargo-deny allows crates from unknown registries', /^\s*unknown-registry\s*=\s*"allow"/, 'unknown-registry = "allow"', 'unknown-registry = "deny"'),
  DENY_R('rcargo-deny-unknown-git-allowed', 'cargo-deny allows git sources that are not on the allow list', /^\s*unknown-git\s*=\s*"allow"/, 'unknown-git = "allow"', 'unknown-git = "deny"'),
  DENY_R('rcargo-deny-wildcards-allowed', 'cargo-deny allows wildcard version requirements', /^\s*wildcards\s*=\s*"allow"/, 'wildcards = "allow"', 'wildcards = "deny"'),
  CONF_R('rcargo-config-revocation-check-off', 'cargo is told not to check certificate revocation for downloads', /\bcheck-revoke\s*=\s*false\b/, '[http]\ncheck-revoke = false', '[http]\ncheck-revoke = true'),
  CONF_R('rcargo-config-weak-tls', 'cargo allows TLS 1.0 or 1.1 for downloads', /\bssl-version\b[^\n]{0,80}\btlsv1(?:\.[01])?(?![.\w])/, '[http]\nssl-version = "tlsv1.0"', '[http]\nssl-version = { min = "tlsv1.2" }'),
  CONF_R('rcargo-config-machine-path', 'the cargo config names a machine-specific absolute path (it breaks on every other machine)', /^\s*(?:linker|target-dir|runner|rustflags)\b[^\n]{0,120}["'](?:[A-Za-z]:[\\/]|\/(?:home|Users|opt|root|usr)\/)/, 'linker = "C:/Users/dev/tools/lld.exe"', 'linker = "clang"'),
  CONF_R('rcargo-config-native-cpu', 'the committed cargo config builds for this machine CPU (target-cpu=native)', /target-cpu\s*=\s*native\b/, 'rustflags = ["-C", "target-cpu=native"]', 'rustflags = ["-C", "target-cpu=x86-64-v2"]'),
  CARGO_R('rcargo-openssl-dependency', 'a crate depends on openssl, which needs a system library (rustls is pure Rust; informational)', (line, ctx) =>
    /^\s*openssl\s*=/.test(line) && tomlTable(ctx) === 'dependencies',
    '[dependencies]\nopenssl = "0.10"', '[dependencies]\nrustls = "0.23"', { severity: 'info' }),
]

// ---------------------------------------------------------------- API, FFI, WebAssembly and serde (rp-api-ffi-wasm)
const PUB_FN = /^\s*pub\s+(?:async\s+|const\s+|unsafe\s+)*fn\s+\w+/
const PUB_TYPE = /^\s*pub\s+(?:struct|enum|trait)\s+(\w+)/
const SECRET_FIELD = /^\s*pub\s+(?:password|passwd|secret|token|api_key|private_key|access_token|refresh_token|client_secret)\s*:/
export const API_FFI_WASM = [
  LIBR('rapi-missing-docs-lint', 'the library has public items but no #![deny(missing_docs)] or #![warn(missing_docs)]', undefined, 'pub fn parse(s: &str) -> u32 {\n    0\n}', '#![deny(missing_docs)]\n\n/// Parses.\npub fn parse(s: &str) -> u32 {\n    0\n}', undefined, {
    sample: 'src/lib.rs',
    test: (line, ctx) => ctx.index === 0 && /^\s*pub\s+(?:fn|struct|enum|trait|mod|const|static|type)\b/m.test(ctx.text) && !/missing_docs/.test(ctx.text),
  }),
  LIBR('rapi-pub-fn-undocumented', 'a public function has no /// doc comment above it', PUB_FN, 'pub fn parse(s: &str) -> u32 {\n    0\n}', '/// Parses a number.\npub fn parse(s: &str) -> u32 {\n    0\n}', (c) => !hasDocAbove(c)),
  LIBR('rapi-pub-type-undocumented', 'a public struct, enum or trait has no /// doc comment above it', PUB_TYPE, 'pub struct Config {\n    pub depth: u8,\n}', '/// Settings.\npub struct Config {\n    pub depth: u8,\n}', (c) => !hasDocAbove(c)),
  LIBR('rapi-missing-debug-derive', 'a public type does not derive or implement Debug (it cannot be printed in a log or a test failure)', PUB_TYPE, '/// Settings.\npub struct Config {\n    pub depth: u8,\n}', '/// Settings.\n#[derive(Debug, Clone)]\npub struct Config {\n    pub depth: u8,\n}', (c) => {
    const name = PUB_TYPE.exec(c.lines[c.index])?.[1] ?? ''
    return !/\bDebug\b/.test(before(c, 4)) && !new RegExp(`impl(?:<[^>]*>)?\\s+(?:std::fmt::|fmt::)?Debug\\s+for\\s+${name}\\b`).test(c.text)
  }),
  LIBR('rapi-glob-reexport', 'a glob re-export (pub use x::*) exposes whatever the module adds later', /^\s*pub\s+use\s+[\w:]+::\*\s*;/, 'pub use parser::*;', 'pub use parser::{parse, Config};'),
  LIBR('rapi-ffi-fn-no-mangle', 'a pub extern "C" fn has no #[no_mangle], so C code cannot find it by name', /^\s*pub\s+(?:unsafe\s+)?extern\s+"C"\s+fn\s+\w+/, 'pub extern "C" fn tk_init() -> i32 {\n    0\n}', '#[no_mangle]\npub extern "C" fn tk_init() -> i32 {\n    0\n}', (c) => !/no_mangle/.test(before(c, 3))),
  R('rapi-cstr-from-ptr-unchecked', 'CStr::from_ptr is called with no null check above it', /\bCStr::from_ptr\(/, 'let name = unsafe { CStr::from_ptr(p) };', 'if p.is_null() {\n    return -1;\n}\nlet name = unsafe { CStr::from_ptr(p) };', {
    test: (line, ctx) => /\bCStr::from_ptr\(/.test(line) && !/is_null/.test(before(ctx, 5)),
  }),
  R('rapi-cstring-unwrap', 'CString::new(..).unwrap() panics when the text holds a nul byte', /\bCString::new\([^\n]{0,200}\)\s*\.(?:unwrap|expect)\(/, 'let c = CString::new(name).unwrap();', 'let c = CString::new(name).map_err(|_| -1)?;'),
  R('rapi-ffi-struct-no-repr-c', 'a struct in a file with C ABI functions has no #[repr(C)] (its layout is not the C layout)', undefined, 'pub extern "C" fn size() -> i32 {\n    0\n}\n\npub struct Point {\n    pub x: i32,\n}', '#[repr(C)]\npub struct Point {\n    pub x: i32,\n}\n\npub extern "C" fn size() -> i32 {\n    0\n}', {
    test: (line, ctx) => /^\s*pub\s+struct\s+\w+/.test(line) && /extern\s+"C"/.test(ctx.text) && !/repr\(\s*C\b/.test(before(ctx, 3)),
  }),
  R('rapi-wasm-inner-html-format', 'set_inner_html is given HTML built with format! (an injection sink)', /\.set_inner_html\(\s*&?format!\(|\binnerHTML\s*=\s*format!\(/, 'el.set_inner_html(&format!("<b>{}</b>", name));', 'el.set_text_content(Some(&name));'),
  R('rapi-wasm-html-sink', 'HTML is written into the page (set_outer_html or insert_adjacent_html); check the input is escaped', /\.(?:set_inner_html|set_outer_html|insert_adjacent_html)\(/, 'el.set_outer_html(&html);', 'el.set_text_content(Some(&html));'),
  R('rapi-js-eval', 'JavaScript source is evaluated from Rust (js_sys::eval or Function::new_*_args)', /\bjs_sys::eval\(|\bFunction::new_(?:no|with)_args\(/, 'let v = js_sys::eval(&code)?;', 'let v = JsValue::from_str(&code);'),
  R('rapi-wasm-unchecked-cast', 'a JS value is cast without a type check (unchecked_into or unchecked_ref)', /\.unchecked_(?:into|ref)\b/, 'let el = value.unchecked_into::<HtmlElement>();', 'let el = value.dyn_into::<HtmlElement>()?;'),
  LIBR('rapi-wasm-no-panic-hook', 'a wasm_bindgen crate sets no panic hook, so Rust panics show as an unhelpful JS error', undefined, '#[wasm_bindgen]\npub fn run() {}', '#[wasm_bindgen(start)]\npub fn start() {\n    console_error_panic_hook::set_once();\n}', undefined, {
    test: (line, ctx) => ctx.index === 0 && /#\[wasm_bindgen/.test(ctx.text) && !/set_panic_hook|console_error_panic_hook/.test(ctx.text),
  }),
  R('rapi-serde-json-unwrap', 'serde_json parses external input with unwrap or expect (a bad document panics)', /\bserde_json::from_(?:str|slice|reader|value)\b[^\n]{0,200}\)\s*\.(?:unwrap|expect)\(/, 'let cfg: Cfg = serde_json::from_str(body).unwrap();', 'let cfg: Cfg = serde_json::from_str(body)?;'),
  R('rapi-secret-field-serialized', 'a secret field is Serialize with no skip_serializing (it is written into responses and logs)', undefined, '#[derive(Serialize)]\npub struct Login {\n    pub user: String,\n    pub password: String,\n}', '#[derive(Serialize)]\npub struct Login {\n    pub user: String,\n    #[serde(skip_serializing)]\n    pub password: String,\n}', {
    test: (line, ctx) => SECRET_FIELD.test(line) && /\bSerialize\b/.test(ctx.text) && !/skip_serializing/.test(before(ctx, 3)),
  }),
  R('rapi-debug-secret-field', 'a secret field sits in a type that derives Debug with no skip (secrets end up in logs)', undefined, '#[derive(Debug)]\npub struct Session {\n    pub token: String,\n}', '#[derive(Debug)]\npub struct Session {\n    #[debug(skip)]\n    pub token: String,\n}', {
    test: (line, ctx) => SECRET_FIELD.test(line) && /derive\([^)\n]{0,120}\bDebug\b/.test(ctx.text) && !/skip|redact/i.test(before(ctx, 3)),
  }),
  R('rapi-serde-untagged', 'serde untagged enums guess the variant from the shape of the data (ambiguous input is accepted)', /#\[serde\([^\]\n]{0,120}\buntagged\b/, '#[serde(untagged)]\npub enum Value {', '#[serde(tag = "kind")]\npub enum Value {'),
  R('rapi-extern-block-no-link', 'an extern "C" block has no #[link] attribute (informational: which library provides it?)', /^\s*extern\s+"C"\s*\{/, 'extern "C" {\n    fn strlen(s: *const c_char) -> usize;\n}', '#[link(name = "z")]\nextern "C" {\n    fn zlibVersion() -> *const c_char;\n}', {
    severity: 'info',
    test: (line, ctx) => /^\s*extern\s+"C"\s*\{/.test(line) && !/#\[link\(/.test(before(ctx, 3)),
  }),
]

// The check name -> its rule table. A table with no matching files in a project reports NA for each rule (see thorough/rust-plus.mjs).
export const CHECK_TABLES = {
  'rp-safety': SAFETY,
  'rp-errors': ERRORS,
  'rp-async': ASYNC,
  'rp-perf-style': PERF_STYLE,
  'rp-cargo': CARGO_RULES,
  'rp-api-ffi-wasm': API_FFI_WASM,
}
