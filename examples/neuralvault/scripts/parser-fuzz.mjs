// for NV_FUZZ_SECONDS (default 60).
//
// Method chosen: a time-boxed LOOP of the `proptests` module with a high PROPTEST_CASES.
// Why not cargo-fuzz: libFuzzer needs nightly Rust and ASan; on Windows MSVC that path is
// not supported in practice, and WSL has no distro installed on this machine (checked 2026-10-27).
// Each round draws fresh random inputs, so rounds add coverage. Fails on the first failing round.
// Counter-check: a round that runs 0 tests is a FAIL (a missing proptests module is not a pass).
import { run, say, fail, pass, notRun, hasFlag, repoRoot, findBin, cargoCmd } from '../../../thorough/lib.mjs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath as fileUrlToPath } from 'node:url';
const fixturesDir = resolvePath(dirname(fileUrlToPath(import.meta.url)), '../fixtures');
import path from 'node:path';

const seconds = Number(process.env.NV_FUZZ_SECONDS || 60);
const cases = process.env.PROPTEST_CASES || '20000';
const selfTest = hasFlag('--fixtures');
const deadline = Date.now() + seconds * 1000;
let rounds = 0;

function judge(r) {
  if (r.timedOut) return 'a round hit the hard timeout';
  if (r.code !== 0) return `proptests failed (exit ${r.code}); the shrunk case is printed above`;
  // Other test binaries (integration targets, doc tests) legitimately run 0 tests; only the lib's proptests count.
  if (!/test result: ok\. [1-9]\d* passed/.test(r.out)) return 'no proptests ran: the `proptests` module in nv-vault is missing or filtered out';
  return null;
}

let cmd, args, env = { PROPTEST_CASES: cases }, cwd = repoRoot;
if (selfTest) {
  // Deliberately broken: a "test run" that reports a failing property.
  cmd = process.execPath; args = [path.join('parser-fuzz/crashing-run.mjs')];
} else {
  if (!findBin('cargo')) notRun('cargo not found');
  ({ cmd, args } = cargoCmd(['test', '-p', 'nv-vault', '--lib', 'proptests', '--', '--nocapture']));
  env.CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR || path.join(repoRoot, '..', 'nv-shared-target');
}

say(`parser-fuzz: ${seconds}s budget, PROPTEST_CASES=${cases}${selfTest ? ' (self-test fixture)' : ''}`);
do {
  rounds++;
  const left = Math.max(60_000, deadline - Date.now() + 120_000); // first round may compile
  const r = await run({ cmd, args, cwd, env, timeoutMs: left, label: `fuzz round ${rounds}`, quiet: !selfTest && rounds > 1 });
  if (r.code === 75 && !selfTest) notRun('cargo lock wait limit hit (exit 75), try again when the build lane is free');
  const bad = judge(r);
  if (bad) fail(`${bad} (round ${rounds})`);
} while (Date.now() < deadline);
pass(`${rounds} round(s) of ${cases} cases each, no crash or property failure in ${seconds}s`);
