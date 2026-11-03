// Hard planted defects, family: taint. Request data that reaches a dangerous call through a helper in another file, through a variable
// split over lines, or through storage (second order). The sink line is planted; the route file that feeds it is a separate file.
// The "-clean" twin has the same two files per case written safely and must not be reported. Keys and projects are prefixed `hard-`.
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
    ['taint-path-helper', 'path-traversal-pattern', 'a route passes a URL parameter to a helper in another file that joins it into a file path unchecked', {
      'src/routes/download.js': ["const { readUpload } = require('../lib/uploads')", "module.exports = (app) => app.get('/files/:name', (req, res) => res.send(readUpload(req.params.name)))"],
      'src/lib/uploads.js': ["const fs = require('fs')", "const path = require('path')", "const BASE = path.join(__dirname, '..', '..', 'uploads')", ['exports.readUpload = (name) => fs.readFileSync(path.join(BASE, name))', 'exports.readUpload = (name) => fs.readFileSync(path.join(BASE, path.basename(name)))', 'x']],
    }],
    ['taint-path-python', 'path-traversal-pattern', 'a Flask view passes a query value to a storage helper in another file that sends the joined path', {
      'app/views.py': ['from app.storage import serve', '', 'def download(request):', "    return serve(request.args['f'])"],
      'app/storage.py': ['import os', 'from flask import send_file', 'from werkzeug.utils import safe_join', '', "BASE = '/srv/uploads'", '', 'def serve(name):', ['    return send_file(os.path.join(BASE, name))', '    return send_file(safe_join(BASE, name))', 'x']],
    }],
    ['taint-redirect-helper', 'open-redirect-pattern', 'a login route hands a query value to a redirect helper in another file with no allow-list', {
      'src/routes/login.js': ["const { goBack } = require('../lib/nav')", "module.exports = (app) => app.post('/login', (req, res) => goBack(res, req.query.next))"],
      'src/lib/nav.js': [['', "const allowed = ['/', '/home', '/account']"], ['exports.goBack = (res, target) => res.redirect(target)', "exports.goBack = (res, target) => res.redirect(allowed.includes(target) ? target : '/')", 'x']],
    }],
    ['taint-redirect-python', 'open-redirect-pattern', 'a Flask view passes a query value to a helper in another file that redirects to it', {
      'app/auth_views.py': ['from app.nav import go', '', 'def after_login(request):', "    return go(request.args.get('next'))"],
      'app/nav.py': ['from flask import redirect', '', ['', 'def is_safe_url(url):\n    return bool(url) and url.startswith("/") and not url.startswith("//")\n'], 'def go(url):', ['    return redirect(url)', "    return redirect(url if is_safe_url(url) else '/')", 'x']],
    }],
    ['taint-sql-split-lines', 'sql-concat', 'an SQL statement started on one line and completed with a request value on a later line, then run by a helper', {
      'src/routes/orders.js': ["const { run } = require('../lib/db')", "module.exports = (app) => app.get('/orders', async (req, res) => {", ["  let q = 'select * from orders where id = '", "  const q = 'select * from orders where id = $1'"], ['  q += req.query.id', '  const args = [req.query.id]', 'x'], ['  res.json(await run(q))', '  res.json(await run(q, args))'], '})'],
      'src/lib/db.js': ["const { Pool } = require('pg')", 'const pool = new Pool()', ['exports.run = async (q) => (await pool.query(q)).rows', 'exports.run = async (q, args = []) => (await pool.query(q, args)).rows']],
    }],
    ['taint-sql-order-column', 'sql-concat', 'a request value chosen as the sort column and spliced into the statement by a helper in another file', {
      'src/routes/users.js': ["const { listUsers } = require('../lib/users-db')", "module.exports = (app) => app.get('/users', async (req, res) => res.json(await listUsers(req.query.sort)))"],
      'src/lib/users-db.js': ["const db = require('./pool')", "const COLUMNS = { name: 'name', created: 'created_at' }", ['exports.listUsers = (col) => db.query(`SELECT * FROM users ORDER BY ${col}`)', "exports.listUsers = (col) => db.query(`SELECT * FROM users ORDER BY ${COLUMNS[col] || 'name'}`)", 'x']],
    }],
    ['taint-cp-helper', 'cp-js|risky-code', 'a generic shell helper in one file runs any string a route builds from a request value', {
      'src/routes/convert.js': ["const { sh } = require('../lib/sh')", ["module.exports = (app) => app.get('/convert', (req, res) => sh('convert ' + req.query.file + ' out.png', () => res.sendStatus(204)))", "module.exports = (app) => app.get('/convert', (req, res) => sh('convert', [String(req.query.file), 'out.png'], () => res.sendStatus(204)))"]],
      'src/lib/sh.js': ["const cp = require('child_process')", ['exports.sh = (cmd, cb) => cp.exec(cmd, cb)', 'exports.sh = (bin, args, cb) => cp.execFile(bin, args, cb)', 'x']],
    }],
    ['taint-eval-newfunction', 'risky-code|cp-js', 'a calculator route passes a body field to a helper in another file that builds a function from it', {
      'src/routes/calc.js': ["const { evaluate } = require('../lib/calc')", "module.exports = (app) => app.post('/calc', (req, res) => res.json({ result: evaluate(req.body.expression) }))"],
      'src/lib/calc.js': [['exports.evaluate = (expr) => new Function("return " + expr)()', 'exports.evaluate = (expr) => Number.parseFloat(expr)', 'x']],
    }],
    ['taint-yaml-load', 'risky-code|cp-python|xxe-and-deserialize', 'a view passes the raw request body to a loader in another file that calls yaml.load', {
      'app/handlers.py': ['from app.loader import load_config', '', 'def upload(request):', '    return load_config(request.data)'],
      'app/loader.py': ['import yaml', '', 'def load_config(raw):', ['    return yaml.load(raw)', '    return yaml.safe_load(raw)', 'x']],
    }],
    ['taint-pickle-loads', 'pickle-load|risky-code|cp-python', 'a view passes an uploaded blob to a helper in another file that unpickles it', {
      'app/jobs_views.py': ['from app.blobs import restore', '', 'def resume(request):', "    return restore(request.files['state'].read())"],
      'app/blobs.py': ['import pickle', 'import json', '', 'def restore(blob):', ['    return pickle.loads(blob)', '    return json.loads(blob)', 'x']],
    }],
    ['taint-error-leak-helper', 'error-leak', 'a handler sends the result of a helper in another file that returns the error stack', {
      'src/routes/report.js': ["const { describe } = require('../lib/errors')", "module.exports = (app) => app.get('/report', async (req, res) => {", '  try { res.json(await buildReport()) } catch (err) { res.status(500).send(describe(err)) }', '})', 'async function buildReport() { return {} }'],
      'src/lib/errors.js': [['exports.describe = (err) => err.stack', "exports.describe = () => 'internal error'", 'x']],
    }],
    ['taint-proto-merge', 'js-prototype-pollution', 'a request body is merged by a recursive helper in another file that does not skip the prototype keys', {
      'src/routes/settings.js': ["const { merge } = require('../lib/merge')", "const defaults = { theme: 'dark' }", "module.exports = (app) => app.put('/settings', (req, res) => res.json(merge(defaults, req.body)))"],
      'src/lib/merge.js': ['exports.merge = (target, src) => {', '  for (const key of Object.keys(src)) {', ['', "    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue"], "    if (typeof src[key] === 'object' && src[key] !== null) {", '      target[key] = exports.merge(target[key] || {}, src[key])', '    } else {', ['      target[key] = src[key]', '      target[key] = src[key]', 'x'], '    }', '  }', '  return target', '}'],
    }],
    ['taint-second-order-path', 'path-traversal-pattern', 'a file name saved from one route is later joined into a path and sent by another route (second order)', {
      'src/routes/upload.js': ["const store = require('../lib/files-store')", "module.exports = (app) => app.post('/upload', (req, res) => { store.add({ name: req.body.name }); res.sendStatus(201) })"],
      'src/routes/preview.js': ["const path = require('path')", "const store = require('../lib/files-store')", "const DIR = path.join(__dirname, '..', '..', 'uploads')", "module.exports = (app) => app.get('/preview/:id', (req, res) => {", '  const rec = store.get(req.params.id)', ['  res.sendFile(path.join(DIR, rec.name))', '  res.sendFile(path.join(DIR, path.basename(rec.name)))', 'x'], '})'],
    }],
  ]
  return mk('taint', ctx, cases)
}
