// Grown planted defects, EXTREME difficulty, part 1: defects that only show when SEVERAL files are read together (a helper in one file and its
// caller in another, a constant in one file and its use in a second, a setting in a config file and the code that depends on it).
// One planted line per key, in the file the check reports. Each project has a "-clean" twin whose files are identical except for the safe variant.
// Keys are prefixed `grow-extreme-`. File text uses plain template literals with no placeholders; the marker `@@` stands for the planted line.
// Case: { k, exp, desc, plant, files: { path: text }, bad, good, alt?: { path: text for the clean twin only } }  // tier: see the fragment file
// The tier of each key is in tools/accuracy-tier-fragments/grow-extreme.txt (key, impact, difficulty).

const lines = (s) => s.replace(/^\n/, '').split('\n')

const mk = (name, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`grow-extreme-${name}`) }
  const good = { ...tidy(`grow-extreme-${name}-clean`) }
  for (const c of cases) {
    const key = `grow-extreme-${c.k}`
    expect[key] = c.exp
    for (const [path, text] of Object.entries(c.files)) {
      if (path === c.plant) {
        const [pre, post = ''] = text.split('@@')
        bad[path] = [...lines(pre).slice(0, -1), d(key, c.desc, c.bad), ...lines(post.replace(/^\n/, '')), '', '', '', '', '']
        good[path] = [...lines(pre).slice(0, -1), c.good, ...lines(post.replace(/^\n/, '')), '']
      } else {
        bad[path] = lines(text)
        good[path] = lines(c.alt?.[path] ?? text)
      }
    }
  }
  return { projects: { [`grow-extreme-${name}`]: { files: bad }, [`grow-extreme-${name}-clean`]: { files: good } }, expect }
}

// One project per case, for checks that look at the whole project at once (versions, lockfiles).
const solo = (c, ctx, extra = {}) => mk(c.k, ctx, [{ ...c, files: { ...extra, ...c.files } }])

const FS = "const fs = require('fs')\nconst path = require('path')\n"

export function projects(ctx) {
  const parts = []

  // ---- 1. A helper that reads or writes a file from a name, in one file; the request data reaches it from a route in another ----
  parts.push(mk('path-hop', ctx, [
    { k: 'helper-readfile-route', exp: 'path-traversal-pattern', desc: 'an upload reader joins a folder and a name, and a route in another file passes req.params.file to it', plant: 'src/uploads/store.js',
      files: { 'src/uploads/store.js': FS + "const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'\nexports.readUpload = (name) => {\n@@\n}\n", 'src/routes/files.js': "const router = require('express').Router()\nconst { readUpload } = require('../uploads/store')\nrouter.get('/files/:file', (req, res) => {\n  res.type('text').send(readUpload(req.params.file))\n})\nmodule.exports = router\n" },
      bad: "  return fs.readFileSync(path.join(UPLOAD_DIR, name), 'utf8')", good: "  return fs.readFileSync(path.join(UPLOAD_DIR, path.basename(name)), 'utf8')" },
    { k: 'helper-stream-tainted-var', exp: 'path-traversal-pattern', desc: 'an invoice streaming helper takes a name, and a handler in another file passes it through a variable set from the query', plant: 'src/billing/invoice-files.js',
      files: { 'src/billing/invoice-files.js': "const fs = require('fs')\nconst path = require('path')\nconst INVOICE_DIR = './invoices'\nexports.streamInvoice = (id) => {\n@@\n}\n", 'src/billing/handlers.js': "const { streamInvoice } = require('./invoice-files')\nexports.download = (req, res) => {\n  const invoice = req.query.invoice\n  res.setHeader('Content-Type', 'application/pdf')\n  streamInvoice(invoice).pipe(res)\n}\n" },
      bad: "  return fs.createReadStream(INVOICE_DIR + '/' + id)", good: "  return fs.createReadStream(INVOICE_DIR + '/' + path.basename(id))" },
    { k: 'helper-ts-template', exp: 'path-traversal-pattern', desc: 'a TypeScript template loader reads a name under a folder, and a controller in another file passes req.body.template', plant: 'src/mail/templates.ts',
      files: { 'src/mail/templates.ts': "import fs from 'fs'\nimport path from 'path'\nconst TEMPLATES = path.join(__dirname, 'html')\nexport function loadTemplate(name: string): string {\n@@\n}\n", 'src/mail/controller.ts': "import { loadTemplate } from './templates'\nexport function preview(req: any, res: any) {\n  res.send(loadTemplate(req.body.template))\n}\n" },
      bad: "  return fs.readFileSync(path.join(TEMPLATES, name), 'utf8')", good: "  return fs.readFileSync(path.join(TEMPLATES, path.basename(name)), 'utf8')" },
    { k: 'helper-writefile-attachment', exp: 'path-traversal-pattern', desc: 'an attachment saver writes under a folder using a file name, and a handler in another file passes the name from the body', plant: 'src/tickets/attachments.js',
      files: { 'src/tickets/attachments.js': FS + "const ATTACH_DIR = './attachments'\nexports.saveAttachment = (filename, data) => {\n@@\n}\n", 'src/tickets/upload-route.js': "const { saveAttachment } = require('./attachments')\nexports.upload = (req, res) => {\n  saveAttachment(req.body.filename, req.body.data)\n  res.sendStatus(201)\n}\n" },
      bad: "  fs.writeFileSync(path.join(ATTACH_DIR, filename), data)", good: "  fs.writeFileSync(path.join(ATTACH_DIR, path.basename(filename)), data)" },
    { k: 'helper-sendfile-second-arg', exp: 'path-traversal-pattern', desc: 'a report sender takes the response and a name and calls sendFile, and a route passes the query value as the second argument', plant: 'src/reports/send.js',
      files: { 'src/reports/send.js': "const path = require('path')\nconst REPORT_DIR = path.join(__dirname, 'out')\nexports.sendReport = (res, name) => {\n@@\n}\n", 'src/reports/route.js': "const { sendReport } = require('./send')\nmodule.exports = (app) => {\n  app.get('/reports/download', (req, res) => {\n    sendReport(res, req.query.report)\n  })\n}\n" },
      bad: "  return res.sendFile(path.join(REPORT_DIR, name))", good: "  return res.sendFile(path.join(REPORT_DIR, path.basename(name)))" },
    { k: 'helper-unlink-export', exp: 'path-traversal-pattern', desc: 'an export cleaner deletes a file by name and a route in another file passes the URL parameter', plant: 'src/exports/cleanup.js',
      files: { 'src/exports/cleanup.js': "const fs = require('fs')\nconst path = require('path')\nconst EXPORT_DIR = './exports/'\nexports.removeExport = (name) => {\n@@\n}\n", 'src/exports/routes.js': "const { removeExport } = require('./cleanup')\nexports.del = (req, res) => {\n  removeExport(req.params.name)\n  res.sendStatus(204)\n}\n" },
      bad: "  fs.unlinkSync(EXPORT_DIR + name)", good: "  fs.unlinkSync(EXPORT_DIR + path.basename(name))" },
    { k: 'helper-readdir-folder', exp: 'path-traversal-pattern', desc: 'a folder lister reads a directory under a root and a route in another file passes the query value', plant: 'src/files/browse.js',
      files: { 'src/files/browse.js': FS + "const ROOT = '/srv/shared'\nexports.listFolder = (dir) => {\n@@\n}\n", 'src/files/browse-route.js': "const { listFolder } = require('./browse')\nexports.index = (req, res) => {\n  res.json(listFolder(req.query.dir))\n}\n" },
      bad: "  return fs.readdirSync(path.join(ROOT, dir))", good: "  return fs.readdirSync(path.join(ROOT, path.basename(dir)))" },
    { k: 'helper-promises-koa', exp: 'path-traversal-pattern', desc: 'a log reader awaits fs.promises.readFile on a name and a Koa handler in another file passes ctx.query.file', plant: 'src/logs/reader.js',
      files: { 'src/logs/reader.js': "const fs = require('fs')\nconst path = require('path')\nconst LOG_DIR = '/var/log/app/'\nexports.readLog = async (file) => {\n@@\n}\n", 'src/logs/koa-handler.js': "const { readLog } = require('./reader')\nmodule.exports = async (ctx) => {\n  ctx.body = await readLog(ctx.query.file)\n}\n" },
      bad: "  return fs.promises.readFile(LOG_DIR + file, 'utf8')", good: "  return fs.promises.readFile(LOG_DIR + path.basename(file), 'utf8')" },
    { k: 'helper-python-open', exp: 'path-traversal-pattern', desc: 'a Python helper opens a file under a folder from a name, and a Flask view in another file passes request.args', plant: 'app/attachments.py',
      files: { 'app/attachments.py': "import os\nBASE = '/srv/attachments'\n\n\ndef read_attachment(name):\n@@\n", 'app/views.py': "from flask import request\nfrom .attachments import read_attachment\n\n\ndef show():\n    return read_attachment(request.args.get('file'))\n" },
      bad: "    return open(os.path.join(BASE, name)).read()", good: "    return open(os.path.join(BASE, os.path.basename(name))).read()" },
  ]))

  // ---- 2. A list of accepted token algorithms in one file that names "none", used by a verify call in another ----
  parts.push(mk('jwt-alg-list', ctx, [
    { k: 'alg-http-middleware', exp: 'jwt-weak', desc: 'the accepted algorithm list names none in the auth config, and the HTTP middleware verifies with that list', plant: 'src/auth/algorithms.js',
      files: { 'src/auth/algorithms.js': "// Algorithms the API accepts.\n@@\nmodule.exports = { acceptedAlgorithms }\n", 'src/auth/middleware.js': "const jwt = require('jsonwebtoken')\nconst { acceptedAlgorithms } = require('./algorithms')\nmodule.exports = (req, res, next) => {\n  const token = String(req.headers.authorization || '').slice(7)\n  req.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: acceptedAlgorithms })\n  next()\n}\n" },
      bad: "const acceptedAlgorithms = ['HS256', 'none']", good: "const acceptedAlgorithms = ['HS256']" },
    { k: 'alg-socket-handshake', exp: 'jwt-weak', desc: 'a socket module keeps its accepted algorithm list with none in it, and the handshake file verifies with that list', plant: 'src/realtime/socket-config.js',
      files: { 'src/realtime/socket-config.js': "@@\nexports.socketAlgorithms = socketAlgorithms\n", 'src/realtime/handshake.js': "const jwt = require('jsonwebtoken')\nconst { socketAlgorithms } = require('./socket-config')\nmodule.exports = (socket, next) => {\n  try {\n    socket.user = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET, { algorithms: socketAlgorithms })\n    next()\n  } catch (e) {\n    next(new Error('unauthorised'))\n  }\n}\n" },
      bad: "const socketAlgorithms = ['HS256', 'HS384', 'none']", good: "const socketAlgorithms = ['HS256', 'HS384']" },
    { k: 'alg-graphql-context', exp: 'jwt-weak', desc: 'GraphQL settings accept none among the token algorithms, and the context builder verifies with that list', plant: 'src/graphql/settings.js',
      files: { 'src/graphql/settings.js': "module.exports.settings = { introspection: false }\n@@\nmodule.exports.gqlAlgorithms = gqlAlgorithms\n", 'src/graphql/context.js': "const jwt = require('jsonwebtoken')\nconst gqlAlgorithms = require('./settings').gqlAlgorithms\nexports.context = ({ req }) => {\n  const raw = req.headers.authorization || ''\n  const user = raw ? jwt.verify(raw.replace('Bearer ', ''), process.env.JWT_SECRET, { algorithms: gqlAlgorithms }) : null\n  return { user }\n}\n" },
      bad: "const gqlAlgorithms = ['HS256', 'none']", good: "const gqlAlgorithms = ['HS256']" },
    { k: 'alg-webhook-signature', exp: 'jwt-weak', desc: 'the webhook module lists none as an allowed signing algorithm, and the receiver verifies signed payloads with it', plant: 'src/webhooks/signing.js',
      files: { 'src/webhooks/signing.js': "exports.HEADER = 'x-signature'\n@@\nexports.webhookAlgorithms = webhookAlgorithms\n", 'src/webhooks/receive.js': "const jwt = require('jsonwebtoken')\nconst { webhookAlgorithms } = require('./signing')\nexports.receive = (req, res) => {\n  const body = jwt.verify(req.body.payload, process.env.WEBHOOK_KEY, { algorithms: webhookAlgorithms })\n  res.json({ received: body.id })\n}\n" },
      bad: "const webhookAlgorithms = ['RS256', 'none']", good: "const webhookAlgorithms = ['RS256']" },
    { k: 'alg-refresh-route', exp: 'jwt-weak', desc: 'a TypeScript constants file lists none for refresh tokens, and the refresh route verifies with that list', plant: 'src/auth/refresh-constants.ts',
      files: { 'src/auth/refresh-constants.ts': "export const REFRESH_DAYS = 14\n@@\n", 'src/auth/refresh.ts': "import jwt from 'jsonwebtoken'\nimport { refreshAlgorithms } from './refresh-constants'\nexport function refresh(token: string) {\n  const claims = jwt.verify(token, process.env.REFRESH_SECRET as string, { algorithms: refreshAlgorithms })\n  return claims\n}\n" },
      bad: "export const refreshAlgorithms = ['HS256', 'none']", good: "export const refreshAlgorithms = ['HS256']" },
    { k: 'alg-service-to-service', exp: 'jwt-weak', desc: 'a service client config allows none among accepted algorithms, and the internal API guard verifies with the list', plant: 'src/internal/trust.js',
      files: { 'src/internal/trust.js': "exports.ISSUER = 'https://auth.internal'\n@@\nexports.serviceAlgorithms = serviceAlgorithms\n", 'src/internal/guard.js': "const jwt = require('jsonwebtoken')\nconst { serviceAlgorithms, ISSUER } = require('./trust')\nexports.guard = (req, res, next) => {\n  const claims = jwt.verify(req.get('x-service-token'), process.env.SERVICE_KEY, { algorithms: serviceAlgorithms, issuer: ISSUER })\n  req.service = claims.sub\n  next()\n}\n" },
      bad: "const serviceAlgorithms = ['ES256', 'none']", good: "const serviceAlgorithms = ['ES256']" },
  ]))

  // ---- 3. CORS: origin left open in one file and credentials switched on in another ----
  parts.push(mk('cors-split', ctx, [
    { k: 'cors-options-express', exp: 'cors-wildcard', desc: 'the CORS options object allows every origin, and the server file sets credentials on that object', plant: 'src/server/cors-options.js',
      files: { 'src/server/cors-options.js': "const cors = require('cors')\n@@\nmodule.exports = { corsOptions, cors }\n", 'src/server/app.js': "const express = require('express')\nconst { corsOptions, cors } = require('./cors-options')\ncorsOptions.credentials = true\nconst app = express()\napp.use(cors(corsOptions))\nmodule.exports = app\n" },
      bad: "const corsOptions = { origin: true, methods: ['GET', 'POST'] }", good: "const corsOptions = { origin: 'https://app.northwind.dev', methods: ['GET', 'POST'] }" },
    { k: 'cors-options-admin-star', exp: 'cors-wildcard', desc: 'the admin CORS options allow a star origin, and the bootstrap file turns credentials on', plant: 'src/admin/cors.js',
      files: { 'src/admin/cors.js': "@@\nexports.adminCors = adminCors\n", 'src/admin/bootstrap.js': "const cors = require('cors')\nconst { adminCors } = require('./cors')\nadminCors.credentials = true\nmodule.exports = (app) => app.use('/admin', cors(adminCors))\n" },
      bad: "const adminCors = { origin: '*', methods: ['GET', 'PUT', 'DELETE'] }", good: "const adminCors = { origin: 'https://admin.northwind.dev', methods: ['GET', 'PUT', 'DELETE'] }" },
    { k: 'cors-options-socket', exp: 'cors-wildcard', desc: 'the socket CORS options allow every origin, and the server file sets credentials on them', plant: 'src/realtime/cors.js',
      files: { 'src/realtime/cors.js': "@@\nexports.socketCors = socketCors\n", 'src/realtime/server.js': "const { Server } = require('socket.io')\nconst { socketCors } = require('./cors')\nsocketCors.credentials = true\nmodule.exports = (http) => new Server(http, { cors: socketCors })\n" },
      bad: "const socketCors = { origin: true }", good: "const socketCors = { origin: 'https://live.northwind.dev' }" },
    { k: 'cors-options-fastify', exp: 'cors-wildcard', desc: 'the API CORS options allow every origin, and the plugin file sets credentials on them before registering', plant: 'src/api/cors-config.js',
      files: { 'src/api/cors-config.js': "@@\nexports.apiCors = apiCors\n", 'src/api/plugins.js': "const { apiCors } = require('./cors-config')\napiCors.credentials = true\nmodule.exports = async (fastify) => {\n  await fastify.register(require('@fastify/cors'), apiCors)\n}\n" },
      bad: "const apiCors = { origin: true, maxAge: 600 }", good: "const apiCors = { origin: 'https://api-clients.northwind.dev', maxAge: 600 }" },
  ]))

  // ---- 4. CORS: the Allow-Origin value comes from a helper in another file that copies the caller origin ----
  parts.push(mk('cors-helper', ctx, [
    { k: 'cors-origin-helper-setheader', exp: 'cors-wildcard', desc: 'a response header takes its value from a helper in another file that returns the request origin', plant: 'src/http/headers.js',
      files: { 'src/http/headers.js': "const { pickOrigin } = require('./origins')\nexports.addCors = (req, res) => {\n@@\n}\n", 'src/http/origins.js': "exports.pickOrigin = (req) => req.headers.origin\n" },
      bad: "  res.setHeader('Access-Control-Allow-Origin', pickOrigin(req))", good: "  res.setHeader('Access-Control-Allow-Origin', pickOrigin(req))",
      alt: { 'src/http/origins.js': "exports.pickOrigin = (req) => (['https://app.northwind.dev'].includes(req.headers.origin) ? req.headers.origin : 'https://app.northwind.dev')\n" } },
    { k: 'cors-origin-helper-koa', exp: 'cors-wildcard', desc: 'a Koa middleware sets the Allow-Origin header from a helper in another file that echoes ctx origin', plant: 'src/koa/cors-mw.js',
      files: { 'src/koa/cors-mw.js': "const { originFor } = require('./origin-for')\nmodule.exports = async (ctx, next) => {\n@@\n  await next()\n}\n", 'src/koa/origin-for.js': "exports.originFor = (ctx) => ctx.request.header.origin\n" },
      bad: "  ctx.set('Access-Control-Allow-Origin', originFor(ctx))", good: "  ctx.set('Access-Control-Allow-Origin', originFor(ctx))",
      alt: { 'src/koa/origin-for.js': "exports.originFor = (ctx) => (['https://shop.northwind.dev'].includes(ctx.request.header.origin) ? ctx.request.header.origin : 'https://shop.northwind.dev')\n" } },
    { k: 'cors-origin-helper-writehead', exp: 'cors-wildcard', desc: 'a raw writeHead call gets Allow-Origin from a helper in another file that returns the request origin header', plant: 'src/raw/preflight.js',
      files: { 'src/raw/preflight.js': "const { allowedOrigin } = require('./allow')\nexports.preflight = (req, res) => {\n@@\n  res.end()\n}\n", 'src/raw/allow.js': "exports.allowedOrigin = (req) => req.headers.origin || ''\n" },
      bad: "  res.writeHead(204, { 'Access-Control-Allow-Origin': allowedOrigin(req), 'Access-Control-Allow-Credentials': 'true' })", good: "  res.writeHead(204, { 'Access-Control-Allow-Origin': allowedOrigin(req), 'Access-Control-Allow-Credentials': 'true' })",
      alt: { 'src/raw/allow.js': "const ALLOWED = ['https://pay.northwind.dev']\nexports.allowedOrigin = (req) => (ALLOWED.includes(req.headers.origin) ? req.headers.origin : ALLOWED[0])\n" } },
    { k: 'cors-origin-helper-ts', exp: 'cors-wildcard', desc: 'a TypeScript handler sets Allow-Origin from a helper in another file that returns the request origin', plant: 'src/edge/respond.ts',
      files: { 'src/edge/respond.ts': "import { resolveOrigin } from './resolve-origin'\nexport function respond(req: any, res: any, body: unknown) {\n@@\n  res.json(body)\n}\n", 'src/edge/resolve-origin.ts': "export const resolveOrigin = (req: any) => req.headers.origin\n" },
      bad: "  res.setHeader('Access-Control-Allow-Origin', resolveOrigin(req))", good: "  res.setHeader('Access-Control-Allow-Origin', resolveOrigin(req))",
      alt: { 'src/edge/resolve-origin.ts': "const ALLOWED = ['https://edge.northwind.dev']\nexport const resolveOrigin = (req: any) => (ALLOWED.includes(req.headers.origin) ? req.headers.origin : ALLOWED[0])\n" } },
  ]))

  // ---- 5. A redirect helper in one file; the target comes from the request in another ----
  parts.push(mk('redirect-hop', ctx, [
    { k: 'redirect-helper-next-param', exp: 'open-redirect-pattern', desc: 'a goTo helper redirects to its second argument and the login route in another file passes req.query.next', plant: 'src/nav/go.js',
      files: { 'src/nav/go.js': "exports.goTo = (res, target) => {\n@@\n}\n", 'src/nav/login-route.js': "const { goTo } = require('./go')\nexports.afterLogin = (req, res) => {\n  goTo(res, req.query.next)\n}\n" },
      bad: "  return res.redirect(target)", good: "  return res.redirect(target.startsWith('/') && !target.startsWith('//') ? target : '/home')" },
    { k: 'redirect-helper-returnto-var', exp: 'open-redirect-pattern', desc: 'a helper redirects to the address it is given and a callback route passes a variable set from the query', plant: 'src/auth/redirects.js',
      files: { 'src/auth/redirects.js': "exports.sendBack = (res, url) => {\n@@\n}\n", 'src/auth/callback.js': "const { sendBack } = require('./redirects')\nexports.callback = (req, res) => {\n  const returnTo = req.query.returnTo\n  sendBack(res, returnTo)\n}\n" },
      bad: "  res.status(302).redirect(url)", good: "  res.status(302).redirect(url.startsWith('/') && !url.startsWith('//') ? url : '/')" },
    { k: 'redirect-helper-ts-forward', exp: 'open-redirect-pattern', desc: 'a TypeScript helper redirects to its argument and a route in another file passes req.query.url', plant: 'src/links/forward.ts',
      files: { 'src/links/forward.ts': "export function forward(res: any, where: string) {\n@@\n}\n", 'src/links/short-route.ts': "import { forward } from './forward'\nexport function follow(req: any, res: any) {\n  forward(res, req.query.url as string)\n}\n" },
      bad: "  res.redirect(where)", good: "  res.redirect(where.startsWith('/') && !where.startsWith('//') ? where : '/')" },
    { k: 'redirect-helper-body-field', exp: 'open-redirect-pattern', desc: 'a payment helper redirects to a return address and the checkout route in another file passes req.body.returnUrl', plant: 'src/pay/finish.js',
      files: { 'src/pay/finish.js': "exports.finish = (res, returnUrl) => {\n@@\n}\n", 'src/pay/checkout-route.js': "const { finish } = require('./finish')\nexports.confirm = async (req, res) => {\n  await charge(req.body)\n  finish(res, req.body.returnUrl)\n}\n" },
      bad: "  res.redirect(returnUrl)", good: "  res.redirect(returnUrl.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/orders')" },
  ]))

  // ---- 6. A helper that returns the error stack or message, used in a response by another file ----
  parts.push(mk('error-hop', ctx, [
    { k: 'errhelper-stack-json', exp: 'error-leak', desc: 'a describeError helper returns err.stack and a route in another file sends its result in the response body', plant: 'src/errors/describe.js',
      files: { 'src/errors/describe.js': "exports.describeError = (err) => {\n@@\n}\n", 'src/routes/orders.js': "const { describeError } = require('../errors/describe')\nmodule.exports = async (req, res) => {\n  try {\n    res.json(await loadOrders(req.user))\n  } catch (e) {\n    res.status(500).json({ detail: describeError(e) })\n  }\n}\n" },
      bad: "  return err.stack", good: "  return 'internal error'" },
    { k: 'errhelper-message-send', exp: 'error-leak', desc: 'a reason helper returns err.message and a handler in another file sends its result to the client', plant: 'src/errors/reason.js',
      files: { 'src/errors/reason.js': "const reason = (e) => {\n@@\n}\nexports.reason = reason\n", 'src/routes/profile.js': "const { reason } = require('../errors/reason')\nmodule.exports = async (req, res) => {\n  try {\n    res.json(await loadProfile(req.user))\n  } catch (err) {\n    res.status(500).send(reason(err))\n  }\n}\n" },
      bad: "  return e.message", good: "  return 'profile unavailable'" },
    { k: 'errhelper-ts-problem', exp: 'error-leak', desc: 'a TypeScript problem builder returns the error stack and a handler in another file sends it as the detail', plant: 'src/http/problem.ts',
      files: { 'src/http/problem.ts': "export function problemDetail(error: Error) {\n@@\n}\n", 'src/http/handler.ts': "import { problemDetail } from './problem'\nexport async function handle(req: any, res: any) {\n  try {\n    res.json(await run(req))\n  } catch (e) {\n    res.status(500).json({ title: 'failed', detail: problemDetail(e as Error) })\n  }\n}\n" },
      bad: "  return error.stack", good: "  return 'request failed'" },
  ]))

  // ---- 7. One project per case: facts that must agree across several files ----
  const nodeBase = (n) => ({
    '.nvmrc': n + '\n',
    'package.json': '{\n  "name": "grow-extreme-node",\n  "version": "1.0.0",\n  "private": true,\n  "license": "MIT",\n  "engines": { "node": ">=' + n + '" }\n}\n',
    'Dockerfile': 'FROM node:' + n + '-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "index.js"]\n',
    '.github/workflows/ci.yml': 'name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ' + n + '\n      - run: npm test\n',
  })
  const nodeCases = [
    { k: 'node-docker-old', desc: 'the Dockerfile builds on an older Node than the version file, the engines range and the workflow', plant: 'Dockerfile', bad: 'FROM node:16-alpine', good: 'FROM node:20-alpine', pre: 'FROM node:20-alpine' },
    { k: 'node-workflow-old', desc: 'the CI workflow tests on an older Node than the version file, the engines range and the Dockerfile', plant: '.github/workflows/ci.yml', bad: '          node-version: 16', good: '          node-version: 20', pre: '          node-version: 20' },
    { k: 'node-nvmrc-old', desc: 'the version file pins an older Node than the engines range, the Dockerfile and the workflow', plant: '.nvmrc', bad: '16', good: '20', pre: '20' },
  ]
  for (const c of nodeCases) {
    const base = nodeBase(20)
    const text = base[c.plant]
    const at = text.indexOf(c.pre)
    const marked = text.slice(0, at) + '@@' + text.slice(at + c.pre.length)
    parts.push(solo({ k: c.k, exp: 'node-version-mismatch', desc: c.desc, plant: c.plant, bad: c.bad, good: c.good, files: { ...base, [c.plant]: marked } }, ctx))
  }

  const lock = (deps) => JSON.stringify({ name: 'grow-extreme-lock', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'grow-extreme-lock', version: '1.0.0', dependencies: deps }, ...Object.fromEntries(Object.entries(deps).map(([n, r]) => [`node_modules/${n}`, { version: r.replace(/^\D*/, ''), license: 'MIT' }])) } }, null, 2) + '\n'
  parts.push(solo({ k: 'lock-missing-dependency', exp: 'lockfile-in-sync', desc: 'package.json lists a payment SDK that the lockfile does not record', plant: 'package.json', bad: '    "stripe": "^14.5.0",', good: '    "stripe": "^14.5.0",',
    files: { 'package.json': '{\n  "name": "grow-extreme-lock",\n  "version": "1.0.0",\n  "private": true,\n  "license": "MIT",\n  "dependencies": {\n@@\n    "express": "^4.19.2"\n  }\n}\n', 'package-lock.json': lock({ express: '^4.19.2' }), 'index.js': "const express = require('express')\nconst stripe = require('stripe')\nmodule.exports = { express, stripe }\n" },
    alt: { 'package-lock.json': lock({ express: '^4.19.2', stripe: '^14.5.0' }) } }, ctx))
  parts.push(solo({ k: 'lock-removed-dependency', exp: 'lockfile-in-sync', desc: 'the lockfile still records a package that package.json no longer lists', plant: 'package.json', bad: '    "express": "^4.19.2"', good: '    "express": "^4.19.2"',
    files: { 'package.json': '{\n  "name": "grow-extreme-lock",\n  "version": "1.0.0",\n  "private": true,\n  "license": "MIT",\n  "dependencies": {\n@@\n  }\n}\n', 'package-lock.json': lock({ express: '^4.19.2', lodash: '^4.17.21' }), 'index.js': "module.exports = require('express')\n" },
    alt: { 'package-lock.json': lock({ express: '^4.19.2' }) } }, ctx))

  parts.push(mk('workflow-chain', ctx, [
    { k: 'reusable-missing-deploy', exp: 'github-actions-reusable', desc: 'a release workflow calls a local reusable deploy workflow that is not in the repository', plant: '.github/workflows/release.yml',
      files: { '.github/workflows/release.yml': "name: release\non:\n  push:\n    tags: ['v*']\njobs:\n  deploy:\n@@\n    secrets: inherit\n", '.github/workflows/ci.yml': "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n" },
      bad: '    uses: ./.github/workflows/deploy.yml', good: '    uses: ./.github/workflows/ci.yml' },
    { k: 'reusable-missing-build', exp: 'github-actions-reusable', desc: 'a nightly workflow calls a local build workflow whose file name has a typo', plant: '.github/workflows/nightly.yml',
      files: { '.github/workflows/nightly.yml': "name: nightly\non:\n  schedule:\n    - cron: '0 3 * * *'\njobs:\n  build:\n@@\n", '.github/workflows/build-reuseable.yml': "name: build\non: workflow_call\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n" },
      bad: '    uses: ./.github/workflows/build-reusable.yml', good: '    uses: ./.github/workflows/build-reuseable.yml' },
  ]))

  // ---- 8. Environment variables and imports that cross files ----
  parts.push(mk('env-service', ctx, [
    { k: 'env-read-in-service', exp: 'env-example', desc: 'a payments service reads a webhook secret variable that the example environment file does not list', plant: 'src/payments/webhook.js',
      files: { 'src/payments/webhook.js': "@@\nexports.verify = (sig, body) => sign(body, WEBHOOK_SIGNING_KEY) === sig\n", '.env.example': "DATABASE_URL=\nPORT=3000\n" },
      bad: "const WEBHOOK_SIGNING_KEY = process.env.PAYMENT_WEBHOOK_SIGNING_KEY", good: "const WEBHOOK_SIGNING_KEY = process.env.PAYMENT_WEBHOOK_SIGNING_KEY",
      alt: { '.env.example': "DATABASE_URL=\nPORT=3000\nPAYMENT_WEBHOOK_SIGNING_KEY=\n" } },
  ]))
  parts.push(mk('env-queue', ctx, [
    { k: 'env-read-in-queue-config', exp: 'env-example', desc: 'a queue config module reads a broker password variable that the example environment file does not list', plant: 'src/queue/config.js',
      files: { 'src/queue/config.js': "@@\nmodule.exports = { brokerUrl: process.env.QUEUE_BROKER_URL, brokerPassword }\n", '.env.example': "DATABASE_URL=\nPORT=3000\nQUEUE_BROKER_URL=\n" },
      bad: "const brokerPassword = process.env.QUEUE_BROKER_PASSWORD", good: "const brokerPassword = process.env.QUEUE_BROKER_PASSWORD",
      alt: { '.env.example': "DATABASE_URL=\nPORT=3000\nQUEUE_BROKER_URL=\nQUEUE_BROKER_PASSWORD=\n" } },
  ]))
  parts.push(mk('import-moved', ctx, [
    { k: 'import-moved-module', exp: 'broken-imports', desc: 'a route imports a helper from a path left behind when the helper moved into a utils folder', plant: 'src/routes/invoices.js',
      files: { 'src/routes/invoices.js': "@@\nmodule.exports = (req, res) => res.json({ total: formatMoney(req.body.total) })\n", 'src/utils/money.js': "exports.formatMoney = (n) => n.toFixed(2)\n" },
      bad: "const { formatMoney } = require('../lib/money')", good: "const { formatMoney } = require('../utils/money')" },
  ]))

  return {
    projects: Object.assign({}, ...parts.map((p) => p.projects)),
    expect: Object.assign({}, ...parts.map((p) => p.expect)),
  }
}
