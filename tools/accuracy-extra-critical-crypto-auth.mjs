// Critical planted defects, family: crypto-and-auth. Forgeable tokens, guessable secrets and switched-off TLS verification, each
// exploitable remotely with no unusual precondition. One defect per file; the "-clean" twin project has the same files written
// safely and must not be reported. Keys and projects are prefixed `crit-`.

const mk = (fam, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`crit-${fam}`) }
  const good = { ...tidy(`crit-${fam}-clean`) }
  for (const [k, file, exp, desc, pre, badText, goodText] of cases) {
    expect[`crit-${k}`] = exp
    bad[file] = [pre, d(`crit-${k}`, desc, badText), '', '', '', '', '']
    good[file] = [pre, goodText, '']
  }
  return { projects: { [`crit-${fam}`]: { files: bad }, [`crit-${fam}-clean`]: { files: good } }, expect }
}

const JWT = "const jwt = require('jsonwebtoken')"
const CRY = "const crypto = require('crypto')"

export function projects(ctx) {
  const cases = [
    ['jwt-none-sign', 'src/jwt-none-sign.js', 'jwt-weak', 'a JWT signed with the none algorithm', JWT, "const t = jwt.sign({ id: user.id }, null, { algorithm: 'none' })", "const t = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { algorithm: 'HS256' })"],
    ['jwt-none-verify', 'src/jwt-none-verify.js', 'jwt-weak', 'a JWT verified with the none algorithm allowed', JWT, "jwt.verify(token, key, { algorithms: ['none'] })", "jwt.verify(token, key, { algorithms: ['RS256'] })"],
    ['jwt-literal-secret', 'src/jwt-literal.js', 'jwt-weak', 'a JWT signed with a literal secret', JWT, "const t = jwt.sign({ id: user.id }, 'changeme')", 'const t = jwt.sign({ id: user.id }, process.env.JWT_SECRET)'],
    ['rand-session', 'src/rand-session.js', 'weak-crypto-modes|risky-code', 'a session token made with Math.random', CRY, 'const token = Math.random().toString(36).slice(2)', "const token = crypto.randomBytes(32).toString('hex')"],
    ['rand-reset', 'src/rand-reset.js', 'weak-crypto-modes|risky-code', 'a password reset token made with Math.random', CRY, 'const resetToken = Math.random().toString(36).slice(2)', 'const resetToken = crypto.randomUUID()'],
    ['md5-password', 'src/md5-password.js', 'weak-crypto-modes|risky-code', 'a password stored as an MD5 hash', CRY, "const digest = crypto.createHash('md5').update(password).digest('hex')", "const digest = crypto.scryptSync(password, salt, 64).toString('hex')"],
    ['create-cipher', 'src/create-cipher.js', 'weak-crypto-modes', 'createCipher with a password and no IV', CRY, "const enc = crypto.createCipher('aes-256-cbc', secretPhrase)", "const enc = crypto.createCipheriv('aes-256-gcm', key, crypto.randomBytes(12))"],
    ['aes-ecb', 'src/aes-ecb.js', 'weak-crypto-modes', 'AES in ECB mode', CRY, "const ecb = crypto.createCipheriv('aes-128-ecb', key, null)", "const gcm = crypto.createCipheriv('aes-256-gcm', key, crypto.randomBytes(12))"],
    ['tls-env-off', 'src/tls-env.js', 'risky-code', 'TLS checks turned off through the environment', "'use strict'", "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'", "process.env.NODE_EXTRA_CA_CERTS = '/etc/ssl/internal-ca.pem'"],
    ['tls-agent-off', 'src/tls-agent.js', 'risky-code', 'an https agent that skips certificate verification', "const https = require('https')", 'const agent = new https.Agent({ rejectUnauthorized: false })', 'const agent = new https.Agent({ rejectUnauthorized: true })'],
    ['py-verify-false', 'src/fetch.py', 'risky-code|cp-python', 'requests with verify=False', 'import requests', 'r = requests.get(url, timeout=5, verify=False)', 'r = requests.get(url, timeout=5, verify=True)'],
    ['go-tls-skip', 'src/client.go', 'risky-code|cp-go', 'InsecureSkipVerify set to true', 'package main\n\nimport (\n\t"crypto/tls"\n\t"net/http"\n)', 'var client = &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}', 'var client = &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}}'],
    ['py-ssl-unverified', 'src/ctx.py', 'cp-python|risky-code', 'an unverified SSL context', 'import ssl', 'ctx = ssl._create_unverified_context()', 'ctx = ssl.create_default_context()'],
    ['cookie-no-flags', 'src/session.js', 'cookie-flags', 'a session cookie set without any flags', "const express = require('express')", "res.cookie('sid', sessionId)", "res.cookie('sid', sessionId, { httpOnly: true, secure: true, sameSite: 'strict' })"],
    ['py-md5-password', 'src/hash.py', 'risky-code|cp-python|weak-crypto-modes', 'a password hashed with MD5', 'import hashlib', 'digest = hashlib.md5(password.encode()).hexdigest()', 'digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1).hex()'],
  ]
  return mk('crypto-auth', ctx, cases)
}
