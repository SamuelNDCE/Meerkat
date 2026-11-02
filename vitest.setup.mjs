// Runs in every test worker. Meerkat's tests build hundreds of small projects and start thousands of processes; antivirus scans every one. Two things keep that
// polite: the work is done at below-normal priority, and every temp project goes under ONE folder (<temp>/meerkat-tests) so a contributor can exclude that single
// folder from real-time scanning if they want to. Child processes inherit both (TEMP and TMP, and the priority).
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lowerPriority } from './lib/priority.mjs'

if (!process.env.MEERKAT_TEST_TMP_SET) {
  const root = join(tmpdir(), 'meerkat-tests')
  try {
    mkdirSync(root, { recursive: true })
    process.env.TEMP = process.env.TMP = process.env.TMPDIR = root
    process.env.MEERKAT_TEST_TMP_SET = '1'
  } catch {
    /* keep the normal temp folder */
  }
}
lowerPriority(process.env)
