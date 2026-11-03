// Hard planted defects, family: config-combo. A setting that is only unsafe because of what another file does with it (a constant that
// names a weak cipher, a CORS option whose credentials flag is set elsewhere, a debug flag held in a shared options object).
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
    ['config-cors-credentials-split', 'cors-wildcard', 'CORS origin true in one file while another file switches credentials on for the same options', {
      'src/config/cors.js': [['exports.corsOptions = { origin: true }', "exports.corsOptions = { origin: ['https://app.example.com'] }", 'x']],
      'src/server.js': ["const express = require('express')", "const cors = require('cors')", "const { corsOptions } = require('./config/cors')", 'const app = express()', 'corsOptions.credentials = true', 'app.use(cors(corsOptions))', 'module.exports = app'],
    }],
    ['config-cors-origin-helper', 'cors-wildcard', 'the Allow-Origin header is set from a helper that returns the caller Origin, with credentials allowed', {
      'src/lib/origin.js': ["exports.allowed = ['https://app.example.com']", "exports.pick = (req) => req.get('origin')", "exports.pickAllowed = (req) => (exports.allowed.includes(req.get('origin')) ? req.get('origin') : exports.allowed[0])"],
      'src/cors-mw.js': ["const { pick, pickAllowed } = require('./lib/origin')", 'module.exports = (req, res, next) => {', ["  res.setHeader('Access-Control-Allow-Origin', pick(req))", "  res.setHeader('Access-Control-Allow-Origin', pickAllowed(req))", 'x'], "  res.setHeader('Access-Control-Allow-Credentials', 'true')", '  next()', '}'],
    }],
    ['config-cookie-shared-opts', 'cookie-flags', 'a session cookie set with an options object from another file that holds no HttpOnly, Secure or SameSite', {
      'src/config/session.js': ["exports.cookieOpts = { path: '/', maxAge: 86400000 }"],
      'src/routes/login.js': ["const { cookieOpts } = require('../config/session')", "module.exports = (app) => app.post('/login', (req, res) => {", ["  res.cookie('sid', req.sessionID, cookieOpts)", "  res.cookie('sid', req.sessionID, { ...cookieOpts, httpOnly: true, secure: true, sameSite: 'lax' })", 'x'], '  res.sendStatus(204)', '})'],
    }],
    ['config-cipher-constant', 'weak-crypto-modes', 'a constants file names an ECB cipher that another file passes to createCipheriv', {
      'src/lib/constants.js': [["exports.CIPHER = 'aes-128-ecb'", "exports.CIPHER = 'aes-256-gcm'", 'x']],
      'src/lib/seal.js': ["const crypto = require('crypto')", "const { CIPHER } = require('./constants')", 'exports.seal = (key, text) => {', ['  const c = crypto.createCipheriv(CIPHER, key, null)', '  const iv = crypto.randomBytes(12)\n  const c = crypto.createCipheriv(CIPHER, key, iv)'], "  return Buffer.concat([c.update(text, 'utf8'), c.final()])", '}'],
    }],
    ['config-fixed-key-constant', 'weak-crypto-modes', 'a fixed encryption key written as a constant in one file and used by a cipher in another', {
      'src/lib/keys.js': [["exports.KEY = Buffer.from('0123456789abcdef0123456789abcdef')", "exports.KEY = Buffer.from(process.env.APP_KEY || '', 'hex')", 'x']],
      'src/lib/vault.js': ["const crypto = require('crypto')", "const { KEY } = require('./keys')", 'exports.open = (iv, data) => {', "  const c = crypto.createDecipheriv('aes-256-cbc', KEY, iv)", "  return Buffer.concat([c.update(data), c.final()])", '}'],
    }],
    ['config-regex-constant', 'regex-dos', 'a pattern with a repeat inside a repeat held as a string constant in one file and compiled in another', {
      'src/lib/patterns.js': [["exports.NAME = '^(\\\\w+\\\\s?)*$'", "exports.NAME = '^[\\\\w ]{1,64}$'", 'x']],
      'src/lib/validate.js': ["const { NAME } = require('./patterns')", 'exports.validName = (input) => new RegExp(NAME).test(input)'],
    }],
    ['config-flask-debug-opts', 'debug-enabled|cp-python', 'the Flask server options object turns debug on and is passed to app.run from another file', {
      'conf.py': [["SERVER_OPTS = dict(host='0.0.0.0', port=8000, debug=True)", "SERVER_OPTS = dict(host='127.0.0.1', port=8000, debug=False)", 'x']],
      'run.py': ['from flask import Flask', 'from conf import SERVER_OPTS', '', 'app = Flask(__name__)', '', "if __name__ == '__main__':", '    app.run(**SERVER_OPTS)'],
    }],
    ['config-tls-verify-dict', 'risky-code|cp-python', 'a shared options dict switches certificate checking off and is unpacked into requests calls elsewhere', {
      'http_opts.py': [["TLS = {'verify': False, 'timeout': 5}", "TLS = {'verify': True, 'timeout': 5}", 'x']],
      'fetch.py': ['import requests', 'from http_opts import TLS', '', 'def get_json(url):', '    return requests.get(url, **TLS).json()'],
    }],
    ['config-jwt-alg-list', 'jwt-weak', 'the accepted JWT algorithm list in a config file includes none', {
      'src/auth/config.js': [["exports.jwtAlgorithms = ['HS256', 'none']", "exports.jwtAlgorithms = ['HS256']", 'x']],
      'src/auth/verify.js': ["const jwt = require('jsonwebtoken')", "const { jwtAlgorithms } = require('./config')", 'exports.check = (token, secret) => jwt.verify(token, secret, { algorithms: jwtAlgorithms })'],
    }],
    ['config-jwt-secret-fallback', 'jwt-weak|secrets-plus', 'the signing secret falls back to a typed-in default in a config file used by the token code', {
      'src/auth/secret.js': [["exports.jwtSecret = process.env.JWT_SECRET || 'changeme-dev-secret'", "const s = process.env.JWT_SECRET\nif (!s) throw new Error('JWT_SECRET is required')\nexports.jwtSecret = s", 'x']],
      'src/auth/tokens.js': ["const jwt = require('jsonwebtoken')", "const { jwtSecret } = require('./secret')", "exports.issue = (user) => jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '1h' })"],
    }],
  ]
  return mk('config', ctx, cases)
}
