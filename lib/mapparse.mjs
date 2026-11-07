// Per-file facts for the code map (lib/codemap.mjs): functions and classes with line numbers, a one-line purpose, and web routes.
// Regular expressions over comment-masked text, like the rest of the map. Nothing is guessed: a purpose is only taken from a leading
// comment, a route only from a recognised framework, and a framework that is seen but not parsed is named so the reader knows.
import { maskJs, maskPy } from './codemap.mjs'

export const MAX_SYMBOLS_PER_FILE = 300
const MAX_PURPOSE = 140

// ---- purpose: the first sentence of a leading comment (or a Python module docstring) --------------------------------------------------

const NOT_PURPOSE = /^(?:copyright|\(c\)|licen[cs]e|spdx|@license|@ts-|eslint|prettier|istanbul|c8 |vim?:|-\*-|use strict|global |jshint|tslint|@flow|@jsx|!\/|region |#region|biome)/i

const tidy = (s) => s.replace(/\s+/g, ' ').trim()

function firstSentence(lines) {
  const text = tidy(lines.join(' '))
  if (!text || NOT_PURPOSE.test(text)) return null
  const dot = text.search(/[.!?](?:\s|$)/)
  const one = dot > 8 ? text.slice(0, dot + 1) : text
  return one.length > MAX_PURPOSE ? `${one.slice(0, MAX_PURPOSE - 3).trimEnd()}...` : one
}

export function extractPurpose(text, language) {
  const lines = text.split('\n').slice(0, 40)
  let i = 0
  while (i < lines.length && (/^\s*$/.test(lines[i]) || /^#!/.test(lines[i]) || /^\s*(['"])use strict\1;?\s*$/.test(lines[i]) || (language === 'python' && /^\s*#.*coding[:=]/.test(lines[i])))) i++
  if (i >= lines.length) return null
  const first = lines[i]
  if (language === 'python') {
    const doc = first.match(/^\s*[rRuUbB]?("""|''')(.*)$/)
    if (doc) {
      const q = doc[1]
      const body = []
      let rest = doc[2]
      for (let k = i; k < lines.length; k++) {
        const end = rest.indexOf(q)
        if (end >= 0) {
          body.push(rest.slice(0, end))
          break
        }
        body.push(rest)
        rest = lines[k + 1] ?? ''
        if (body.join('').trim() && !rest.trim()) break
      }
      return firstSentence(body)
    }
  }
  const block = []
  if (/^\s*\/\*/.test(first)) {
    for (let k = i; k < lines.length; k++) {
      const l = lines[k]
      const done = l.includes('*/')
      block.push(l.replace(/^\s*\/\*+!?/, '').replace(/\*\/.*$/, '').replace(/^\s*\*+\s?/, ''))
      if (done) break
    }
    return firstSentence(block.filter((l) => !/^\s*@\w/.test(l) || block.length === 1))
  }
  const marker = language === 'python' ? /^\s*#(?!!)\s?(.*)$/ : /^\s*\/\/\/?\s?(.*)$/
  for (let k = i; k < lines.length; k++) {
    const m = lines[k].match(marker)
    if (!m) break
    if (!m[1].trim() && block.length) break
    block.push(m[1])
  }
  // A comment that is followed straight away by an import, with a blank line before the code, still describes the file.
  return firstSentence(block)
}

// ---- symbols: functions, classes and methods with line numbers --------------------------------------------------------------------------

const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'with', 'function', 'await', 'new', 'throw', 'typeof', 'super', 'import', 'export'])

export function extractSymbols(text, language) {
  const masked = (language === 'python' ? maskPy(text) : maskJs(text)).split('\n')
  const out = []
  const add = (name, kind, line, exported, parent = null) => {
    if (out.length < MAX_SYMBOLS_PER_FILE) out.push({ name: parent ? `${parent}.${name}` : name, kind, line, exported })
  }
  if (language === 'python') {
    let cls = null
    for (let i = 0; i < masked.length; i++) {
      const l = masked[i]
      const top = l.match(/^(?:async[ \t]+def|def)[ \t]+([A-Za-z_]\w*)/)
      if (top) {
        cls = null
        add(top[1], 'function', i + 1, !top[1].startsWith('_'))
        continue
      }
      const c = l.match(/^class[ \t]+([A-Za-z_]\w*)/)
      if (c) {
        cls = c[1]
        add(c[1], 'class', i + 1, !c[1].startsWith('_'))
        continue
      }
      if (/^\S/.test(l) && !/^[ \t]*$/.test(l)) cls = null
      const m = cls && l.match(/^[ \t]+(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)/)
      if (m && /^(?: {4}|\t)\S|^(?: {4}|\t)(?:async|def)/.test(l)) add(m[1], 'method', i + 1, !m[1].startsWith('_') || m[1] === '__init__', cls)
    }
    return out
  }
  let cls = null
  for (let i = 0; i < masked.length; i++) {
    const l = masked[i]
    let m = l.match(/^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/)
    if (m) {
      cls = null
      add(m[2], 'function', i + 1, Boolean(m[1]))
      continue
    }
    m = l.match(/^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([\w$]+)/)
    if (m) {
      cls = m[2]
      add(m[2], 'class', i + 1, Boolean(m[1]))
      continue
    }
    m = l.match(/^(export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>|\(\s*$)/)
    if (m) {
      add(m[2], 'function', i + 1, Boolean(m[1]))
      continue
    }
    if (/^\S/.test(l) && !/^\s*$/.test(l)) {
      if (cls && /^}/.test(l)) cls = null
      continue
    }
    if (cls) {
      m = l.match(/^\s+(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([#\w$]+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^{]+)?\{\s*$/)
      if (m && !JS_KEYWORDS.has(m[1])) add(m[1], 'method', i + 1, !m[1].startsWith('#'), cls)
    }
  }
  return out
}

// ---- routes ------------------------------------------------------------------------------------------------------------------------------

const JS_METHODS = 'get|post|put|patch|delete|options|head|all'
const JS_METHOD_CALL = new RegExp(`\\.(${JS_METHODS})\\s*\\(`, 'g') // built once; matchAll copies it, so its position is never shared
const NOT_ROUTERS = new Set(['map', 'cache', 'store', 'headers', 'params', 'query', 'searchParams', 'req', 'res', 'request', 'response', 'ctx', 'storage', 'session', 'cookies', 'localStorage', 'sessionStorage', 'settings', 'config', 'env', 'axios', 'http', 'https', 'client', 'got', 'superagent', 'agent', 'fetcher', 'memo', 'registry', 'cookie', 'formData', 'form', 'data', 'meta', 'state', 'sp', 'url'])

// package name -> framework label, for the packages whose routes are parsed
const JS_ROUTED = { express: 'express', fastify: 'fastify', hono: 'hono', 'koa-router': 'koa-router', '@koa/router': 'koa-router', restify: 'restify', '@hapi/hapi': 'hapi', hapi: 'hapi', polka: 'polka', connect: 'connect' }
const JS_SEEN_ONLY = { '@nestjs/common': 'nestjs', '@nestjs/core': 'nestjs', koa: 'koa', h3: 'h3', elysia: 'elysia', '@trpc/server': 'trpc', sails: 'sails', '@remix-run/node': 'remix', '@sveltejs/kit': 'sveltekit', nuxt: 'nuxt' }
const PY_ROUTED = { flask: 'flask', quart: 'quart', fastapi: 'fastapi', sanic: 'sanic' }
const PY_SEEN_ONLY = { django: 'django', tornado: 'tornado', aiohttp: 'aiohttp', pyramid: 'pyramid', bottle: 'bottle', falcon: 'falcon' }

const pkgOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])

const lineAt = (text, offset) => {
  let n = 1
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) n++
  return n
}

const NEXT_METHODS = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|export\s+(?:const|let)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g

function nextRoutes(path, text) {
  const routes = []
  const app = path.match(/(?:^|\/)app\/((?:[^/]+\/)*)(route|page)\.[cm]?[jt]sx?$/)
  const clean = (dirs) => `/${dirs.split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@')).join('/')}`
  if (app && app[2] === 'route') {
    for (const m of text.matchAll(NEXT_METHODS)) routes.push({ method: m[1] ?? m[2], path: clean(app[1]), line: lineAt(text, m.index), framework: 'next-app-router' })
  } else if (app && app[2] === 'page') routes.push({ method: 'PAGE', path: clean(app[1]), line: 1, framework: 'next-app-router' })
  const api = path.match(/(?:^|\/)pages\/(api\/(?:[^/]+\/)*[^/]+)\.[cm]?[jt]sx?$/)
  if (api) routes.push({ method: 'ANY', path: `/${api[1].replace(/\/index$/, '')}`, line: 1, framework: 'next-pages-api' })
  return routes
}

// The text with the inside of every quoted string blanked, so a route that only appears inside a string (sample code held in a string) can be told from real code.
function blankStrings(masked) {
  let out = ''
  let i = 0
  while (i < masked.length) {
    const c = masked[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < masked.length && masked[j] !== c && masked[j] !== '\n') j += masked[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, masked.length)
      out += c + ' '.repeat(Math.max(0, j - i - 2)) + (j - i >= 2 ? masked[j - 1] : '')
      i = j
    } else {
      out += c
      i += 1
    }
  }
  return out
}

function jsRoutes(masked, framework) {
  const routes = []
  const code = blankStrings(masked)
  const inCode = (offset, len) => code.startsWith(masked.slice(offset, offset + len), offset)
  const push = (method, path, offset) => routes.push({ method: method.toUpperCase(), path, line: lineAt(masked, offset), framework })
  for (const m of masked.matchAll(new RegExp(`(?<![\\w$.])([A-Za-z_$][\\w$]*)\\.(${JS_METHODS})\\s*\\(\\s*(['"])(\\/[^'"\\n]*|\\*)\\3`, 'g'))) {
    if (!NOT_ROUTERS.has(m[1]) && inCode(m.index, m[1].length + 1 + m[2].length)) push(m[2], m[4], m.index)
  }
  for (const m of masked.matchAll(/\.route\s*\(\s*(['"])(\/[^'"\n]*)\1\s*\)/g)) {
    if (!inCode(m.index, 6)) continue
    const tail = masked.slice(m.index + m[0].length, m.index + m[0].length + 800)
    const stop = tail.search(/;|\n\s*\n/)
    const chain = stop >= 0 ? tail.slice(0, stop) : tail
    for (const c of chain.matchAll(JS_METHOD_CALL)) push(c[1], m[2], m.index + m[0].length + c.index)
  }
  for (const m of masked.matchAll(/\.route\s*\(\s*\{([^{}]{0,400})\}\s*\)/g)) {
    const url = m[1].match(/(?:url|path)\s*:\s*(['"])([^'"\n]+)\1/)
    const meth = m[1].match(/method\s*:\s*(\[[^\]]*\]|(['"])[A-Za-z]+\2)/)
    if (!url || !inCode(m.index, 6)) continue
    for (const x of meth ? [...meth[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((y) => y[1]) : ['ANY']) push(x, url[2], m.index)
  }
  return routes
}

function pyRoutes(text, framework) {
  const routes = []
  const re = /^[ \t]*@([A-Za-z_][\w.]*)\.(route|get|post|put|patch|delete|head|options|websocket)\(\s*(['"])([^'"\n]*)\3([^\n]*)/gm
  for (const m of text.matchAll(re)) {
    const line = lineAt(text, m.index)
    if (m[2] === 'route') {
      const meth = m[5].match(/methods\s*=\s*[\[(]([^\])]*)[\])]/)
      const list = meth ? [...meth[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => x[1].toUpperCase()) : ['GET']
      for (const x of list) routes.push({ method: x, path: m[4], line, framework })
    } else routes.push({ method: m[2].toUpperCase(), path: m[4], line, framework })
  }
  return routes
}

// specs: the import specifiers of the file. Returns { routes, frameworks (parsed), seenOnly (recognised but not parsed) }.
export function extractRoutes(path, text, language, specs, { isTest = false } = {}) {
  const none = { routes: [], frameworks: [], seenOnly: [] }
  if (isTest) return none
  const pkgs = new Set(specs.map((s) => (language === 'python' ? String(s).replace(/^\.+/, '').split('.')[0] : pkgOf(String(s)))))
  const table = language === 'python' ? PY_ROUTED : JS_ROUTED
  const seenTable = language === 'python' ? PY_SEEN_ONLY : JS_SEEN_ONLY
  const frameworks = [...new Set([...pkgs].filter((p) => table[p]).map((p) => table[p]))].sort()
  const seenOnly = [...new Set([...pkgs].filter((p) => seenTable[p]).map((p) => seenTable[p]))].sort()
  let routes = []
  if (language !== 'python') {
    routes = nextRoutes(path, text)
    if (frameworks.length) routes.push(...jsRoutes(maskJs(text), frameworks.join('+')))
  } else if (frameworks.length) routes = pyRoutes(text, frameworks.join('+'))
  const fw = new Set(frameworks)
  for (const r of routes) if (r.framework.startsWith('next')) fw.add(r.framework)
  routes.sort((a, b) => a.line - b.line || (a.method < b.method ? -1 : a.method > b.method ? 1 : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { routes, frameworks: [...fw].sort(), seenOnly }
}
