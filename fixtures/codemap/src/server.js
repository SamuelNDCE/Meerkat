const http = require('http')
const { greet } = require('./util/greet')
const lazy = () => import('./util/math.js')
const dynamic = (name) => import(name)

module.exports = { start: () => http.createServer(), greet, lazy, dynamic }
