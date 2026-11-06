// Real-code false cases for pedantic rust-plus rules: each fixture is a line shape taken from real code that a review judged wrongly flagged.
// Every case asserts the rule stays quiet on it, and that the rule's own bad sample (the planted defect) still fires.
import { beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { evaluate } from '../thorough/rules.mjs'
// @ts-expect-error plain JS module
import { CHECK_TABLES } from '../thorough/rules-rust-plus.mjs'

const ALL: any[] = Object.values(CHECK_TABLES).flat() as any[]
beforeAll(() => {
  process.env.MEERKAT_FINDINGS = 'all'
})

// Lines (1-based) where the rule fires on the text, as the engine would report them.
function hits(id: string, text: string, file = 'src/lib.rs'): number[] {
  const rule = ALL.find((r) => r.id === id)
  if (!rule) throw new Error(`no rule ${id}`)
  const r = evaluate('.', [rule], { files: [file], read: () => text })
  return r.hits.map((h: any) => h.line)
}
const quiet = (id: string, text: string, file?: string) => expect(hits(id, text, file)).toEqual([])
const fires = (id: string, text: string, file?: string) => expect(hits(id, text, file).length).toBeGreaterThan(0)
const bad = (id: string) => ALL.find((r) => r.id === id).bad as string

describe('rasync-spawn-blocking-awaits', () => {
  const id = 'rasync-spawn-blocking-awaits'
  test('the .await after the closure is the correct use', () => {
    quiet(id, 'async fn body(x: u32) -> String {\n    let s = tokio::task::spawn_blocking(move || {\n        pages::note_body(x)\n    })\n    .await\n    .unwrap_or_default();\n    s\n}\n')
    quiet(id, 'async fn body(x: u32) -> String {\n    tokio::task::spawn_blocking(move || pages::note_body(x)).await.unwrap_or_default()\n}\n')
  })
  test('an .await inside the closure is still flagged', () => {
    fires(id, bad(id))
  })
})

describe('rasync-sync-recv-in-async', () => {
  const id = 'rasync-sync-recv-in-async'
  test('a recv branch of select! is awaited', () => {
    quiet(id, 'async fn run(&mut self) {\n    tokio::select! {\n        l = self.lines.recv(), if !self.eof => {\n            handle(l);\n        }\n        _ = stop.changed() => {}\n    }\n}\n')
  })
  test('a bare recv in an async fn is still flagged', () => fires(id, bad(id)))
})

describe('rperf-bool-eq-literal', () => {
  const id = 'rperf-bool-eq-literal'
  test('a serde_json value indexed then compared has no ! form', () => {
    quiet(id, 'fn f(next: &serde_json::Value) -> bool {\n    if next["flagged"] == false {\n        return true;\n    }\n    next["ok"] != true\n}\n')
  })
  test('a plain bool is still flagged', () => fires(id, bad(id)))
})

describe('rperf-len-compare-zero', () => {
  const id = 'rperf-len-compare-zero'
  test('Metadata::len has no is_empty', () => {
    quiet(id, 'fn f(p: &Path) -> bool {\n    let meta = std::fs::metadata(p).unwrap();\n    meta.len() > 0\n}\n')
    quiet(id, 'fn g(p: &Path) -> bool {\n    p.metadata().map(|m| m.len() > 0).unwrap_or(false)\n}\n')
    quiet(id, 'fn h(p: &Path) -> bool {\n    fs::metadata(p).map_or(false, |m| m.len() == 0)\n}\n')
  })
  test('a collection is still flagged', () => fires(id, bad(id)))
})

describe('rperf-index-range-loop', () => {
  const id = 'rperf-index-range-loop'
  test('an index used for a slice range is needed', () => {
    quiet(id, 'fn f(candidates: &mut Vec<String>) {\n    for i in 0..candidates.len() {\n        let seen = &candidates[..i];\n        if seen.contains(&candidates[i]) {\n            candidates[i] = String::new();\n        }\n    }\n}\n')
  })
  test('an element mutated by index is needed', () => {
    quiet(id, 'fn f(v: &mut Vec<u32>) {\n    for i in 0..v.len() {\n        v[i] += 1;\n    }\n}\n')
  })
  test('a read-only index loop is still flagged', () => fires(id, bad(id)))
})

describe('rperf-vec-new-in-loop', () => {
  const id = 'rperf-vec-new-in-loop'
  test('a Vec declared after a loop, above the next for, is not in the loop', () => {
    quiet(id, 'fn f(rows: &[Row], hs: Vec<H>) {\n    for h in hs { h.join().ok(); }\n    let mut cells = Vec::new();\n    for row in rows {\n        cells.push(row.a);\n    }\n}\n')
  })
  test('a Vec inside the loop body is still flagged', () => {
    fires(id, bad(id))
    fires(id, 'fn f(rows: &[Row]) {\n    for row in rows {\n        if row.ok {\n            let mut cells = Vec::new();\n            cells.push(row.a);\n        }\n    }\n}\n')
  })
})

describe('rerr-error-no-display', () => {
  const id = 'rerr-error-no-display'
  test('derive(Error) generates Display', () => {
    quiet(id, '#[derive(Error, Debug)]\npub enum NvError {\n    #[error("io failed")]\n    Io,\n}\n')
    quiet(id, '#[derive(Debug, thiserror::Error)]\npub enum NvError {\n    #[error("io failed")]\n    Io,\n}\n')
  })
  test('a bare enum is still flagged', () => fires(id, bad(id)))
})

describe('rerr-let-underscore-result', () => {
  const id = 'rerr-let-underscore-result'
  test('a channel send whose receiver may be gone is normal', () => {
    quiet(id, 'fn f(tx: Sender<Event>, event: Event) {\n    let _ = tx.send(event);\n    let _ = self.events_tx.send(Msg::Done);\n    let _ = reply.send(Ok(()));\n}\n')
  })
  test('other discarded Results are still flagged', () => {
    fires(id, bad(id))
    fires(id, 'fn f(file: &mut File, buf: &[u8]) {\n    let _ = file.write_all(buf);\n}\n')
    fires(id, 'fn f(out: &mut Out) {\n    let _ = out.flush();\n}\n')
  })
})

describe('rasync-spawn-handle-dropped and rasync-thread-spawn-discarded', () => {
  test('a spawn that owns a channel receiver reports through it', () => {
    quiet('rasync-spawn-handle-dropped', 'fn start(mut rx: Receiver<Tick>) {\n    tokio::spawn(async move {\n        while let Some(t) = rx.recv().await {\n            beat(t).await;\n        }\n    });\n}\n')
    quiet('rasync-spawn-handle-dropped', 'fn start(tx: Sender<Tick>) {\n    tokio::spawn(async move {\n        let _ = tx.send(Tick).await;\n    });\n}\n')
    quiet('rasync-thread-spawn-discarded', 'fn start(rx: Receiver<Job>) {\n    thread::spawn(move || {\n        for job in rx {\n            job.run();\n        }\n    });\n}\n')
    quiet('rasync-thread-spawn-discarded', 'fn start(tx: Sender<Job>) {\n    std::thread::spawn(move || {\n        tx.send(Job::new()).ok();\n    });\n}\n')
  })
  test('a thread that is only handed the receiver as an argument is still flagged', () => {
    fires('rasync-thread-spawn-discarded', 'fn begin(session_id: String, paths: Paths) -> Result<(), Error> {\n    let (tx, rx) = mpsc::channel::<DictationMsg>();\n    register_session(&session_id, tx)?;\n\n    std::thread::spawn(move || run_session(session_id, rx, paths));\n\n    Ok(())\n}\n')
  })
  test('a plain fire-and-forget spawn is still flagged', () => {
    fires('rasync-spawn-handle-dropped', bad('rasync-spawn-handle-dropped'))
    fires('rasync-thread-spawn-discarded', bad('rasync-thread-spawn-discarded'))
    fires('rasync-spawn-handle-dropped', 'fn f() {\n    tokio::spawn(async move {\n        cleanup().await;\n    });\n}\n')
  })
})

describe('rasync-runtime-built-per-call', () => {
  const id = 'rasync-runtime-built-per-call'
  test('a one-time CLI entry point builds its runtime once', () => {
    quiet(id, 'fn main() {\n    let rt = tokio::runtime::Runtime::new().unwrap();\n    rt.block_on(run());\n}\n')
    quiet(id, 'pub fn run_cli(args: Args) -> i32 {\n    let rt = tokio::runtime::Builder::new_multi_thread().build().unwrap();\n    rt.block_on(go(args))\n}\n')
  })
  test('a per-request runtime is still flagged', () => fires(id, bad(id)))
})

describe('rerr-unreachable-in-library and rerr-panic-in-library', () => {
  test('a dispatch invariant handled above is not a library hazard', () => {
    quiet('rerr-unreachable-in-library', 'fn dispatch(a: Action) {\n    match a {\n        Action::Help => unreachable!("handled above"),\n        Action::Run => run(),\n    }\n}\n')
    quiet('rerr-unreachable-in-library', 'fn dispatch(a: Action) {\n    match a {\n        Action::Help => unreachable!("help is already printed"),\n    }\n}\n')
    quiet('rerr-panic-in-library', 'fn dispatch(a: Action) {\n    match a {\n        Action::Help => panic!("handled above"),\n    }\n}\n')
  })
  test('other unreachable and panic calls are still flagged', () => {
    fires('rerr-unreachable-in-library', bad('rerr-unreachable-in-library'))
    fires('rerr-panic-in-library', bad('rerr-panic-in-library'))
  })
})

describe('rerr-assert-in-library', () => {
  const id = 'rerr-assert-in-library'
  test('assert in a const fn is a compile-time check', () => {
    quiet(id, 'pub const fn new(n: usize) -> Self {\n    assert!(n > 0, "n must be positive");\n    Self(n)\n}\n')
    quiet(id, 'const _: () = assert!(SIZE > 0);\n')
  })
  test('assert in a normal fn is still flagged', () => fires(id, bad(id)))
})

describe('rerr-match-err-swallowed', () => {
  const id = 'rerr-match-err-swallowed'
  test('an Err arm in an exists/is_/try_ function means absence', () => {
    quiet(id, 'fn try_remove(p: &Path) {\n    match fs::remove_file(p) {\n        Ok(()) => {}\n        Err(_) => {}\n    }\n}\n')
    quiet(id, 'fn exists(p: &Path) -> bool {\n    match fs::metadata(p) {\n        Ok(_) => true,\n        Err(_) => false,\n    }\n}\n')
    quiet(id, 'pub fn is_ready(p: &Path) {\n    match probe(p) {\n        Ok(_) => mark(),\n        Err(_) => (),\n    }\n}\n')
  })
  test('another swallowed Err is still flagged', () => {
    fires(id, bad(id))
    fires(id, 'fn load(p: &Path) {\n    match read(p) {\n        Ok(v) => use_it(v),\n        Err(_) => {}\n    }\n}\n')
  })
})

describe('rerr-unwrap-or-builds-value', () => {
  const id = 'rerr-unwrap-or-builds-value'
  test('a constant or path literal allocates nothing', () => {
    quiet(id, 'fn f(p: &Path) -> &Path {\n    p.parent().unwrap_or(Path::new(""))\n}\n')
    quiet(id, 'fn g(o: Option<Duration>) -> Duration {\n    o.unwrap_or(Duration::from_secs(5))\n}\n')
    quiet(id, 'fn h(o: Option<Kind>) -> Kind {\n    o.unwrap_or(Kind::Plain(3))\n}\n')
  })
  test('an eagerly built String is still flagged', () => fires(id, bad(id)))
  test('a variant that carries a built String is still flagged', () => {
    fires(id, 'pub fn status() -> Value {\n    let phase = phase_slot()\n        .lock()\n        .map(|p| p.clone())\n        .unwrap_or(Phase::Failed(\n            "the fleet status lock was poisoned by a panic on the fleet thread".to_string(),\n        ));\n    json!(phase)\n}\n')
  })
})

describe('rperf-regex-compiled-per-call', () => {
  const id = 'rperf-regex-compiled-per-call'
  test('a pattern compiled once inside get_or_init is cached', () => {
    quiet(id, "fn slug_re() -> &'static Regex {\n    static RE: OnceLock<Regex> = OnceLock::new();\n    RE.get_or_init(|| {\n        // compile once\n        let pat = r\"^[a-z-]+$\";\n        Regex::new(pat).unwrap()\n    })\n}\n")
  })
  test('a function named cached is a cache', () => {
    quiet(id, 'fn cached_regex(p: &str) -> Regex {\n    let re = Regex::new(p).unwrap();\n    re\n}\n')
  })
  test('a literal inside a LazyLock is compiled once', () => {
    quiet(id, 'static SLUG: LazyLock<Regex> = LazyLock::new(|| {\n    Regex::new(\n        r"^[a-z-]+$",\n    )\n    .unwrap()\n});\n')
  })
  test('a per-call compile is still flagged', () => fires(id, bad(id)))
})

describe('rapi-missing-debug-derive', () => {
  const id = 'rapi-missing-debug-derive'
  test('Debug does not apply to a trait', () => {
    quiet(id, '/// A store.\npub trait Store {\n    fn get(&self);\n}\n')
  })
  test('a struct is still flagged', () => fires(id, bad(id)))
})

describe('rerr-string-error-result', () => {
  const id = 'rerr-string-error-result'
  test('a tauri command needs a String error', () => {
    quiet(id, '#[tauri::command]\npub async fn read_note(id: u32) -> Result<String, String> {\n    Ok(String::new())\n}\n')
    quiet(id, '#[tauri::command]\npub fn save(\n    state: State<App>,\n    id: u32,\n) -> Result<(), String> {\n    Ok(())\n}\n')
  })
  test('a plain function is still flagged', () => fires(id, bad(id)))
})
