// Shared by tools/gen-checks.mjs, tools/gen-coverage.mjs and tools/make-badges.mjs: where a generated file goes.
//   normal mode     the file is written, as before
//   --check         nothing is written. Each file is compared with what is on disk (line endings ignored); a difference or a missing
//                   file is reported as "<file> is out of date; run node <script> to fix" and finish() returns 1.
// A generator that crashes in --check mode exits 2, so the release gate can tell "a document drifted" (1) from "the generator cannot run".
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const lf = (t) => String(t).replace(/\r\n/g, '\n')

export function createSink(argv, { script, log = console.log } = {}) {
  const check = argv.includes('--check')
  const drifted = []
  if (check) {
    const crash = (e) => { console.error(`${script ?? 'generator'} --check could not run: ${e?.stack ?? e}`); process.exit(2) }
    process.on('uncaughtException', crash)
    process.on('unhandledRejection', crash)
  }
  return {
    check,
    write(file, text, label = file) {
      if (!check) return writeFileSync(file, text)
      if (!existsSync(file) || lf(readFileSync(file, 'utf8')) !== lf(text)) drifted.push(label)
    },
    // Prints one line per drifted file and returns the exit code: 0 current (or not in check mode), 1 drifted.
    finish() {
      for (const f of drifted) log(`${f} is out of date; run node ${script} to fix`)
      return drifted.length ? 1 : 0
    },
  }
}
