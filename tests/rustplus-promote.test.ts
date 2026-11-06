// Real-code false alarms found while promoting the rust-plus rules to the default run (benchmarks/real-rust/labels.json, labelled FALSE):
// each shape must stay quiet, and the labelled TRUE shape of the same rule must still fire.
import { beforeAll, describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module
import { evaluate } from '../thorough/rules.mjs'
// @ts-expect-error plain JS module
import { CHECK_TABLES } from '../thorough/rules-rust-plus.mjs'

const ALL: any[] = Object.values(CHECK_TABLES).flat() as any[]
beforeAll(() => {
  process.env.MEERKAT_FINDINGS = 'all'
})
// `listed` limits the project listing (the engine leaves *_tests.rs files out of it); read still reaches every file.
function hits(id: string, text: string, file = 'src/lib.rs', others: Record<string, string> = {}, listed?: string[]): number[] {
  const rule = ALL.find((r) => r.id === id)
  const store: Record<string, string> = { ...others, [file]: text }
  const r = evaluate('.', [rule], { files: listed ?? Object.keys(store), read: (f: string) => store[f] ?? '' })
  return r.hits.filter((h: any) => h.file === file).map((h: any) => h.line)
}
const quiet = (id: string, text: string, file?: string, others?: Record<string, string>, listed?: string[]) => expect(hits(id, text, file, others, listed)).toEqual([])
const fires = (id: string, text: string, file?: string, others?: Record<string, string>) => expect(hits(id, text, file, others).length).toBeGreaterThan(0)
const bad = (id: string) => ALL.find((r) => r.id === id).bad as string

describe('rules promoted after narrowing', () => {
  test('rerr-assert-in-library: a module declared under cfg(test) by a parent the listing leaves out', () => {
    const file = 'src/outer/model_failover/retry_tests/policy_switch.rs'
    const others = {
      'src/outer/model_failover/retry_tests.rs': 'mod policy_switch;\n',
      'src/outer/model_failover.rs': '#[cfg(test)]\nmod retry_tests;\n',
      'src/lib.rs': '',
    }
    quiet('rerr-assert-in-library', 'fn t() {\n    assert_eq!(a, b, "m");\n}\n', file, others, [file, 'src/lib.rs', 'src/outer/model_failover.rs'])
    fires('rerr-assert-in-library', bad('rerr-assert-in-library'))
  })
  test('rerr-ok-discards-error: a let binding after comment lines keeps the Option on purpose', () => {
    const id = 'rerr-ok-discards-error'
    quiet(id, 'fn f() {\n    // Re-stat after the load, not before.\n    // A second line of the explanation;\n    // and a third.\n    let m = std::fs::metadata(p).and_then(|m| m.modified()).ok();\n}\n')
    fires(id, 'fn f() {\n    // note\n    remove_cache(path).ok();\n}\n')
    fires(id, bad(id))
  })
  test('rerr-anyhow-in-library: anyhow only builds the message of an existing Other variant', () => {
    const id = 'rerr-anyhow-in-library'
    quiet(id, 'fn f() -> Result<u8, NvError> {\n    Err(NvError::Other(anyhow::anyhow!("no free name")))\n}\n')
    quiet(id, 'fn f(e: E) -> NvError {\n    match e { _ => NvError::Other(anyhow::anyhow!("{e}")) }\n}\n')
    fires(id, '#[derive(Error)]\nenum NvError {\n    #[error(transparent)]\n    Other(#[from] anyhow::Error),\n}\n')
    fires(id, bad(id))
  })
  test('rerr-match-err-swallowed: a symlink_metadata probe means not there', () => {
    const id = 'rerr-match-err-swallowed'
    quiet(id, 'fn f() {\n    match std::fs::symlink_metadata(&abs) {\n        Ok(m) => keep(m),\n        Err(_) => {}\n    }\n}\n')
    fires(id, bad(id))
  })
  test('rasync-thread-spawn-discarded: a thread that resets its own running flag', () => {
    const id = 'rasync-thread-spawn-discarded'
    quiet(id, 'fn start() {\n    std::thread::spawn(move || {\n        run(&owned);\n        RUNNING.store(false, Ordering::SeqCst);\n    });\n}\n')
    fires(id, 'fn start() {\n    COPY.cancel.store(false, Ordering::SeqCst);\n    std::thread::spawn(move || {\n        copy_now(&root);\n    });\n}\n')
    fires(id, bad(id))
  })
  test('rperf-vec-new-in-loop: a Vec moved into a struct or enum value built in the loop', () => {
    const id = 'rperf-vec-new-in-loop'
    quiet(id, 'fn f() {\n    for l in ls {\n        let mut body = Vec::new();\n        body.push(1);\n        blocks.push(CodeBlock { lang, lines: body });\n    }\n}\n')
    quiet(id, 'fn f() {\n    for e in es {\n        let mut dirs = Vec::new();\n        dirs.push(1);\n        let op = Op::Remove { dirs };\n    }\n}\n')
    quiet(id, 'fn f() {\n    for e in es {\n        let mut owns: Vec<String> = Vec::new();\n        owns.push(p);\n        agents.push(PlanAgent {\n            n,\n            owns,\n            reads,\n        });\n    }\n}\n')
    fires(id, 'fn f() {\n    for e in es {\n        let mut path: Vec<usize> = Vec::new();\n        path.push(1);\n        use_it(&path);\n    }\n}\n')
    fires(id, bad(id))
  })
})
