// Runs in every test worker. Meerkat's tests build hundreds of small projects and start thousands of processes; antivirus scans every one. Two things keep that
// polite: the work is done at below-normal priority, and every temp project goes under ONE folder (<temp>/meerkat-tests-<user>) so a contributor can exclude that single
// folder from real-time scanning if they want to. Child processes inherit both (TEMP and TMP, and the priority).
// The folder is private to the user (mode 700) and must be a real directory that the user owns; on a shared machine anything else keeps the normal temp folder.
import { lstatSync, mkdirSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { lowerPriority } from './lib/priority.mjs'

function privateTestTemp() {
  let user = 'user'
  try { user = String(userInfo().username).replace(/[^A-Za-z0-9._-]/g, '_') || 'user' } catch { /* no user name: use the generic one */ }
  const root = join(tmpdir(), `meerkat-tests-${user}`)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const st = lstatSync(root)
  if (!st.isDirectory() || st.isSymbolicLink()) return null
  if (typeof process.getuid === 'function' && (st.uid !== process.getuid() || (st.mode & 0o022) !== 0)) return null
  return root
}

if (!process.env.MEERKAT_TEST_TMP_SET) {
  try {
    const root = privateTestTemp()
    if (root) {
      process.env.TEMP = process.env.TMP = process.env.TMPDIR = root
      process.env.MEERKAT_TEST_TMP_SET = '1'
    }
  } catch {
    /* keep the normal temp folder */
  }
}
lowerPriority(process.env)
