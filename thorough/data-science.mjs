// Data science checks: Jupyter notebooks, ML projects and data files. Run through the data-science pack, or by hand:
//   node thorough/data-science.mjs <check> [--root <dir>]      node thorough/data-science.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "data": maxNotebookKb (default 500), maxDataMb (default 25), maxEmbeddedImageKb (default 100),
// requireSeeds and requireDatasetNotes (default false: those two print information and still pass). A finding you accept goes in
// .meerkat-data-allow as "<check-id> <path>", one per line.
// What these checks cannot see: they read tracked files only, match text patterns rather than parsing Python, and cannot follow a variable
// to find out what a pickle path really points at. A notebook that is not valid JSON is reported once, by notebook-valid-json.
import { join, posix } from 'node:path'
import { finding, finish, isFixture, main, readBudgets, readText, sizeOf, trackedFiles, withFixture } from './kit.mjs'

const MB = 1024 * 1024
const cfg = (root) => readBudgets(root)?.data ?? {}
const SKIP = /(^|\/)(node_modules|dist|build|vendor|target|fixtures?)\//i
const MINIFIED = /\.min\.(m?js|css)$/i
const files = (root, re) => trackedFiles(root).filter((x) => re.test(x) && !SKIP.test(x) && !MINIFIED.test(x) && !isFixture(x))
const allowFor = (root, id) => {
  const set = new Set()
  for (const raw of readText(root, '.meerkat-data-allow').split('\n')) {
    const line = raw.trim()
    const sp = line.search(/\s/)
    if (!line || line.startsWith('#') || sp < 0) continue
    if (line.slice(0, sp) === id) set.add(posix.normalize(line.slice(sp).trim()))
  }
  return set
}
// A folder with nothing of this kind in it: the check passes and says why.
const na = (id, what) => {
  console.log(`${id}: not applicable: ${what}`)
  return 0
}
// Findings that fail only when the budget asks for it. Otherwise they are printed as information and the check passes.
const soft = (name, required, findings, okNote, infoNote) => {
  if (!findings.length) {
    console.log(`${name}: ${okNote}`)
    return 0
  }
  if (required) return finish(name, findings)
  console.log(`${name}: information only, ${infoNote}`)
  for (const f of findings.slice(0, 20)) console.log(`  ${f}`)
  if (findings.length > 20) console.log(`  ... and ${findings.length - 20} more`)
  return 0
}

// ---- notebook reading: a notebook that does not parse is a finding for notebook-valid-json, and the other notebook checks skip it
const NB = /\.ipynb$/i
const nbFiles = (root) => files(root, NB)
const parseNb = (text) => {
  try {
    return { nb: JSON.parse(text.replace(/^\uFEFF/, '')) }
  } catch (e) {
    return { error: String(e.message).split('\n')[0] }
  }
}
const parsedNbs = (root) =>
  nbFiles(root)
    .map((x) => ({ x, ...parseNb(readText(root, x)) }))
    .filter((e) => e.nb && typeof e.nb === 'object' && !Array.isArray(e.nb))
    .map((e) => ({ x: e.x, nb: e.nb }))
const cellsOf = (nb) => (Array.isArray(nb.cells) ? nb.cells : [])
const isCell = (c) => Boolean(c) && typeof c === 'object'
const textOf = (v) => (Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : '')
const sourceOf = (cell) => textOf(cell.source)
const outputTextOf = (o) => [textOf(o?.text), textOf(o?.data?.['text/plain']), Array.isArray(o?.traceback) ? o.traceback.join('\n') : ''].join('\n')

// Code that a Python check reads: every .py file, and the code cells of every notebook that parses. where says which cell.
const codeUnits = (root) => {
  const out = files(root, /\.py$/i).map((x) => ({ x, where: '', text: readText(root, x) }))
  for (const { x, nb } of parsedNbs(root)) {
    cellsOf(nb).forEach((c, i) => {
      if (isCell(c) && c.cell_type === 'code') out.push({ x, where: ` cell ${i + 1}`, text: sourceOf(c) })
    })
  }
  return out
}

// ---- notebook-valid-json: the file parses, and has the fields Jupyter needs (nbformat, cells, metadata)
const notebookValidJson = (root) => {
  const ID = 'notebook-valid-json'
  if (!nbFiles(root).length) return na(ID, 'no notebooks')
  const allow = allowFor(root, ID)
  const f = []
  for (const x of nbFiles(root)) {
    if (allow.has(x)) continue
    const p = parseNb(readText(root, x))
    if (p.error) {
      f.push(`${x} is not valid JSON: ${p.error}`)
      continue
    }
    const nb = p.nb
    if (!nb || typeof nb !== 'object' || Array.isArray(nb)) {
      f.push(`${x} is not a notebook object`)
      continue
    }
    if (typeof nb.nbformat !== 'number') f.push(`${x} has no nbformat number`)
    if (!Array.isArray(nb.cells)) f.push(`${x} has no cells list`)
    if (!nb.metadata || typeof nb.metadata !== 'object') f.push(`${x} has no metadata object`)
    cellsOf(nb).forEach((c, i) => {
      if (!isCell(c) || !['code', 'markdown', 'raw'].includes(c.cell_type)) f.push(`${x} cell ${i + 1} has no valid cell_type`)
    })
  }
  return finish(ID, f, 'every notebook is valid JSON with the fields Jupyter needs')
}

// ---- notebook-outputs-stripped: no saved outputs, run counts or big embedded images in a committed notebook
const notebookOutputsStripped = (root) => {
  const ID = 'notebook-outputs-stripped'
  if (!nbFiles(root).length) return na(ID, 'no notebooks')
  const allow = allowFor(root, ID)
  const maxKb = cfg(root).maxEmbeddedImageKb ?? 100
  const f = []
  for (const { x, nb } of parsedNbs(root)) {
    if (allow.has(x)) continue
    const cells = cellsOf(nb).filter(isCell)
    const stored = cells.filter((c) => c.cell_type === 'code' && ((Array.isArray(c.outputs) && c.outputs.length > 0) || c.execution_count != null))
    if (stored.length) f.push(`${x} keeps the output or run count of ${stored.length} code cell(s) (clear all outputs before committing)`)
    cellsOf(nb).forEach((c, i) => {
      if (!isCell(c) || !Array.isArray(c.outputs)) return
      for (const o of c.outputs) {
        for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml']) {
          const kb = Math.round(textOf(o?.data?.[mime]).length * 0.75 / 1024)
          if (kb > maxKb) f.push(`${x} cell ${i + 1} embeds a ${mime} image of about ${kb} KB (limit ${maxKb} KB)`)
        }
      }
    })
  }
  return finish(ID, f, 'no notebook keeps outputs, run counts or big images')
}

// ---- notebook-secrets: keys, tokens and passwords in cells or outputs. Only the file, the cell and a 4 character prefix are printed.
const SECRET = [
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/, 'model API key'],
  [/\bhf_[A-Za-z0-9]{30,}\b/, 'Hugging Face token'],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'private key'],
]
const ASSIGNED = /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|token|passwd|password|pwd)["']?\s*[:=]\s*(["'])([^"'\s]{8,})\1/i
const PLACEHOLDER = /your|xxx|example|changeme|placeholder|dummy|<|\$\{|\{\{|\*\*\*|\.\.\.|getenv|environ/i
const notebookSecrets = (root) => {
  const ID = 'notebook-secrets'
  if (!nbFiles(root).length) return na(ID, 'no notebooks')
  const allow = allowFor(root, ID)
  const f = []
  for (const { x, nb } of parsedNbs(root)) {
    if (allow.has(x)) continue
    cellsOf(nb).forEach((c, i) => {
      if (!isCell(c)) return
      const parts = [sourceOf(c), ...(Array.isArray(c.outputs) ? c.outputs : []).map((o) => outputTextOf(o))]
      for (const text of parts) {
        for (const [re, label] of SECRET) {
          const m = re.exec(text)
          if (m) f.push(`${x} cell ${i + 1} holds what looks like a ${label} (starts "${m[0].slice(0, 4)}...")`)
        }
        const a = ASSIGNED.exec(text)
        if (a && !PLACEHOLDER.test(a[2])) f.push(`${x} cell ${i + 1} sets a literal credential (value starts "${a[2].slice(0, 4)}...")`)
      }
    })
  }
  return finish(ID, f, 'no notebook holds a key, token or password')
}

// ---- notebook-size: a notebook over the size budget (usually outputs or images that should not be committed)
const notebookSize = (root) => {
  const ID = 'notebook-size'
  if (!nbFiles(root).length) return na(ID, 'no notebooks')
  const allow = allowFor(root, ID)
  const max = cfg(root).maxNotebookKb ?? 500
  const f = []
  for (const x of nbFiles(root)) {
    if (allow.has(x)) continue
    const kb = Math.round(sizeOf(join(root, x)) / 1024)
    if (kb > max) f.push(`${x} is ${kb} KB (limit ${max} KB, usually outputs or images that should not be committed)`)
  }
  return finish(ID, f, `every notebook is under ${max} KB`)
}

// ---- notebook-absolute-paths: a path that only exists on one machine, in a cell's code or text
const ABS_PATH = /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\|(?:^|[\s'"(=,])\/(?:home|Users)\/[\w.-]+\//
const notebookAbsolutePaths = (root) => {
  const ID = 'notebook-absolute-paths'
  if (!nbFiles(root).length) return na(ID, 'no notebooks')
  const allow = allowFor(root, ID)
  const f = []
  for (const { x, nb } of parsedNbs(root)) {
    if (allow.has(x)) continue
    cellsOf(nb).forEach((c, i) => {
      if (!isCell(c)) return
      const m = ABS_PATH.exec(sourceOf(c))
      if (m) f.push(`${x} cell ${i + 1} uses a path from one machine (${m[0].trim().slice(0, 40)}), so it breaks elsewhere`)
    })
  }
  return finish(ID, f, 'no notebook hard-codes a path from one machine')
}

// ---- notebook-pip-magics: a !pip or %pip install in a cell that names a package without an exact version
const PIP = /^\s*[!%]\s*pip3?\s+install\b(.*)$/
const PIP_TAKES_VALUE = new Set(['-r', '-c', '-e', '-i', '-f', '--requirement', '--constraint', '--index-url', '--extra-index-url', '--find-links'])
const unpinnedPips = (line) => {
  const m = PIP.exec(line)
  if (!m) return []
  const out = []
  let skip = false
  for (const raw of m[1].split(/\s+/)) {
    const t = raw.replace(/["']/g, '')
    if (skip) {
      skip = false
      continue
    }
    if (!t) continue
    if (/^(&&|\|\||;|#)/.test(t)) break
    if (PIP_TAKES_VALUE.has(t)) {
      skip = true
      continue
    }
    if (t.startsWith('-') || /^[./\\]/.test(t) || /[/\\]/.test(t) || /@|:\/\//.test(t) || /\.(whl|zip|tar\.gz)$/.test(t)) continue
    if (!/==\s*\d/.test(t)) out.push(t)
  }
  return out
}
const notebookPipMagics = (root) => {
  const ID = 'notebook-pip-magics'
  if (!nbFiles(root).length) return na(ID, 'no notebooks')
  const allow = allowFor(root, ID)
  const f = []
  for (const { x, nb } of parsedNbs(root)) {
    if (allow.has(x)) continue
    cellsOf(nb).forEach((c, i) => {
      if (!isCell(c) || c.cell_type !== 'code') return
      for (const line of sourceOf(c).split('\n')) {
        const loose = unpinnedPips(line)
        if (loose.length) f.push(`${x} cell ${i + 1} installs ${loose.join(', ')} without an exact version (pin it with ==)`)
      }
    })
  }
  return finish(ID, f, 'every notebook pip install names exact versions')
}

// ---- model-files-in-git and data-files-in-git: big binary files tracked by plain git instead of git-lfs
const LFS_PATTERNS = (root) =>
  readText(root, '.gitattributes')
    .split('\n')
    .filter((l) => /filter=lfs/.test(l))
    .map((l) => l.trim().split(/\s+/)[0].replace(/^\*\*\//, ''))
const underLfs = (pats, x) =>
  pats.some((p) => (p.startsWith('*.') ? posix.basename(x).toLowerCase().endsWith(p.slice(1).toLowerCase()) : p === x || p === posix.basename(x)))
const heavyFiles = (root, id, re, what, limitBytes) => {
  const list = files(root, re)
  if (!list.length) return na(id, `no ${what}`)
  const allow = allowFor(root, id)
  const pats = LFS_PATTERNS(root)
  const f = []
  for (const x of list) {
    if (allow.has(x) || underLfs(pats, x)) continue
    const size = sizeOf(join(root, x))
    if (size > limitBytes) f.push(`${x} is ${(size / MB).toFixed(1)} MB and is not stored with git-lfs (track it with git lfs, or keep it out of the repo)`)
  }
  return finish(id, f, `every ${what} is under the size limit or stored with git-lfs`)
}
const MODEL_FILE = /\.(pt|pth|ckpt|safetensors|onnx|h5|pkl|joblib|bin)$/i
const DATA_FILE_BIG = /\.(csv|parquet|feather|sqlite|db|npy)$/i

// ---- pickle-load: a pickle, joblib or torch load of a path the code does not fix (unpickling can run code)
const PICKLE = /\b(pickle|cPickle|joblib|torch)\.load\((.*)$/
const LITERAL_ARG = /^\s*(?:r|b|f)?(["'])[^"']*\1\s*[,)]/
const pickleLoad = (root) => {
  const ID = 'pickle-load'
  const units = codeUnits(root)
  if (!units.length) return na(ID, 'no Python files or notebooks')
  const allow = allowFor(root, ID)
  const f = []
  for (const { x, where, text } of units) {
    if (allow.has(x)) continue
    text.split('\n').forEach((line, i) => {
      const m = PICKLE.exec(line)
      if (!m || line.trim().startsWith('#')) return
      const arg = m[2]
      if (LITERAL_ARG.test(arg)) return
      if (m[1] === 'torch' && /weights_only\s*=\s*True/.test(arg)) return
      f.push(`${x}${where} line ${i + 1}: ${m[1]}.load reads a path the code does not fix (use a literal path, or torch weights_only=True)`)
    })
  }
  return finish(ID, f, 'every pickle load reads a fixed path or uses weights_only')
}

// ---- random-seed-missing: a script that trains or samples with random numbers and never sets a seed (information unless requireSeeds)
const TRAINS = /\.fit\(|\.train\(|\btrain\(|optimizer\.step\(|\.backward\(\)|train_test_split\(/
const USES_RANDOM = /\b(?:np|numpy)\.random\.|\brandom\.(?:random|randint|choice|shuffle|sample|uniform|randrange)\(|\btorch\.(?:rand|randn|randint|randperm)\(|\btf\.random\.|train_test_split\(/
const SETS_SEED = /random\.seed\(|np\.random\.seed\(|numpy\.random\.seed\(|manual_seed\(|tf\.random\.set_seed\(|set_seed\(|seed_everything\(|default_rng\(\s*\d|random_state\s*=|PYTHONHASHSEED|\bseed\s*=/
const randomSeedMissing = (root) => {
  const ID = 'random-seed-missing'
  const units = codeUnits(root)
  if (!units.length) return na(ID, 'no Python files or notebooks')
  const allow = allowFor(root, ID)
  const byFile = new Map()
  for (const u of units) byFile.set(u.x, (byFile.get(u.x) ?? '') + '\n' + u.text)
  const f = []
  for (const [x, text] of byFile) {
    if (allow.has(x)) continue
    if (TRAINS.test(text) && USES_RANDOM.test(text) && !SETS_SEED.test(text)) {
      f.push(`${x} trains or samples with random numbers and never sets a seed`)
      // Reported as a finding even when the check only informs, so findings.json carries it (the first random call, or line 1 in a notebook).
      const at = /\.py$/i.test(x) ? readText(root, x).split(/\r?\n/).findIndex((l) => USES_RANDOM.test(l)) + 1 : 0
      finding('info', null, x, Math.max(at, 1), 'trains or samples with random numbers and never sets a seed')
    }
  }
  return soft(ID, cfg(root).requireSeeds === true, f, 'every script that uses random numbers sets a seed', `${f.length} script(s) use random numbers and set no seed (set data.requireSeeds to true to fail on them)`)
}

// ---- requirements-pinned-ml: numpy, pandas, torch, tensorflow, scikit-learn and transformers need an exact version (==)
const ML = new Set(['numpy', 'pandas', 'torch', 'tensorflow', 'scikit-learn', 'transformers'])
const canonName = (n) => {
  const k = n.toLowerCase().replace(/[-_.]+/g, '-')
  return k === 'sklearn' ? 'scikit-learn' : k
}
const DEP = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/
const EXACT = /^==\s*\d[\w.+!-]*$/
const requirementsPinnedMl = (root) => {
  const ID = 'requirements-pinned-ml'
  const list = files(root, /(^|\/)requirements[^/]*\.txt$|(^|\/)pyproject\.toml$/i)
  if (!list.length) return na(ID, 'no requirements or pyproject files')
  const allow = allowFor(root, ID)
  const f = []
  const check = (x, where, text) => {
    const m = DEP.exec(text)
    if (!m || !ML.has(canonName(m[1]))) return
    const spec = m[2].trim()
    if (!EXACT.test(spec)) f.push(`${x}${where}: ${m[1]} is not pinned to an exact version (found "${spec || 'no version'}"), write ${m[1]}==x.y.z`)
  }
  for (const x of list) {
    if (allow.has(x)) continue
    const toml = /\.toml$/i.test(x)
    readText(root, x)
      .split('\n')
      .forEach((raw, i) => {
        const line = raw.replace(/\r$/, '').trim()
        if (!line || line.startsWith('#') || line.startsWith('-')) return
        const where = ` line ${i + 1}`
        if (toml) for (const m of line.matchAll(/"([^"]+)"/g)) check(x, where, m[1].split(';')[0].trim())
        else check(x, where, line.replace(/\s+#.*$/, '').split(';')[0].trim())
      })
  }
  return finish(ID, f, 'every ML package is pinned to an exact version')
}

// ---- dataset-license-note: a data or datasets folder with no note saying where its data came from (information unless requireDatasetNotes)
const DATA_DIR = /^(data|datasets)$/i
const DATA_FILE = /\.(csv|tsv|json|jsonl|parquet|feather|arrow|sqlite|db|npy|npz|xlsx|xls|h5|hdf5|zip|gz)$/i
const NOTE_FILE = /^(readme|license|copying|data|dataset|datasets|datasheet|source|sources|provenance)(\.(md|txt|rst))?$/i
const datasetLicenseNote = (root) => {
  const ID = 'dataset-license-note'
  const all = trackedFiles(root).filter((x) => !isFixture(x))
  const dirs = new Map()
  for (const x of all.filter((p) => DATA_FILE.test(p) && !SKIP.test(p))) {
    const segs = posix.dirname(x).split('/')
    const i = segs.findIndex((s) => DATA_DIR.test(s))
    if (i < 0) continue
    const dir = segs.slice(0, i + 1).join('/')
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
  }
  if (!dirs.size) return na(ID, 'no data folders')
  const allow = allowFor(root, ID)
  const f = []
  for (const [dir, n] of dirs) {
    if (allow.has(dir)) continue
    const noted = all.some((x) => posix.dirname(x) === dir && NOTE_FILE.test(posix.basename(x)))
    if (!noted) f.push(`${dir}/ holds ${n} data file(s) and no README, LICENSE or DATA.md saying where they came from`)
  }
  return soft(ID, cfg(root).requireDatasetNotes === true, f, 'every data folder says where its data came from', `${f.length} data folder(s) have no source note (set data.requireDatasetNotes to true to fail on them)`)
}

const fx = (tree, fn) => ({ fixture: () => withFixture(tree, fn) })
const nb = (cells) => JSON.stringify({ cells, metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } }, nbformat: 4, nbformat_minor: 5 }, null, 1)
const code = (source, extra = {}) => ({ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source, ...extra })
const budgets = (data) => JSON.stringify({ data })

main({
  'notebook-valid-json': { run: notebookValidJson, ...fx({ 'bad.ipynb': '{ "cells": [' }, notebookValidJson) },
  'notebook-outputs-stripped': {
    run: notebookOutputsStripped,
    ...fx({ 'run.ipynb': nb([code('x = 1', { execution_count: 3, outputs: [{ output_type: 'stream', name: 'stdout', text: ['1\n'] }] })]) }, notebookOutputsStripped),
  },
  'notebook-secrets': { run: notebookSecrets, ...fx({ 'key.ipynb': nb([code('API_KEY = "sk-proj-abcdefghijklmnopqrstuvwx"')]) }, notebookSecrets) },
  'notebook-size': {
    run: notebookSize,
    ...fx({ 'big.ipynb': nb([{ cell_type: 'markdown', metadata: {}, source: 'x'.repeat(2048) }]), '.meerkat-budgets.json': budgets({ maxNotebookKb: 1 }) }, notebookSize),
  },
  'notebook-absolute-paths': { run: notebookAbsolutePaths, ...fx({ 'load.ipynb': nb([code('df = read("C:\\Users\\Futur\\data.csv")')]) }, notebookAbsolutePaths) },
  'notebook-pip-magics': { run: notebookPipMagics, ...fx({ 'setup.ipynb': nb([code('!pip install numpy pandas==2.2.2')]) }, notebookPipMagics) },
  'model-files-in-git': {
    run: (root) => heavyFiles(root, 'model-files-in-git', MODEL_FILE, 'model files', MB),
    ...fx({ 'model.pt': 'x'.repeat(MB + 1024) }, (root) => heavyFiles(root, 'model-files-in-git', MODEL_FILE, 'model files', MB)),
  },
  'data-files-in-git': {
    run: (root) => heavyFiles(root, 'data-files-in-git', DATA_FILE_BIG, 'data files', (cfg(root).maxDataMb ?? 25) * MB),
    ...fx({ 'data.csv': 'a,b\n'.repeat(5000), '.meerkat-budgets.json': budgets({ maxDataMb: 0.01 }) }, (root) =>
      heavyFiles(root, 'data-files-in-git', DATA_FILE_BIG, 'data files', (cfg(root).maxDataMb ?? 25) * MB),
    ),
  },
  'pickle-load': { run: pickleLoad, ...fx({ 'train.py': 'import pickle\nmodel = pickle.load(open(path, "rb"))\n' }, pickleLoad) },
  'random-seed-missing': {
    run: randomSeedMissing,
    ...fx({ 'train.py': 'import numpy as np\nfor epoch in range(3):\n    model.fit(X, y)\nnoise = np.random.rand(3)\n', '.meerkat-budgets.json': budgets({ requireSeeds: true }) }, randomSeedMissing),
  },
  'requirements-pinned-ml': { run: requirementsPinnedMl, ...fx({ 'requirements.txt': 'numpy>=1.20\npandas\n' }, requirementsPinnedMl) },
  'dataset-license-note': {
    run: datasetLicenseNote,
    ...fx({ 'data/train.csv': 'a,b\n1,2\n', '.meerkat-budgets.json': budgets({ requireDatasetNotes: true }) }, datasetLicenseNote),
  },
})
