// Extra planted defects: the basic mistakes a current AI assistant still makes on ordinary requests (corpus plan section 4).
// Only the rows whose shape an existing check already covers. Each topic is one planted bug in its own project plus a clean twin
// (`ai-<topic>-clean`) written safely in the same shape. Keys and project names are prefixed `ai-`.
// Loaded by tools/accuracy-corpus.mjs (see docs/accuracy.md, "Extra planted-defect modules").

export function projects(ctx) {
  const { d, S, tidy, pkg } = ctx
  const expect = {}
  const out = {}
  // build.bad(X) returns the lines of the buggy file (X plants the defect on a line); build.good is the safe twin.
  const add = (topic, exp, desc, file, build) => {
    const key = `ai-${topic}`
    expect[key] = exp
    const X = (text) => d(key, desc, text)
    out[`ai-${topic}`] = { files: { [file]: build.bad(X), 'package.json': pkg(`ai-${topic}`), ...tidy(`ai-${topic}`) }, absent: [], history: [] }
    out[`ai-${topic}-clean`] = { files: { [file]: build.good, 'package.json': pkg(`ai-${topic}-clean`), ...tidy(`ai-${topic}-clean`) }, absent: [], history: [] }
  }

  // A live-looking key used as the fallback default of an env lookup.
  add('env-fallback-key', 'secrets-plus/stripe-live-secret-key', 'a live payment key used as the fallback default of an environment lookup', 'src/config.js', {
    bad: (X) => ['// Payment settings, read from the environment.', X(`const stripeKey = process.env.STRIPE_SECRET_KEY || '${S.stripe}'`), 'module.exports = { stripeKey }', ''],
    good: ['// Payment settings, read from the environment.', 'const stripeKey = process.env.STRIPE_SECRET_KEY', "if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is not set')", 'module.exports = { stripeKey }', ''],
  })

  // jwt.decode used where jwt.verify is needed.
  add('jwt-decode-auth', 'jwt-weak', 'jwt.decode used as the sign-in check instead of jwt.verify', 'src/auth.js', {
    bad: (X) => ["const jwt = require('jsonwebtoken')", '', 'function requireUser(req, res, next) {', "  const token = (req.headers.authorization || '').replace('Bearer ', '')", '  // Read the user out of the token.', X('  const claims = jwt.decode(token)'), '  if (!claims) return res.sendStatus(401)', '  req.user = claims', '  next()', '}', 'module.exports = { requireUser }', ''],
    good: ["const jwt = require('jsonwebtoken')", '', 'function requireUser(req, res, next) {', "  const token = (req.headers.authorization || '').replace('Bearer ', '')", '  try {', '    req.user = jwt.verify(token, process.env.JWT_SECRET)', '    next()', '  } catch (err) {', '    res.sendStatus(401)', '  }', '}', 'module.exports = { requireUser }', ''],
  })

  // TLS verification switched off in a fetch helper.
  add('tls-verify-off', 'risky-code', 'TLS certificate verification switched off in an HTTP helper', 'src/http-client.js', {
    bad: (X) => ["const https = require('https')", '', '// Shared agent for calls to the partner API.', 'const agent = new https.Agent({', X('  rejectUnauthorized: false,'), '})', 'module.exports = { agent }', ''],
    good: ["const https = require('https')", '', '// Shared agent for calls to the partner API.', 'const agent = new https.Agent({', '  rejectUnauthorized: true,', '})', 'module.exports = { agent }', ''],
  })

  // Math.random used for a password reset token.
  add('reset-token-random', 'weak-crypto-modes|risky-code', 'a password reset token made with Math.random', 'src/reset.js', {
    bad: (X) => ['// Create a one-time token for the password reset email.', 'function makeResetToken() {', X('  const token = Math.random().toString(36).slice(2)'), '  return token', '}', 'module.exports = { makeResetToken }', ''],
    good: ["const crypto = require('crypto')", '', '// Create a one-time token for the password reset email.', 'function makeResetToken() {', "  return crypto.randomBytes(32).toString('hex')", '}', 'module.exports = { makeResetToken }', ''],
  })

  // Open redirect from an unvalidated next parameter.
  add('login-next-redirect', 'open-redirect-pattern', 'redirect to an unvalidated next parameter after login', 'src/login.js', {
    bad: (X) => ['function afterLogin(req, res) {', '  // Send the user back to where they came from.', X('  res.redirect(req.query.next)'), '}', 'module.exports = { afterLogin }', ''],
    good: ['function afterLogin(req, res) {', '  // Send the user back to where they came from, but only inside this site.', "  const next = String(req.query.next || '/')", "  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/'", '  res.redirect(safe)', '}', 'module.exports = { afterLogin }', ''],
  })

  // Path traversal from a request parameter joined onto a base directory.
  add('download-path-join', 'path-traversal-pattern', 'a file path built from a request parameter with no normalisation', 'src/download.js', {
    bad: (X) => ["const fs = require('fs')", "const path = require('path')", '', 'function sendReport(req, res) {', X("  const body = fs.readFileSync(path.join(__dirname, 'reports', req.params.file))"), '  res.send(body)', '}', 'module.exports = { sendReport }', ''],
    good: ["const fs = require('fs')", "const path = require('path')", '', "const BASE = path.join(__dirname, 'reports')", '', 'function sendReport(req, res) {', '  const full = path.resolve(BASE, path.basename(req.params.file))', '  if (!full.startsWith(BASE + path.sep)) return res.sendStatus(400)', '  res.send(fs.readFileSync(full))', '}', 'module.exports = { sendReport }', ''],
  })

  // Swallowed error.
  add('swallowed-error', 'empty-catch', 'an empty catch block that swallows the error', 'src/sync.js', {
    bad: (X) => ['async function syncOrders(api, db) {', '  try {', '    const orders = await api.fetchOrders()', '    await db.saveAll(orders)', X('  } catch (e) {}'), '}', 'module.exports = { syncOrders }', ''],
    good: ['async function syncOrders(api, db, log) {', '  try {', '    const orders = await api.fetchOrders()', '    await db.saveAll(orders)', '  } catch (e) {', "    log.error('order sync failed', e)", '    throw e', '  }', '}', 'module.exports = { syncOrders }', ''],
  })

  // Promise chain with no catch on a fire-and-forget call.
  add('floating-promise', 'js-unhandled-promise', 'a promise chain with no catch', 'src/handler.js', {
    bad: (X) => ['function getUser(req, res) {', '  // Look the user up and send it back.', X('  load(req.params.id).then((u) => res.json(u))'), '}', 'module.exports = { getUser }', ''],
    good: ['function getUser(req, res) {', '  // Look the user up and send it back.', '  load(req.params.id)', '    .then((u) => res.json(u))', '    .catch(() => res.sendStatus(500))', '}', 'module.exports = { getUser }', ''],
  })

  // Deprecated Buffer constructor.
  add('new-buffer', 'cp-js', 'the deprecated new Buffer constructor with a number', 'src/buffer.js', {
    bad: (X) => ['function makeBuffer(size) {', X('  const buf = new Buffer(size)'), '  return buf', '}', 'module.exports = { makeBuffer }', ''],
    good: ['function makeBuffer(size) {', '  const buf = Buffer.alloc(size)', '  return buf', '}', 'module.exports = { makeBuffer }', ''],
  })

  // React dangerouslySetInnerHTML with unsanitised input.
  add('react-inner-html', 'risky-code', 'dangerouslySetInnerHTML fed with unsanitised comment text', 'src/Comment.jsx', {
    bad: (X) => ["import React from 'react'", '', 'export function Comment({ comment }) {', X('  return <div dangerouslySetInnerHTML={{ __html: comment.body }} />'), '}', ''],
    good: ["import React from 'react'", '', 'export function Comment({ comment }) {', '  return <div>{comment.body}</div>', '}', ''],
  })

  return { projects: out, expect }
}
