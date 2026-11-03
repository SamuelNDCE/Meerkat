// Hard planted defects, family: authz (sign-in and session handling that spans two files). Only the shapes an existing check can report
// are planted here; the missing-middleware, IDOR and role-check shapes have no check yet and are listed as gaps in the block report.
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
    ['authz-jwt-decode-middleware', 'jwt-weak', 'the auth middleware sets req.user from jwt.decode, which skips the signature, and the admin routes trust it', {
      'src/middleware/auth.js': ["const jwt = require('jsonwebtoken')", 'module.exports = (req, res, next) => {', "  const token = (req.get('authorization') || '').replace('Bearer ', '')", ['  req.user = jwt.decode(token)', '  req.user = jwt.verify(token, process.env.JWT_SECRET)', 'x'], '  if (!req.user) return res.sendStatus(401)', '  next()', '}'],
      'src/routes/admin.js': ["const auth = require('../middleware/auth')", "module.exports = (app) => app.delete('/admin/users/:id', auth, (req, res) => res.sendStatus(req.user.role === 'admin' ? 204 : 403))"],
    }],
    ['authz-cookie-helper', 'cookie-flags', 'a cookie helper in one file sets any cookie with only the options its callers pass, and the login route passes none', {
      'src/lib/cookies.js': [['exports.set = (res, name, value, opts = {}) => res.cookie(name, value, opts)', "exports.set = (res, name, value, opts = {}) => res.cookie(name, value, { httpOnly: true, secure: true, sameSite: 'strict', ...opts })", 'x']],
      'src/routes/session.js': ["const cookies = require('../lib/cookies')", "module.exports = (app) => app.post('/session', (req, res) => { cookies.set(res, 'sid', req.sessionID); res.sendStatus(204) })"],
    }],
    ['authz-oauth-return-redirect', 'open-redirect-pattern', 'the return address is stored in the session from a query value in one route and used for a redirect in the callback route', {
      'src/routes/oauth-start.js': ["module.exports = (app) => app.get('/oauth/start', (req, res) => {", '  req.session.returnTo = req.query.next', "  res.redirect('/oauth/provider')", '})'],
      'src/routes/oauth-callback.js': ["module.exports = (app) => app.get('/oauth/callback', (req, res) => {", ['  const to = req.session.returnTo', '  const to = req.session.returnTo', 'y'], ['  res.redirect(to)', "  res.redirect(typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? to : '/')", 'x'], '})'],
    }],
  ]
  return mk('authz', ctx, cases)
}
