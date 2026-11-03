// Hard planted defects, family: race (unsafe temp names, blocking and un-awaited work that only shows up across a call from another file).
// Two files per case; the "-clean" twin is the same shape written safely and must not be reported. Keys and projects are prefixed `hard-`.
// A file line is a plain string (same in both projects) or [badLine, cleanLine, 'x'] ('x' marks the planted line).

const mk = (fam, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`hard-${fam}`) }
  const good = { ...tidy(`hard-${fam}-clean`) }
  for (const [k, exp, desc, files] of cases) {
    expect[`hard-${k}`] = exp
    for (const [file, lines] of Object.entries(files)) {
      bad[file] = [...lines.map((l) => (Array.isArray(l) ? (l[2] === 'x' ? d(`hard-${k}`, desc, l[0]) : l[0]) : l)), '']
      good[file] = [...lines.map((l) => (Array.isArray(l) ? l[1] : l)), '']
    }
  }
  return { projects: { [`hard-${fam}`]: { files: bad }, [`hard-${fam}-clean`]: { files: good } }, expect }
}

export function projects(ctx) {
  const cases = [
    ['race-mktemp-helper', 'cp-python/py-mktemp-race', 'a helper returns a name from tempfile.mktemp and another file opens it later, so the name can be taken in between', {
      'jobs/tmp.py': ['import tempfile', '', 'def scratch_path():', ['    return tempfile.mktemp()', '    return tempfile.NamedTemporaryFile(delete=False).name', 'x']],
      'jobs/export.py': ['from jobs.tmp import scratch_path', '', 'def write_export(rows):', '    path = scratch_path()', "    with open(path, 'w') as fh:", '        fh.write(str(rows))', '    return path'],
    }],
    ['race-sync-fs-helper', 'sync-fs-in-handlers', 'a request handler calls a helper in another file that does a blocking readFileSync', {
      'src/lib/store.js': ["const fs = require('fs')", "const path = require('path')", ['exports.load = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, "data", id + ".json"), "utf8"))', 'exports.load = async (id) => JSON.parse(await fs.promises.readFile(path.join(__dirname, "data", id + ".json"), "utf8"))', 'x']],
      'src/routes/items.js': ["const { load } = require('../lib/store')", ["module.exports = (app) => app.get('/items/:id', (req, res) => res.json(load(String(Number(req.params.id)))))", "module.exports = (app) => app.get('/items/:id', async (req, res) => res.json(await load(String(Number(req.params.id)))))"]],
    }],
    ['race-floating-promise', 'js-unhandled-promise', 'a route starts an async mail helper from another file without awaiting it or catching its rejection', {
      'src/lib/mailer.js': ['exports.sendWelcome = async (to) => {', "  if (!to) throw new Error('no address')", '  return to', '}'],
      'src/routes/signup.js': ["const { sendWelcome } = require('../lib/mailer')", "module.exports = (app) => app.post('/signup', (req, res) => {", ['  sendWelcome(req.body.email)', '  sendWelcome(req.body.email).catch((err) => console.error(err.message))', 'x'], '  res.sendStatus(201)', '})'],
    }],
    ['race-session-no-timeout', 'cp-python/py-requests-no-timeout', 'a shared requests Session is built in one file and used without a timeout in another', {
      'svc/client.py': ['import requests', '', 'session = requests.Session()'],
      'svc/prices.py': ['from svc.client import session', '', 'def current_price(sku):', ["    return session.get(f'https://prices.example.com/{sku}').json()", "    return session.get(f'https://prices.example.com/{sku}', timeout=5).json()", 'x']],
    }],
  ]
  return mk('race', ctx, cases)
}
