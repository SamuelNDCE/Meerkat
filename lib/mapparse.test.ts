// Per-file code map facts (lib/mapparse.mjs): purpose, symbols with line numbers, and routes for the recognised frameworks.
import { describe, expect, test } from 'vitest'
// @ts-expect-error plain .mjs module
import { extractPurpose, extractRoutes, extractSymbols } from './mapparse.mjs'

const routes = (path: string, text: string, lang: string, specs: string[]) => extractRoutes(path, text, lang, specs).routes.map((r: { method: string; path: string; line: number }) => `${r.method} ${r.path}:${r.line}`)

describe('routes', () => {
  test('express: method calls, a route chain, and nothing from strings, comments or cache lookups', () => {
    const t = ["import express from 'express'", '// app.get(\'/commented\', h)', "app.get('/ping', h)", 'const s = "app.get(\'/in-a-string\', x)"', "router.route('/u/:id').get(h).put(h2);", "cache.get('/key')", "app.post('/a/b', h)"].join('\n')
    expect(routes('s.js', t, 'javascript', ['express'])).toEqual(['GET /ping:3', 'GET /u/:id:5', 'PUT /u/:id:5', 'POST /a/b:7'])
  })
  test('no recognised framework import means no routes, and a seen-only framework is reported', () => {
    expect(routes('s.js', "app.get('/x', h)", 'javascript', [])).toEqual([])
    expect(extractRoutes('s.ts', "@Get('x')", 'typescript', ['@nestjs/common']).seenOnly).toEqual(['nestjs'])
  })
  test('fastify and hapi object form', () => {
    const t = "fastify.route({ method: ['GET', 'HEAD'], url: '/a', handler: h })\nserver.route({ method: 'POST', path: '/b' })"
    expect(routes('s.js', t, 'javascript', ['fastify'])).toEqual(['GET /a:1', 'HEAD /a:1', 'POST /b:2'])
  })
  test('test files are skipped', () => {
    expect(extractRoutes('a.test.js', "app.get('/x', h)", 'javascript', ['express'], { isTest: true }).routes).toEqual([])
  })
  test('Next.js app router, route groups and pages/api come from the file path', () => {
    expect(routes('app/(shop)/api/users/[id]/route.ts', 'export async function GET() {}\nexport const POST = async () => {}', 'typescript', [])).toEqual(['GET /api/users/[id]:1', 'POST /api/users/[id]:2'])
    expect(routes('src/app/about/page.tsx', 'export default function P() {}', 'typescript', [])).toEqual(['PAGE /about:1'])
    expect(routes('pages/api/hello.js', 'export default (req, res) => {}', 'javascript', [])).toEqual(['ANY /api/hello:1'])
  })
  test('flask and fastapi decorators', () => {
    const t = 'from flask import Flask\n@app.route("/x", methods=["GET", "POST"])\ndef x(): pass\n@app.get("/y")\ndef y(): pass'
    expect(routes('app.py', t, 'python', ['flask'])).toEqual(['GET /x:2', 'POST /x:2', 'GET /y:4'])
    expect(routes('main.py', '@router.post("/items")\nasync def a(): pass', 'python', ['fastapi'])).toEqual(['POST /items:1'])
  })
})

describe('purpose', () => {
  test('first sentence of a leading comment, after a shebang; licences and tool pragmas are not a purpose', () => {
    expect(extractPurpose('#!/usr/bin/env node\n// The front door. More text.\nimport x from "y"', 'javascript')).toBe('The front door.')
    expect(extractPurpose('/**\n * Parses things.\n * @param x\n */\nexport const a = 1', 'javascript')).toBe('Parses things.')
    expect(extractPurpose('// Copyright 2026 Someone\nexport const a = 1', 'javascript')).toBe(null)
    expect(extractPurpose('// eslint-disable no-console\nexport const a = 1', 'javascript')).toBe(null)
    expect(extractPurpose('export const a = 1\n// trailing', 'javascript')).toBe(null)
  })
  test('python module docstring or leading comment', () => {
    expect(extractPurpose('"""Does the thing.\n\nMore.\n"""\nimport os', 'python')).toBe('Does the thing.')
    expect(extractPurpose('# Helpers for x.\nimport os', 'python')).toBe('Helpers for x.')
    expect(extractPurpose('import os\n"""not first"""', 'python')).toBe(null)
  })
})

describe('symbols', () => {
  test('javascript functions, arrow constants, classes and methods with line numbers', () => {
    const t = 'export class A {\n  constructor(x) {\n    this.x = x\n  }\n  async run() {\n    if (this.x) {\n    }\n  }\n}\nexport const f = async (a) => a\nfunction g() {}\n'
    expect(extractSymbols(t, 'javascript').map((s: { name: string; kind: string; line: number; exported: boolean }) => `${s.exported ? '+' : ''}${s.name}:${s.kind}:${s.line}`)).toEqual(['+A:class:1', '+A.constructor:method:2', '+A.run:method:5', '+f:function:10', 'g:function:11'])
  })
  test('python functions, classes and methods', () => {
    const t = 'def a():\n    pass\nclass B:\n    def m(self):\n        pass\n    def _p(self): pass\nx = 1\n'
    expect(extractSymbols(t, 'python').map((s: { name: string; line: number }) => `${s.name}:${s.line}`)).toEqual(['a:1', 'B:3', 'B.m:4', 'B._p:6'])
  })
  test('code inside comments and strings is not a symbol', () => {
    expect(extractSymbols('// function fake() {}\nconst s = "function nope() {}"\n', 'javascript')).toEqual([])
  })
})
