// Supply-chain and git-history checks: what was ever committed, what runs when packages are installed, and where dependencies come from.
// Run through the security-plus pack, or by hand:
//   node thorough/sec-supply.mjs <check> [--root <dir>]      node thorough/sec-supply.mjs <check> --fixtures   (must exit 1)
// Limits are set in .meerkat-budgets.json under "security" (historyCommits). Accepted findings go in .meerkat-supply-allow, one per line,
// using the key a finding names (a file, a commit and file, a package name, a registry host, or a file and line).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { finish, isFixture, main, notRun, readBudgets, readText, trackedFiles, withFixture } from './kit.mjs'
import { redact } from './redact.mjs'

const cfg = (root) => readBudgets(root)?.security ?? {}
const allowList = (root) => new Set(readText(root, '.meerkat-supply-allow').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))
const parseJson = (t) => {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 2 ** 20 })
const isRepo = (root) => {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'
  } catch {
    return false
  }
}
const hasCommits = (root) => {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    return true
  } catch {
    return false
  }
}
// The history checks cannot run on a plain folder: say so, never pass quietly.
const needsRepo = (root, name) => (isRepo(root) ? null : notRun(`${name} reads git history, and ${root} is not a git repository`))
// A shallow clone (CI checkouts use depth 1) has one commit that appears to add every file, so a history check would report false findings.
const isShallow = (root) => {
  try {
    return git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true'
  } catch {
    return false
  }
}
const noCommits = (name) => finish(name, [], 'the repository has no commits yet, so there is no history to check')
const errLine = (e) => String(e?.message ?? e).split('\n')[0]

// Lock files are machine-written hashes, not places a person types a secret.
const LOCK = /(^|\/)([^/]*\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|composer\.lock|Gemfile\.lock|poetry\.lock)$/
// Every pattern redact() knows needs one of these words, so a line without any of them cannot hold a secret: a cheap skip before redact().
const PREFILTER = /akia|asia|begin|gh[pousr]_|pat_|xox|live_|aiza|npm_|sk-|eyj|key|secret|token|pass|credential|bearer|authorization|private/i
const MAX_FILE_BYTES = 1024 * 1024

// A soft hit (a value under a secret-looking name) counts only when it is a quoted string, or a bare token with both letters and digits
// that is at least 12 characters long. Most soft hits in source are code such as "token = getToken()", not secrets.
const isLiteralValue = (text, k) => {
  if (/["'`]/.test(text[k - 1] ?? '')) return true
  const token = /^[^\s"'`,;()[\]{}]*/.exec(text.slice(k))[0]
  return token.length >= 12 && /[A-Za-z]/.test(token) && /[0-9]/.test(token) && /^[A-Za-z0-9_\-/=]+$/.test(token)
}

// ---- git-history-secrets: a secret added in any of the last N commits, even if it was removed later (it is still in the history)
const gitHistorySecrets = (root) => {
  const name = 'git-history-secrets'
  const gate = needsRepo(root, name)
  if (gate !== null) return gate
  if (!hasCommits(root)) return noCommits(name)
  if (isShallow(root)) return notRun('this is a shallow clone, so the history is cut off and every file looks newly added. Fetch the full history (git fetch --unshallow)')
  const n = cfg(root).historyCommits ?? 200
  const allow = allowList(root)
  console.log(`scanning the added lines of the last ${n} commits (security.historyCommits)...`)
  let out
  try {
    out = git(root, ['log', '-p', '--no-color', '--no-ext-diff', '-n', String(n), '--diff-filter=AM', '--format=commit %H'])
  } catch (e) {
    return notRun(`git log could not be read, or the history is over 256 MB of diff (${errLine(e)}). Lower security.historyCommits in .meerkat-budgets.json`)
  }
  const findings = []
  let commit = ''
  let file = ''
  let skip = false
  let bytes = 0
  let scanned = 0
  let longLines = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('commit ')) {
      commit = line.slice(7).trim()
      file = ''
      skip = false
      continue
    }
    if (line.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(line)
      file = m ? m[1] : ''
      bytes = 0
      skip = file === '' || LOCK.test(file)
      continue
    }
    if (skip || !line.startsWith('+') || line.startsWith('+++')) continue
    bytes += line.length
    if (bytes > MAX_FILE_BYTES) {
      skip = true
      continue
    }
    const text = line.slice(1)
    if (text.length > 4000) {
      longLines++
      continue
    }
    if (!PREFILTER.test(text)) continue
    scanned++
    const r = redact(text)
    if (r.hard + r.soft === 0) continue
    // The first place the redacted text differs from the original is where the value starts (a literal "<hidden>" in the source cannot fool this).
    let k = 0
    while (k < text.length && k < r.text.length && text[k] === r.text[k]) k++
    if (!r.hard && !isLiteralValue(text, k)) continue
    const short = commit.slice(0, 7)
    if (allow.has(`${short} ${file}`) || allow.has(file)) continue
    const prefix = text.slice(k, k + 8).replace(/^["'`]+/, '').slice(0, 4)
    const kind = r.hard ? 'a key or token in a known secret format' : 'a value given to a secret-looking name'
    findings.push(`${short} ${file}: ${kind}, starts "${prefix}...". It is still in the history, so rotate it`)
  }
  console.log(`checked ${scanned} added lines${longLines ? `, skipped ${longLines} very long lines` : ''}`)
  return finish(name, findings, `no secret-looking values in the added lines of the last ${n} commits`)
}

// ---- env-files-in-history: key and environment files that were ever committed
const SECRET_FILE_NAME = /(^|\/)(\.env(\..+)?|[^/]+\.(pem|key|p12|pfx)|id_rsa)$/i
const envFilesInHistory = (root) => {
  const name = 'env-files-in-history'
  const gate = needsRepo(root, name)
  if (gate !== null) return gate
  if (!hasCommits(root)) return noCommits(name)
  const allow = allowList(root)
  let out
  try {
    out = git(root, ['log', '--all', '--diff-filter=A', '--name-only', '--format=commit %h'])
  } catch (e) {
    return notRun(`git log could not be read (${errLine(e)})`)
  }
  const first = new Map()
  let commit = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('commit ')) {
      commit = line.slice(7).trim()
      continue
    }
    const f = line.trim()
    if (!f || first.has(f)) continue
    if (SECRET_FILE_NAME.test(f) && !/example|sample|template/i.test(f) && !allow.has(f)) first.set(f, commit)
  }
  const findings = [...first].map(([f, c]) => `${f}: added in commit ${c} and still in the history. Remove it from the history and rotate anything it held`)
  return finish(name, findings, 'no key or environment files were ever committed')
}

// ---- install-scripts: code that runs when the project or a dependency is installed
const installScripts = (root) => {
  const name = 'install-scripts'
  const allow = allowList(root)
  const f = []
  for (const x of trackedFiles(root)) {
    if (/(^|\/)node_modules\//.test(x) || isFixture(x)) continue
    const base = x.split('/').pop()
    if (base === 'package.json') {
      const j = parseJson(readText(root, x))
      if (!j) continue
      for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
        const s = j.scripts?.[hook]
        if (s !== undefined && !allow.has(`${x} ${hook}`)) f.push(`${x}: its own "${hook}" script runs when the project is installed: ${s}`)
      }
    } else if (base === 'package-lock.json') {
      const j = parseJson(readText(root, x))
      for (const [key, p] of Object.entries(j?.packages ?? {})) {
        if (!key || !p?.hasInstallScript) continue
        const pkg = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
        if (allow.has(pkg)) continue
        // An optional dependency that is tied to one operating system (fsevents on macOS) installs only there, as a prebuilt helper: not a risk on other machines.
        if (p.optional === true && Array.isArray(p.os) && p.os.length) continue
        f.push(`${x}: ${pkg} ${p.version ?? ''} runs an install script when it is installed`.replace(/ {2,}/g, ' '))
      }
    }
  }
  return finish(name, f, 'no install scripts run on install (or each one is accepted)')
}

// ---- typosquat-names: a dependency name one letter away from a very popular package
const NPM_POPULAR = [
  'lodash', 'react', 'react-dom', 'express', 'axios', 'moment', 'chalk', 'commander', 'debug', 'request', 'async', 'underscore', 'vue', 'angular', 'jquery',
  'webpack', 'typescript', 'eslint', 'prettier', 'jest', 'mocha', 'chai', 'dotenv', 'uuid', 'yargs', 'minimist', 'glob', 'rimraf', 'mkdirp', 'fs-extra',
  'bluebird', 'colors', 'color', 'color-string', 'semver', 'body-parser', 'cors', 'morgan', 'cookie-parser', 'passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs',
  'mongoose', 'sequelize', 'mysql', 'mysql2', 'pg', 'redis', 'socket.io', 'ws', 'node-fetch', 'got', 'superagent', 'cheerio', 'puppeteer', 'playwright', 'next',
  'nuxt', 'svelte', 'vite', 'rollup', 'esbuild', 'tailwindcss', 'postcss', 'autoprefixer', 'sass', 'less', 'styled-components', 'classnames', 'prop-types',
  'redux', 'react-redux', 'react-router', 'react-router-dom', 'vuex', 'pinia', 'zod', 'joi', 'yup', 'ajv', 'dayjs', 'date-fns', 'luxon', 'lodash-es', 'immer',
  'rxjs', 'core-js', 'tslib', 'ts-node', 'nodemon', 'concurrently', 'cross-env', 'husky', 'lint-staged', 'gulp', 'grunt', 'browserify', 'parcel', 'cookie', 'qs',
  'multer', 'helmet', 'compression', 'express-session', 'nodemailer', 'sharp', 'jimp', 'canvas', 'pdfkit', 'xlsx', 'csv-parser', 'papaparse', 'marked',
  'markdown-it', 'highlight.js', 'prismjs', 'xml2js', 'js-yaml', 'inquirer', 'ora', 'boxen', 'figlet', 'open', 'execa', 'cross-spawn', 'shelljs', 'minimatch',
  'micromatch', 'picomatch', 'chokidar', 'nanoid', 'ulid', 'handlebars', 'ejs', 'pug', 'mustache', 'nunjucks', 'dompurify', 'validator', 'sanitize-html',
  'crypto-js', 'aws-sdk', 'firebase', 'stripe', 'twilio', 'openai', 'typeorm', 'prisma', 'knex', 'nock', 'sinon', 'supertest', 'vitest', 'tap', 'ava',
  'node-cron', 'bull', 'amqplib', 'kafkajs', 'ioredis', 'winston', 'pino', 'bunyan', 'log4js', 'react-scripts', 'express-validator',
]
const PYPI_POPULAR = [
  'requests', 'urllib3', 'numpy', 'pandas', 'django', 'flask', 'boto3', 'botocore', 'setuptools', 'wheel', 'pip', 'certifi', 'idna', 'charset-normalizer',
  'chardet', 'cryptography', 'pytest', 'black', 'flake8', 'pylint', 'mypy', 'click', 'jinja2', 'markupsafe', 'werkzeug', 'sqlalchemy', 'alembic', 'psycopg2',
  'psycopg2-binary', 'pymysql', 'redis', 'celery', 'kombu', 'fastapi', 'starlette', 'pydantic', 'uvicorn', 'gunicorn', 'aiohttp', 'httpx', 'httplib2',
  'beautifulsoup4', 'lxml', 'scrapy', 'selenium', 'pillow', 'matplotlib', 'scipy', 'scikit-learn', 'tensorflow', 'torch', 'keras', 'transformers', 'openai',
  'anthropic', 'langchain', 'tqdm', 'rich', 'typer', 'python-dateutil', 'pytz', 'tzdata', 'attrs', 'cffi', 'pycparser', 'protobuf', 'grpcio', 'tornado',
  'twisted', 'paramiko', 'fabric', 'invoke', 'pexpect', 'psutil', 'colorama', 'termcolor', 'pyjwt', 'python-jose', 'passlib', 'python-dotenv', 'decorator',
  'wrapt', 'packaging', 'toml', 'tomli', 'typing-extensions', 'pyparsing', 'pyyaml', 'simplejson', 'ujson', 'orjson', 'seaborn', 'plotly', 'bokeh',
  'streamlit', 'gradio', 'sympy', 'networkx', 'oauthlib', 'google-auth', 'rsa', 'jmespath', 'sqlparse', 'whitenoise', 'gevent', 'eventlet', 'pyinstaller',
  'pyserial', 'sentry-sdk', 'pymongo',
]
const NPM = new Set(NPM_POPULAR)
const PYPI = new Set(PYPI_POPULAR)
// Scopes whose packages are known to be the publisher's own. A popular name under any other scope is the thing to look at.
const NPM_SCOPES = new Set(['@types', '@babel', '@angular', '@vue', '@nestjs', '@testing-library', '@aws-sdk', '@google-cloud', '@azure', '@prisma', '@sveltejs', '@emotion', '@mui', '@reduxjs', '@tanstack', '@playwright', '@vitest', '@supabase', '@anthropic-ai', '@openai', '@sentry', '@stripe'])

// True when a and b differ by one insertion, deletion, substitution, or swap of two neighbouring letters (the Damerau case).
const oneEdit = (a, b) => {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    let i = 0
    while (i < a.length && a[i] === b[i]) i++
    if (i === a.length) return false
    if (a.slice(i + 1) === b.slice(i + 1)) return true
    return i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  let i = 0
  while (i < s.length && s[i] === l[i]) i++
  return s.slice(i) === l.slice(i + 1)
}

const squatOf = (raw, popular, py) => {
  const name = py ? raw.toLowerCase().replace(/[_.]+/g, '-') : raw.toLowerCase()
  if (!py && name.startsWith('@')) {
    const [scope, pkg] = name.split('/')
    if (pkg && !NPM_SCOPES.has(scope) && popular.has(pkg)) return `"${raw}" uses the name of the popular package "${pkg}" under a scope that is not its known one`
    return null
  }
  if (popular.has(name) || name.length < 4) return null
  for (const p of popular) if (p.length >= 4 && oneEdit(name, p)) return `"${raw}" is one letter away from "${p}", a very popular package`
  return null
}

const typosquatNames = (root) => {
  const name = 'typosquat-names'
  const allow = allowList(root)
  const f = []
  const check = (x, raw, popular, py) => {
    if (allow.has(raw)) return
    const why = squatOf(raw, popular, py)
    if (why) f.push(`${x}: ${why}. Check it is not a typo or a lookalike before installing (accept it by name in .meerkat-supply-allow)`)
  }
  for (const x of trackedFiles(root)) {
    if (isFixture(x) || /(^|\/)node_modules\//.test(x)) continue
    const base = x.split('/').pop()
    if (base === 'package.json') {
      const j = parseJson(readText(root, x))
      if (!j) continue
      for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) for (const raw of Object.keys(j[key] ?? {})) check(x, raw, NPM, false)
    } else if (/^requirements.*\.txt$/.test(base)) {
      for (const line of readText(root, x).split('\n')) {
        const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line.replace(/\s+#.*$/, ''))
        if (m) check(x, m[1], PYPI, true)
      }
    }
  }
  return finish(name, f, 'no dependency name looks like a misspelt popular package')
}

// ---- docker-base-pinning: base images that float, downloads piped into a shell, and a final stage that runs as root
const DOCKERFILE = /(^|\/)(Dockerfile(\.[^/]+)?|[^/]+\.Dockerfile)$/
// Joins continuation lines (a trailing backslash) into one instruction, and skips comments and blank lines.
const logicalLines = (t) => {
  const out = []
  let buf = null
  t.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (buf === null && (/^\s*#/.test(line) || !line.trim())) return
    if (buf === null) buf = { n: i + 1, text: '' }
    const cont = /\\\s*$/.test(line)
    buf.text += (buf.text ? ' ' : '') + line.replace(/\\\s*$/, '').trim()
    if (!cont) {
      out.push(buf)
      buf = null
    }
  })
  return out
}
const dockerBasePinning = (root) => {
  const name = 'docker-base-pinning'
  const allow = allowList(root)
  const f = []
  for (const x of trackedFiles(root)) {
    if (!DOCKERFILE.test(x) || isFixture(x) || allow.has(x)) continue
    const stages = []
    for (const { n, text } of logicalLines(readText(root, x))) {
      const m = /^([A-Za-z]+)\s+(.*)$/.exec(text)
      if (!m) continue
      const op = m[1].toUpperCase()
      const rest = m[2]
      if (op === 'FROM') {
        const image = rest.split(/\s+/).filter((t) => !t.startsWith('--'))[0] ?? ''
        stages.push({ n, ops: [] })
        if (!image || image.toLowerCase() === 'scratch' || image.includes('$') || image.includes('@sha256:')) continue
        const tag = /:([^/:]+)$/.exec(image)?.[1]
        if (!tag || tag === 'latest') f.push(`${x}:${n} FROM ${image} ${tag ? 'uses the floating "latest" tag' : 'has no tag, so it means "latest"'} (pin a version or a digest)`)
        continue
      }
      stages[stages.length - 1]?.ops.push({ n, op })
      if (op === 'RUN' && /\b(curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/.test(rest)) f.push(`${x}:${n} RUN pipes a download straight into a shell, so the code that runs is whatever the server sends`)
      if (op === 'ADD' && /^(?:--\S+\s+)*https?:\/\//.test(rest)) f.push(`${x}:${n} ADD fetches a remote file with no checksum`)
    }
    const last = stages.at(-1)
    if (last) {
      const stop = last.ops.findIndex((o) => o.op === 'CMD' || o.op === 'ENTRYPOINT')
      const before = stop < 0 ? last.ops : last.ops.slice(0, stop)
      if (!before.some((o) => o.op === 'USER')) f.push(`${x}:${last.n} the final stage has no USER before its CMD or ENTRYPOINT, so the container runs as root`)
    }
  }
  return finish(name, f, 'base images are pinned, nothing is piped into a shell, and the final stage has a USER')
}

// ---- actions-secrets-echo: workflow habits that print or leak secrets. workflow-security (static.mjs) already reports pull_request_target
// with the head sha or ref; this check adds the refs/pull/ form it does not look for, and the others below.
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/
const actionsSecretsEcho = (root) => {
  const name = 'actions-secrets-echo'
  const allow = allowList(root)
  const f = []
  for (const x of trackedFiles(root)) {
    if (!WORKFLOW.test(x) || allow.has(x)) continue
    const t = readText(root, x)
    const lines = t.split('\n')
    let runAt = -1
    lines.forEach((line, i) => {
      const ind = /^\s*/.exec(line)[0].length
      if (runAt >= 0 && line.trim() && ind <= runAt) runAt = -1
      const isRunKey = /^\s*(?:-\s+)?run:/.test(line)
      if (isRunKey) runAt = ind
      const inRun = isRunKey || runAt >= 0
      const at = `${x}:${i + 1}`
      if (allow.has(at)) return
      if (inRun && /\$\{\{\s*secrets\./.test(line)) {
        if (/\becho\b/.test(line)) f.push(`${at} echoes a secret into the job log, where anyone who can read the log can read it`)
        else f.push(`${at} puts a secret straight into a shell script, where it can leak into logs (pass it through an env: entry instead)`)
      }
      if (/::set-output|set-output name=/.test(line)) f.push(`${at} uses set-output, which GitHub has deprecated (write to the GITHUB_OUTPUT file)`)
    })
    if (/permissions:\s*write-all/.test(t)) f.push(`${x}: "permissions: write-all" gives the token every permission (name only the ones needed)`)
    if (/uses:\s*actions\/checkout/.test(t) && /uses:\s*actions\/upload-artifact/.test(t) && !/persist-credentials:\s*false/.test(t)) f.push(`${x}: a checkout leaves its git credentials on disk and the workflow uploads artifacts (set persist-credentials: false)`)
    if (/pull_request_target/.test(t) && /refs\/pull\//.test(t)) f.push(`${x}: pull_request_target checks out a pull request ref, so untrusted code runs with the repository secrets`)
  }
  return finish(name, f, 'no workflow echoes or leaks secrets, or keeps git credentials it does not need')
}

// ---- requirements-hashes: installs that are not pinned, or that can be swapped for another source
const requirementsHashes = (root) => {
  const name = 'requirements-hashes'
  const allow = allowList(root)
  const f = []
  for (const x of trackedFiles(root)) {
    if (isFixture(x) || /(^|\/)node_modules\//.test(x) || allow.has(x)) continue
    const base = x.split('/').pop()
    if (/^requirements.*\.txt$/.test(base)) {
      const lines = readText(root, x).split('\n')
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].replace(/\s+#.*$/, '').trim()
        const at = `${x}:${i + 1}`
        if (!l || l.startsWith('#')) continue
        if (/^--extra-index-url\b/.test(l)) {
          f.push(`${at} --extra-index-url lets a second index supply a package (dependency confusion), so use one index`)
          continue
        }
        if (/^--trusted-host\b/.test(l)) {
          f.push(`${at} --trusted-host turns off TLS checks for that host`)
          continue
        }
        if (/(?:--index-url|-i)\s+http:\/\//.test(l)) {
          f.push(`${at} the package index is plain http, so packages can be swapped in transit`)
          continue
        }
        if (/git\+|git@/.test(l) && !/@[0-9a-f]{7,40}(?![0-9a-z])/.test(l)) f.push(`${at} installs from git without a commit hash (add @<commit> so the code cannot change under you)`)
        else if (/https?:\/\//.test(l) && !/#sha256=[0-9a-f]{64}/.test(l)) f.push(`${at} installs from a URL with no sha256 hash (add #sha256=<hash>)`)
      }
    } else if (base === '.npmrc') {
      readText(root, x).split('\n').forEach((line, i) => {
        if (/^\s*registry\s*=\s*http:\/\//i.test(line)) f.push(`${x}:${i + 1} the npm registry is set to plain http`)
        if (/^\s*strict-ssl\s*=\s*false/i.test(line)) f.push(`${x}:${i + 1} strict-ssl is off, so downloads skip certificate checks`)
      })
    } else if (base === 'Cargo.toml') {
      const lines = readText(root, x).split('\n')
      lines.forEach((line, i) => {
        if (/^\s*\[patch[.\]]/.test(line)) f.push(`${x}:${i + 1} a [patch] section replaces a crate with another source (check where it points)`)
        if (!/\bgit\s*=\s*["']/.test(line) || /\brev\s*=/.test(line)) return
        let block = line
        if (!line.includes('{')) {
          // A [dependencies.name] table: the rev may sit on another line of the same table.
          let s = i
          while (s > 0 && !/^\s*\[/.test(lines[s])) s--
          let e = i + 1
          while (e < lines.length && !/^\s*\[/.test(lines[e])) e++
          block = lines.slice(s, e).join('\n')
        }
        if (!/\brev\s*=/.test(block)) f.push(`${x}:${i + 1} a git dependency with no rev = (a branch or tag can move, so pin a commit)`)
      })
    }
  }
  return finish(name, f, 'installs are pinned to a version or hash, and no source is plain http or unpinned git')
}

// ---- lockfile-registry-hosts: packages fetched from a host other than the registry the project chose
const CARGO_OK_SOURCE = /^(registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index|sparse\+https:\/\/index\.crates\.io\/)/
const lockfileRegistryHosts = (root) => {
  const name = 'lockfile-registry-hosts'
  const allow = allowList(root)
  const npmrcRegistry = /^\s*registry\s*=\s*(\S+)/m.exec(readText(root, '.npmrc'))?.[1]
  const okHosts = new Set(['registry.npmjs.org'])
  if (npmrcRegistry) {
    try {
      okHosts.add(new URL(npmrcRegistry).host)
    } catch {
      // Not a web address, so there is no host to add.
    }
  }
  const f = []
  for (const x of trackedFiles(root)) {
    if (isFixture(x) || /(^|\/)node_modules\//.test(x)) continue
    const base = x.split('/').pop()
    if (base === 'package-lock.json') {
      const j = parseJson(readText(root, x))
      if (!j) continue
      const urls = []
      if (j.packages) {
        for (const [key, p] of Object.entries(j.packages)) if (typeof p?.resolved === 'string') urls.push([key, p.resolved])
      } else {
        const walk = (deps) => {
          for (const [k, d] of Object.entries(deps ?? {})) {
            if (typeof d?.resolved === 'string') urls.push([k, d.resolved])
            walk(d?.dependencies)
          }
        }
        walk(j.dependencies)
      }
      const byHost = new Map()
      for (const [key, url] of urls) {
        let host
        try {
          host = new URL(url).host || url.slice(0, 40)
        } catch {
          host = url.slice(0, 40)
        }
        if (okHosts.has(host) || allow.has(host)) continue
        const hit = byHost.get(host) ?? { n: 0, ex: key }
        hit.n++
        byHost.set(host, hit)
      }
      for (const [host, { n, ex }] of byHost) f.push(`${x}: ${n} package(s) are fetched from ${host}, not the npm registry (for example ${ex}). Accept the host in .meerkat-supply-allow if that is intended`)
    } else if (base === 'Cargo.lock') {
      readText(root, x).split('\n').forEach((line, i) => {
        const m = /^source\s*=\s*"([^"]+)"/.exec(line)
        if (m && !CARGO_OK_SOURCE.test(m[1]) && !allow.has(m[1])) f.push(`${x}:${i + 1} a crate comes from ${m[1].slice(0, 80)}, not crates.io`)
      })
    }
  }
  return finish(name, f, 'every locked package comes from the registry the project chose')
}

// ---- fixtures: a throwaway git repository with one commit per entry, so the history checks see real commits
const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE'
const gitFixture = (commits, run) => ({
  fixture: async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meerkat-sec-'))
    try {
      git(dir, ['init', '-q'])
      for (const files of commits) {
        for (const [file, body] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, file)), { recursive: true })
          writeFileSync(join(dir, file), body)
        }
        // -f: the user's global ignore file lists .env, and the fixture must commit one whatever the machine ignores.
        git(dir, ['add', '-A', '-f'])
        git(dir, ['-c', 'user.name=meerkat', '-c', 'user.email=meerkat@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture'])
      }
      return await run(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
})
const fx = (files, fn) => ({ fixture: () => withFixture(files, fn) })

main({
  'git-history-secrets': { run: gitHistorySecrets, ...gitFixture([{ 'config.js': `const aws = '${AWS_KEY}'\n` }, { 'config.js': 'const aws = null\n' }], gitHistorySecrets) },
  'env-files-in-history': { run: envFilesInHistory, ...gitFixture([{ '.env': 'DB_PASSWORD=hunter2\n' }], envFilesInHistory) },
  'install-scripts': { run: installScripts, ...fx({ 'package.json': JSON.stringify({ name: 'x', scripts: { postinstall: 'node setup.js' } }) }, installScripts) },
  'typosquat-names': { run: typosquatNames, ...fx({ 'package.json': JSON.stringify({ dependencies: { reqeust: '2.88.2' } }) }, typosquatNames) },
  'docker-base-pinning': { run: dockerBasePinning, ...fx({ Dockerfile: 'FROM node:latest\nRUN curl http://example.invalid/setup | sh\nCMD ["node"]\n' }, dockerBasePinning) },
  'actions-secrets-echo': { run: actionsSecretsEcho, ...fx({ '.github/workflows/ci.yml': 'name: ci\non: push\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ secrets.DEPLOY_TOKEN }}\n' }, actionsSecretsEcho) },
  'requirements-hashes': { run: requirementsHashes, ...fx({ 'requirements.txt': 'requests==2.31.0\n--extra-index-url https://packages.example.invalid/simple\n' }, requirementsHashes) },
  'lockfile-registry-hosts': { run: lockfileRegistryHosts, ...fx({ 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/a': { version: '1.0.0', resolved: 'https://packages.example.invalid/a/-/a-1.0.0.tgz' } } }) }, lockfileRegistryHosts) },
})
