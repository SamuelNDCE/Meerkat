// Real-code false alarms from benchmarks/real-rust/labels.json (labelled FALSE): each line shape must stay quiet, and the rule's own bad sample must still fire.
import { beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { evaluate } from '../thorough/rules.mjs'
// @ts-expect-error plain JS module
import { CHECK_TABLES } from '../thorough/rules-rust-plus.mjs'

const ALL: any[] = Object.values(CHECK_TABLES).flat() as any[]
beforeAll(() => {
  process.env.MEERKAT_FINDINGS = 'all'
})
function hits(id: string, text: string, file = 'src/lib.rs', others: Record<string, string> = {}): number[] {
  const rule = ALL.find((r) => r.id === id)
  const store: Record<string, string> = { ...others, [file]: text }
  const r = evaluate('.', [rule], { files: Object.keys(store), read: (f: string) => store[f] ?? '' })
  return r.hits.filter((h: any) => h.file === undefined || h.file === file).map((h: any) => h.line)
}
const quiet = (id: string, text: string, file?: string, others?: Record<string, string>) => expect(hits(id, text, file, others)).toEqual([])
const fires = (id: string, text: string, file?: string, others?: Record<string, string>) => expect(hits(id, text, file, others).length).toBeGreaterThan(0)
const bad = (id: string) => ALL.find((r) => r.id === id).bad as string
const BIN = { 'apps/nv-cli/src/main.rs': 'fn main() {}\n' }
const BINF = 'apps/nv-cli/src/exec.rs'

describe('library-only rules skip binary crates', () => {
  test.each([
    ['rperf-println-in-library', 'fn f() {\n    println!("{}", help_text());\n}\n'],
    ['rerr-process-exit-in-library', 'fn f() {\n    std::process::exit(EXIT_BROKEN_PIPE);\n}\n'],
    ['rerr-panic-in-library', 'fn f() {\n    panic!("bad");\n}\n'],
    ['rerr-unreachable-in-library', 'fn f(v: u8) {\n    match v { _ => unreachable!("verb is always ls or dismiss") }\n}\n'],
    ['rerr-assert-in-library', 'fn f(a: u8) {\n    assert!(a > 1);\n}\n'],
    ['rerr-catch-unwind-in-library', 'fn f() {\n    let r = std::panic::catch_unwind(|| work());\n}\n'],
    ['rerr-anyhow-in-library', 'fn f() -> anyhow::Result<()> {\n    Ok(())\n}\n'],
  ])('%s', (id, text) => {
    quiet(id, text, BINF, BIN)
    fires(id, text, 'packages/x/src/util.rs', { 'packages/x/src/lib.rs': '' })
    fires(id, bad(id))
  })
})
describe('narrowed shapes', () => {
  test('catch_unwind with AssertUnwindSafe is a deliberate boundary', () => {
    quiet('rerr-catch-unwind-in-library', 'fn f() {\n    let c = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work()));\n}\n')
  })
  test('panic in unwrap_or_else is an expect for a built-in pattern', () => {
    quiet('rerr-panic-in-library', 'fn b(p: &str) -> Regex {\n    RegexBuilder::new(p)\n        .build()\n        .unwrap_or_else(|e| panic!("bad regex {p:?}: {e}"))\n}\n')
  })
  test('map_err on channel and parse errors', () => {
    const id = 'rerr-map-err-discards-source'
    quiet(id, 'fn f() {\n    cmd_tx\n        .send(RuntimeCommand::Go)\n        .map_err(|_| runtime_unavailable())?;\n}\n')
    quiet(id, 'fn f() {\n    let x = rx.await.map_err(|_| runtime_unavailable())?;\n}\n')
    quiet(id, 'fn f() {\n    let ip = s.parse().map_err(|_| format!("not an ip"))?;\n}\n')
    quiet(id, 'fn f() {\n    String::from_utf8(bytes).map_err(|_| bad())\n}\n')
    fires(id, bad(id))
    fires(id, 'fn f() {\n    let t = std::fs::read_to_string(p).map_err(|_| Error::Read)?;\n}\n')
  })
  test('ok() kept in a binding', () => {
    const id = 'rerr-ok-discards-error'
    quiet(id, 'fn f() {\n    let base = std::fs::read_to_string(p).ok();\n}\n')
    fires(id, bad(id))
  })
  test('Err(_) arms that are explained', () => {
    const id = 'rerr-match-err-swallowed'
    quiet(id, 'fn f() {\n    match x {\n        Ok(Now::Dir) | Err(_) => {}\n    }\n}\n')
    quiet(id, 'fn f() {\n    match &out {\n        Err(e) if transient(e) => {\n            seen();\n        }\n        Err(_) => {}\n    }\n}\n')
    fires(id, bad(id))
  })
  test('Regex::new with a run-time pattern', () => {
    const id = 'rperf-regex-compiled-per-call'
    quiet(id, 'fn re(pattern: &str) -> Regex {\n    Regex::new(pattern).expect("ok")\n}\n')
    quiet(id, 'fn f(pattern: &str) {\n    match Regex::new(&regex::escape(pattern)) {\n        _ => {}\n    }\n}\n')
    fires(id, bad(id))
  })
  test('runtime built at a command entry point', () => {
    const id = 'rasync-runtime-built-per-call'
    quiet(id, 'pub fn execute(args: A) -> i32 {\n    let rt = match tokio::runtime::Runtime::new() {\n        Ok(rt) => rt,\n    };\n}\n')
    fires(id, bad(id))
  })
  test('String error only on a public fn', () => {
    const id = 'rerr-string-error-result'
    quiet(id, 'fn image_rest(a: &str) -> Result<Completion, String> {\n    todo()\n}\n')
    quiet(id, 'fn run(\n    complete: &mut dyn FnMut(&[M]) -> Result<Completion, String>,\n) {\n}\n')
    fires(id, bad(id))
    fires(id, 'pub fn f(\n    a: u8,\n) -> Result<(), String> {\n}\n')
  })
  test('ephemeral port bind, accept loop spawn, select recv, main thread', () => {
    quiet('rasync-blocking-net', 'async fn f() {\n    let probe = std::net::TcpListener::bind("127.0.0.1:0")?;\n}\n')
    quiet('rasync-spawn-handle-dropped', 'async fn serve(l: L) {\n    loop {\n        match l.accept().await {\n            Ok((s, _)) => {\n                tokio::spawn(serve_connection(s));\n            }\n        }\n    }\n}\n')
    quiet('rasync-sync-recv-in-async', 'async fn f(&mut self) {\n    tokio::select! {\n        Some(()) = self.interrupts.recv() => {\n        }\n    }\n}\n')
    quiet('rasync-thread-spawn-discarded', 'fn main() {\n    std::thread::spawn(|| {\n        ping();\n    });\n}\n')
  })
  test('index used as a value, metadata len, literal len', () => {
    quiet('rperf-index-range-loop', 'fn f(bytes: &[u8]) {\n    for j in 0..bytes.len() {\n        if bytes[j] == 1 && (j == 0 || bytes[j - 1] != 2) {\n            end = j;\n        }\n    }\n}\n')
    fires('rperf-index-range-loop', bad('rperf-index-range-loop'))
    quiet('rperf-len-compare-zero', 'fn f() {\n    match std::fs::metadata(out_path) {\n        Ok(m) if m.len() > 0 => ok(),\n        _ => no(),\n    }\n}\n')
    quiet('rerr-len-narrowing-cast', 'fn f() {\n    let n = Some("Half way there.".len() as u32);\n}\n')
    fires('rerr-len-narrowing-cast', bad('rerr-len-narrowing-cast'))
  })
  test('Vec in test code or returned as the block value', () => {
    const id = 'rperf-vec-new-in-loop'
    quiet(id, 'fn f() {\n    for x in xs {\n        match x {\n            A => {\n                let mut v = Vec::new();\n                v.push(1);\n                v\n            }\n        }\n    }\n}\n')
    quiet(id, '#[cfg(test)]\nmod tests {\n    fn t() {\n        for x in xs {\n            let mut buf = Vec::new();\n            buf.push(1);\n        }\n    }\n}\n')
    fires(id, bad(id))
  })
  test('cfg(test) items and nested test modules are test code', () => {
    quiet('rerr-assert-in-library', '#[cfg(test)]\nfn refuse(p: &Path) {\n    assert!(p.starts_with(&s), "x");\n}\n')
    quiet('rerr-assert-in-library', 'fn f() {\n    #[cfg(test)]\n    {\n        assert!(a, "x");\n    }\n}\n')
    quiet('rerr-assert-in-library', 'fn t() {\n    assert_eq!(a, b, "m");\n}\n', 'src/outer/retry_tests/p.rs', { 'src/outer/retry_tests.rs': 'mod p;\n', 'src/outer.rs': '#[cfg(test)]\nmod retry_tests;\n', 'src/lib.rs': 'mod outer;\n' })
  })
})
