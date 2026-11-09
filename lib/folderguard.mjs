// One plain sentence when a folder a command was pointed at is not a folder it can work in, else null.
import { statSync } from 'node:fs'

export function folderProblem(path) {
  let st
  try {
    st = statSync(path)
  } catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return `${path} does not exist; pass the project folder, or run Meerkat from inside it`
    return `${path} cannot be read (${e?.code ?? 'error'}); check its permissions`
  }
  return st.isDirectory() ? null : `${path} is a file, not a folder; pass the project folder, or run Meerkat from inside it`
}
