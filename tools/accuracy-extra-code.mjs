// Extra planted defects for the code-pattern, security-code, risky-code and secrets rules: VARIANT forms of the common mistakes
// (renamed and destructured imports, multi-line calls, template literals, f-strings, other quoting). Loaded by tools/accuracy-corpus.mjs
// (see docs/accuracy.md, "Extra planted-defect modules"). The sample text is written in a small blob format so the code can be read as code:
//   == path/in/project            starts a file; lines before the first ### are plain context lines
//   ### key | check-or-check/rule|alt | description     starts a defect; the lines after it (up to the next marker) are its text
// In the text, § stands for a backtick and @{ for ${ (so this source needs no escaping). Every defect gets five blank lines after it, so
// one defect's detection cannot be explained by its neighbour.
const JS = 'cp-js|risky-code'
const BLOB = String.raw`
== src/js/exec-aliases-1.js
const { exec } = require('child_process')
function ping(host) {
  exec(§ping -c 1 @{host}§, (err, out) => console.log(out))
}
== src/js/exec-aliases-2.mjs
import { exec as run } from 'node:child_process'
export function lookup(name) {
  return run('nslookup ' + name)
}
== src/js/exec-aliases-3.js
const util = require('util')
const cp = require('child_process')
const sh = util.promisify(cp.exec)
async function backup(dir) {
  await sh('tar czf out.tgz ' + dir)
}
== src/js/exec-aliases-4.ts
import * as proc from 'child_process'
export function size(path: string) {
  return proc.execSync(§du -sh @{path}§).toString()
}
== src/js/injection.js
const cp = require('child_process')
const vm = require('vm')
const fs = require('fs')
const crypto = require('crypto')
const https = require('https')
const path = require('path')
### v-js-exec-multiline | cp-js|risky-code | exec with the command on the next line
cp.exec(
  'convert ' + req.query.file + ' out.png',
  cb
)
### v-js-exec-sync-template | cp-js|risky-code | execSync with a template literal
const listing = cp.execSync(§ls -la @{req.body.dir}§).toString()
### v-js-spawn-shell-multiline | cp-js|risky-code | spawn with shell true on a second line
cp.spawn('git', ['log', branch], {
  shell: true,
})
### v-js-eval-spaced | risky-code|cp-js | eval with a space before the parenthesis
const out = eval (req.body.expr)
### v-js-eval-indirect | risky-code|cp-js | indirect eval through window
const val = window.eval(userInput)
### v-js-eval-multiline | risky-code|cp-js | eval whose argument is on the next line
const answer = eval(
  req.query.formula
)
### v-js-newfunction | risky-code | new Function built from request data
const fn = new Function('a', req.body.code)
### v-js-newfunction-spaced | risky-code | Function constructor called without new
const fn2 = Function('return ' + userInput)()
### v-js-innerhtml-template | risky-code|cp-js | innerHTML with a template literal
el.innerHTML = §<b>@{name}</b>§
### v-js-innerhtml-concat | risky-code|cp-js | innerHTML joined with text
box.innerHTML = '<p>' + comment + '</p>'
### v-js-outerhtml | risky-code|cp-js | outerHTML assignment
node.outerHTML = html
### v-js-insertadjacent | risky-code|cp-js | insertAdjacentHTML with a variable
list.insertAdjacentHTML('beforeend', item)
### v-js-document-write | risky-code|cp-js | document.write with a variable
document.write(markup)
### v-js-settimeout-string | cp-js|risky-code | setTimeout with a string
setTimeout('tick(' + n + ')', 100)
### v-js-vm-runinnewcontext | cp-js|risky-code | vm runs a variable
vm.runInNewContext(req.body.script, {})
### v-js-vm-compile | cp-js|risky-code | vm.compileFunction with a variable
const compiled = vm.compileFunction(source, ['a'])
### v-js-require-var | cp-js | require of a computed name
const plugin = require(§./plugins/@{req.query.name}§)
### v-js-require-concat | cp-js | require of a concatenated name
const handler = require('./handlers/' + type)
### v-js-fs-readfile-request | cp-js|path-traversal-pattern | readFile with a request path
fs.readFile(req.query.file, 'utf8', cb)
### v-js-fs-readfile-join | path-traversal-pattern|cp-js | readFile with path.join of a request value
fs.readFile(path.join(__dirname, 'uploads', req.params.name), cb)
### v-js-sendfile-multiline | path-traversal-pattern | sendFile with the request value on the next line
res.sendFile(
  req.query.name
)
### v-js-createreadstream | path-traversal-pattern|cp-js | createReadStream from the body
fs.createReadStream(req.body.path).pipe(res)
### v-js-md5-require | weak-crypto-modes|risky-code | md5 hash through createHash with double quotes
const digest = crypto.createHash("md5").update(password).digest('hex')
### v-js-sha1-multiline | risky-code|weak-crypto-modes | sha1 hash split over lines
const sig = crypto
  .createHash('sha1')
  .update(payload)
### v-js-createcipher | weak-crypto-modes | createCipher without an IV
const enc = crypto.createCipher('aes-256-cbc', secretPhrase)
### v-js-des | weak-crypto-modes | DES cipher through createCipheriv
const des = crypto.createCipheriv('des-ede3', key, iv)
### v-js-ecb | weak-crypto-modes | ECB mode named in createCipheriv
const ecb = crypto.createCipheriv('aes-128-ecb', key, null)
### v-js-math-random-token | weak-crypto-modes|risky-code | Math.random on the line after the name
const sessionToken =
  Math.random().toString(36).slice(2)
### v-js-math-random-fn | weak-crypto-modes|risky-code | Math.random inside a token function
function makeResetToken() {
  return Math.floor(Math.random() * 1e9)
}
### v-js-tls-off-env | risky-code | TLS checks off through the environment
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
### v-js-tls-off-agent | risky-code | https agent that skips verification
const agent = new https.Agent({ rejectUnauthorized: false })
### v-js-tls-off-multiline | risky-code | rejectUnauthorized false on its own line
const opts = {
  host: 'api.example.com',
  rejectUnauthorized: false,
}
### v-js-sql-template | sql-concat | SQL with a template literal
db.query(§SELECT * FROM users WHERE name = '@{req.body.name}'§)
### v-js-sql-concat-multiline | sql-concat | SQL concatenated over two lines
const rows = await pool.query('SELECT * FROM orders WHERE user_id = ' +
  req.params.id)
### v-js-sql-template-multiline | sql-concat | SQL template literal over lines
db.query(§
  DELETE FROM sessions
  WHERE token = '@{token}'
§)
### v-js-sql-variable | sql-concat | SQL assigned to a variable first
const sql = "UPDATE users SET role = '" + role + "' WHERE id = " + id
### v-js-redirect-multiline | open-redirect-pattern | redirect to a request value on the next line
res.redirect(
  req.query.next
)
### v-js-redirect-location | open-redirect-pattern | Location header from the request
res.setHeader('Location', req.query.url)
### v-js-redirect-body | open-redirect-pattern|cp-js | redirect to a body value
res.redirect(302, req.body.returnTo)
### v-js-window-location | open-redirect-pattern|risky-code|cp-js | location assigned from the query string
window.location = new URLSearchParams(location.search).get('next')
### v-js-yaml-full | cp-js | js-yaml loaded with the full schema
const cfg = yaml.load(text, { schema: yaml.DEFAULT_FULL_SCHEMA })
### v-js-node-serialize | cp-js | node-serialize unserialize
const obj = serialize.unserialize(req.cookies.profile)
### v-js-new-buffer | cp-js | new Buffer with a number
const buf = new Buffer(size)
### v-js-cors-reflect | cors-wildcard | CORS reflects the request origin
res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
### v-js-cors-star-header | cors-wildcard | CORS star set through a header call
res.header("Access-Control-Allow-Origin", "*")
res.header("Access-Control-Allow-Credentials", "true")
### v-js-cookie-no-flags | cookie-flags | cookie set without flags
res.cookie('sid', sessionId)
### v-js-jwt-hardcoded | jwt-weak | JWT signed with a literal secret
const t = jwt.sign({ id: user.id }, 'changeme')
### v-js-jwt-none | jwt-weak | JWT verified with the none algorithm allowed
jwt.verify(token, key, { algorithms: ['none'] })
== src/py/subprocess-aliases-1.py
import subprocess as sp
def listing(path):
    return sp.run("ls -l " + path, shell=True, capture_output=True)
== src/py/subprocess-aliases-2.py
from subprocess import call as invoke
def clean(directory):
    invoke("rm -rf " + directory, shell=True)
== src/py/subprocess-aliases-3.py
from os import system
def play(name):
    system("afplay " + name)
== src/py/subprocess-aliases-4.py
import os as operating
def wipe(folder):
    operating.system(f"rm -rf {folder}")
== src/py/variants.py
import os
import pickle
import random
import subprocess
import hashlib
import requests
import yaml
import tempfile
import ssl
### v-py-shell-true-multiline | risky-code|cp-python | shell=True on its own line
subprocess.Popen(
    cmd,
    shell=True,
)
### v-py-shell-true-fstring | risky-code|cp-python | check_output with an f-string and shell=True
out = subprocess.check_output(f"grep {term} {path}", shell=True)
### v-py-os-system-fstring | risky-code|cp-python | os.system with an f-string
os.system(f"convert {upload} out.png")
### v-py-os-popen | cp-python | os.popen with a variable
text = os.popen(command).read()
### v-py-eval-input | risky-code|cp-python | eval of request data
value = eval(request.args["expr"])
### v-py-exec-text | cp-python | exec of a variable
exec(snippet)
### v-py-pickle-loads | pickle-load|risky-code|cp-python | pickle.loads on data
obj = pickle.loads(blob)
### v-py-pickle-load-file | pickle-load|risky-code|cp-python | pickle.load on a file handle
state = pickle.load(open(path, 'rb'))
### v-py-yaml-load | risky-code|cp-python | yaml.load without a safe loader
conf = yaml.load(stream)
### v-py-yaml-load-multiline | risky-code|cp-python | yaml.load over two lines
conf = yaml.load(
    stream
)
### v-py-verify-false | risky-code|cp-python | requests with verify=False
r = requests.get(url, timeout=5, verify=False)
### v-py-verify-false-multiline | risky-code|cp-python | verify=False on its own line
r = requests.post(
    url,
    json=body,
    timeout=5,
    verify=False,
)
### v-py-ssl-unverified | cp-python|risky-code | unverified SSL context
ctx = ssl._create_unverified_context()
### v-py-md5-hexdigest | risky-code|cp-python|weak-crypto-modes | hashlib md5 of a password
h = hashlib.md5(password.encode()).hexdigest()
### v-py-sha1-new | risky-code|cp-python | hashlib.new with sha1 via sha1()
h = hashlib.sha1(data).hexdigest()
### v-py-sql-fstring | sql-concat|cp-python | execute with an f-string
cur.execute(f"SELECT * FROM users WHERE id = {user_id}")
### v-py-sql-percent | sql-concat|cp-python | execute with a percent format
cur.execute("SELECT * FROM users WHERE name = '%s'" % name)
### v-py-sql-format | sql-concat|cp-python | execute with str.format
cur.execute("DELETE FROM sessions WHERE token = '{}'".format(token))
### v-py-sql-concat-multiline | sql-concat|cp-python | SQL concatenated over lines
cur.execute("SELECT * FROM orders WHERE user_id = " +
            str(user_id))
### v-py-sql-variable | sql-concat|cp-python | SQL string built before the call
query = "SELECT * FROM users WHERE email = '" + email + "'"
### v-py-random-token | risky-code|weak-crypto-modes|cp-python | random.choice for a token
token = ''.join(random.choice('abcdef0123456789') for _ in range(32))
### v-py-random-otp | risky-code|weak-crypto-modes|cp-python | random.randint for a one time code
otp = random.randint(100000, 999999)
### v-py-random-fn | risky-code|weak-crypto-modes|cp-python | random in a function named for a session
def new_session_id():
    return str(random.getrandbits(64))
### v-py-mktemp | cp-python | tempfile.mktemp
name = tempfile.mktemp()
### v-py-flask-debug | debug-enabled|cp-python | app.run with debug True
app.run(host='127.0.0.1', debug=True)
### v-py-tmp-path | cp-python | fixed /tmp path
log = open('/tmp/service.log', 'w')
### v-py-bind-all | cp-python | server on all interfaces
app.run(host="0.0.0.0", port=8080)
### v-py-hardcoded-password | cp-python|secrets-plus | password typed into the code
db_password = "Tr0ub4dor&3x"
### v-py-requests-no-timeout-multiline | cp-python | requests call over lines without a timeout
r = requests.get(
    url,
    params={"q": term},
)
### v-py-flask-secret | cp-python|secrets-plus | Flask secret key typed in
app.secret_key = "super-secret-dev-key"
### v-py-assert-auth | py-assert-in-prod | assert used for authorisation
def delete_user(request, uid):
    assert request.user.is_staff
### v-py-assert-validate | py-assert-in-prod | assert on request input
assert request.form["amount"] != ""
### v-py-assert-token | py-assert-in-prod | assert that a token matches
assert token == expected_token
== src/go/variants.go
package main

import (
	"crypto/md5"
	"crypto/tls"
	"database/sql"
	"fmt"
	"net/http"
	"os/exec"
	"math/rand"
)
### v-go-sql-sprintf | cp-go|sql-concat | Sprintf into Query
rows, err := db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", id))
### v-go-sql-concat | cp-go|sql-concat | concatenation into Exec
_, err = db.Exec("DELETE FROM sessions WHERE token = '" + token + "'")
### v-go-sql-multiline | cp-go|sql-concat | Sprintf over lines
rows, err = db.Query(
	fmt.Sprintf("SELECT * FROM t WHERE name = '%s'", name),
)
### v-go-sql-variable | cp-go|sql-concat | query built before the call
q := fmt.Sprintf("SELECT * FROM users WHERE email = '%s'", email)
### v-go-exec-sh | cp-go | exec.Command sh -c
out, err := exec.Command("sh", "-c", "ls "+dir).Output()
### v-go-exec-var | cp-go | exec.Command with a variable program
cmd := exec.Command(program, args...)
### v-go-exec-bash-multiline | cp-go | bash -c over lines
cmd2 := exec.Command(
	"bash", "-c",
	userCmd,
)
### v-go-tls-skip | risky-code|cp-go | InsecureSkipVerify true
client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
### v-go-tls-skip-multiline | risky-code|cp-go | InsecureSkipVerify on its own line
cfg := &tls.Config{
	InsecureSkipVerify: true,
}
### v-go-md5 | cp-go | md5.Sum
sum := md5.Sum(data)
### v-go-math-rand-token | cp-go|weak-crypto-modes | math/rand intn for a token
token := fmt.Sprint(rand.Int63())
### v-go-http-get-var | cp-go | http.Get with a variable URL
resp, err := http.Get(target)
### v-go-listen | cp-go | ListenAndServe on all interfaces
http.ListenAndServe(":8080", nil)
### v-go-hardcoded-secret | cp-go|secrets-plus | secret typed in
apiToken := "s3cr3t-token-value-1234"
== src/java/Variants.java
import java.sql.*;
import java.security.*;
import java.util.*;
import java.io.*;
public class Variants {
### v-java-sql-concat-multiline | cp-java | SQL concatenated over lines
    void a(Statement st, String n) throws Exception {
        st.executeQuery("SELECT * FROM users WHERE name = '" +
            n + "'");
    }
### v-java-sql-format | sql-concat|cp-java|cp-dotnet-php-ruby | SQL built with String.format
    void b(Statement st, String id) throws Exception {
        st.executeQuery(String.format("SELECT * FROM users WHERE id = %s", id));
    }
### v-java-sql-variable | sql-concat|cp-java|cp-dotnet-php-ruby | SQL built into a variable
    void c(Statement st, String id) throws Exception {
        String q = "SELECT * FROM users WHERE id = " + id;
        st.executeQuery(q);
    }
### v-java-exec-string-array | cp-java | exec with a shell array
    void d(String cmd) throws Exception {
        Runtime.getRuntime().exec(new String[] {"sh", "-c", cmd});
    }
### v-java-exec-multiline | cp-java | exec with the command on the next line
    void e(String dir) throws Exception {
        Runtime.getRuntime().exec(
            "ls " + dir);
    }
### v-java-processbuilder | cp-java | ProcessBuilder with a variable
    void f(String tool) throws Exception {
        new ProcessBuilder(tool, "--version").start();
    }
### v-java-md5-single-quote-arg | cp-java | MessageDigest sha1 over lines
    byte[] g(byte[] d) throws Exception {
        return MessageDigest
            .getInstance("SHA-1")
            .digest(d);
    }
### v-java-random-token-field | cp-java | Random for a session id
    String sessionToken() {
        Random r = new Random();
        String sessionId = Long.toHexString(r.nextLong());
        return sessionId;
    }
### v-java-random-math | cp-java | Math.random for a reset code
    String resetCode() {
        return "" + (int) (Math.random() * 1000000);
    }
### v-java-ecb | cp-java|weak-crypto-modes | Cipher AES with default mode
    Object j() throws Exception {
        return Cipher.getInstance("AES");
    }
### v-java-des | weak-crypto-modes|cp-java | DES cipher
    Object k() throws Exception {
        return javax.crypto.Cipher.getInstance("DES/CBC/PKCS5Padding");
    }
### v-java-trust-all | cp-java | empty checkServerTrusted
    public void checkServerTrusted(java.security.cert.X509Certificate[] c, String a) {}
### v-java-hostname-verifier | cp-java | hostname verifier always true
    void l() {
        HttpsURLConnection.setDefaultHostnameVerifier((h, s) -> true);
    }
### v-java-deserialize-multiline | cp-java|xxe-and-deserialize | readObject on a second line
    Object m(InputStream in) throws Exception {
        ObjectInputStream ois = new ObjectInputStream(in);
        return ois.readObject();
    }
### v-java-xxe | cp-java|xxe-and-deserialize | DocumentBuilderFactory with defaults
    Object n() throws Exception {
        return javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder();
    }
### v-java-hardcoded-password | cp-java|secrets-plus | password in a string
    String password = "Hunter2Hunter2";
}
== src/cs/Variants.cs
using System.Diagnostics;
using System.Security.Cryptography;
class Variants
{
### v-cs-process-start-interp | cp-dotnet-php-ruby | Process.Start with an interpolated argument
    void A(string f) { Process.Start("explorer.exe", $"/select,{f}"); }
### v-cs-process-start-var | cp-dotnet-php-ruby | Process.Start with a variable program
    void B(string exe) { Process.Start(exe); }
### v-cs-processstartinfo | cp-dotnet-php-ruby | ProcessStartInfo with a concatenated argument string
    void C(string a) { var psi = new ProcessStartInfo("cmd.exe") { Arguments = "/c " + a }; Process.Start(psi); }
### v-cs-sql-interp | sql-concat|cp-java|cp-dotnet-php-ruby | SQL with string interpolation
    string D(string id) { return $"SELECT * FROM users WHERE id = {id}"; }
### v-cs-sql-concat-multiline | cp-dotnet-php-ruby | SQL concatenated over lines
    string E(string n) {
        return "SELECT * FROM users WHERE name = '" +
            n + "'";
    }
### v-cs-md5-create | cp-dotnet-php-ruby | MD5.Create
    object F() { return MD5.Create(); }
### v-cs-sha1-managed | cp-dotnet-php-ruby | SHA1Managed
    object G() { return new SHA1Managed(); }
### v-cs-random-token | cp-dotnet-php-ruby|weak-crypto-modes | System.Random for a token
    string H() { var resetToken = new System.Random().Next().ToString(); return resetToken; }
### v-cs-binaryformatter | cp-dotnet-php-ruby | BinaryFormatter
    object I(System.IO.Stream s) { return new BinaryFormatter().Deserialize(s); }
### v-cs-cert-callback | cp-dotnet-php-ruby | certificate callback lambda
    void J(System.Net.Http.HttpClientHandler h) { h.ServerCertificateCustomValidationCallback = (m, c, ch, e) => true; }
### v-cs-hardcoded-password | cp-dotnet-php-ruby|secrets-plus | password in code
    string password = "Hunter2Hunter2";
}
== src/php/variants.php
<?php
### v-php-eval | cp-dotnet-php-ruby | eval of request data
eval($_POST['code']);
### v-php-shell-exec | cp-dotnet-php-ruby | shell_exec with an interpolated string
$out = shell_exec("ping -c 1 $host");
### v-php-system-concat | cp-dotnet-php-ruby | system with a concatenation
system('ls ' . $_GET['dir']);
### v-php-backtick | cp-dotnet-php-ruby | backtick operator with a variable
$o = ` + "`" + String.raw`ls $dir` + "`" + String.raw`;
### v-php-sql-interp | cp-dotnet-php-ruby|sql-concat | double quoted SQL with interpolation
$r = mysqli_query($c, "SELECT * FROM users WHERE id = $id");
### v-php-sql-concat | cp-dotnet-php-ruby|sql-concat | SQL concatenated with a request value
$r2 = mysqli_query($c, "SELECT * FROM users WHERE name = '" . $_GET['name'] . "'");
### v-php-sql-multiline | cp-dotnet-php-ruby|sql-concat | SQL concatenated over lines
$q = "SELECT * FROM orders " .
     "WHERE user_id = " . $uid;
### v-php-unserialize | cp-dotnet-php-ruby | unserialize of a cookie
$o = unserialize($_COOKIE['data']);
### v-php-include | cp-dotnet-php-ruby | include of a request value
include($_GET['page'] . '.php');
### v-php-extract | cp-dotnet-php-ruby | extract of the request
extract($_REQUEST);
### v-php-md5-password | weak-crypto-modes|cp-dotnet-php-ruby | md5 of a password
$hash = md5($password);
### v-php-rand-token | cp-dotnet-php-ruby|weak-crypto-modes | mt_rand token
$token = md5(uniqid(mt_rand(), true));
### v-php-curl-verify | cp-dotnet-php-ruby | curl peer verification off
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, 0);
### v-php-file-from-request | cp-dotnet-php-ruby|path-traversal-pattern | readfile of a request value
readfile($_GET['file']);
### v-php-redirect | open-redirect-pattern | redirect from a request value
header('Location: ' . $_GET['next']);
== src/rb/variants.rb
require 'digest'
require 'yaml'
### v-rb-eval | cp-dotnet-php-ruby | eval of a parameter
eval(params[:expr])
### v-rb-system-backtick | cp-dotnet-php-ruby | backticks with interpolation
out = ` + "`" + String.raw`ls #{params[:dir]}` + "`" + String.raw`
### v-rb-exec-interp | cp-dotnet-php-ruby | exec with interpolation
exec("convert #{params[:file]} out.png")
### v-rb-open3 | cp-dotnet-php-ruby | Open3 with interpolation
Open3.capture2("grep #{term} log.txt")
### v-rb-send | cp-dotnet-php-ruby | public_send with params
record.public_send(params[:field])
### v-rb-constantize | cp-dotnet-php-ruby | constantize of a parameter
klass = params[:type].constantize
### v-rb-md5 | cp-dotnet-php-ruby | Digest::MD5
fp = Digest::MD5.hexdigest(body)
### v-rb-sha1 | cp-dotnet-php-ruby | Digest::SHA1
fp2 = Digest::SHA1.hexdigest(body)
### v-rb-random-token | cp-dotnet-php-ruby|weak-crypto-modes | rand for a token
reset_token = rand(1_000_000).to_s
### v-rb-marshal | cp-dotnet-php-ruby | Marshal.load of a cookie
data = Marshal.load(Base64.decode64(cookies[:state]))
### v-rb-yaml | cp-dotnet-php-ruby|xxe-and-deserialize | YAML.load of a parameter
cfg = YAML.load(params[:doc])
### v-rb-sql-interp | cp-dotnet-php-ruby|sql-concat | where with interpolation
User.where("name = '#{params[:name]}'")
### v-rb-html-safe | cp-dotnet-php-ruby | html_safe on a parameter
render html: params[:body].html_safe
### v-rb-open | cp-dotnet-php-ruby | open with a parameter
data = open(params[:url]).read
== rs/src/lib.rs
use std::process::Command;
### v-rs-command-format | cp-rust | Command::new with format!
fn a(dir: &str) { Command::new(&format!("ls {}", dir)).output().ok(); }
### v-rs-command-cmd | cp-rust | Command::new with a variable named cmd
fn b(cmd: &str) { Command::new(cmd).output().ok(); }
### v-rs-sql-format | cp-rust | execute with format!
fn c(conn: &Conn, id: &str) { conn.execute(&format!("DELETE FROM t WHERE id = {}", id), []).ok(); }
### v-rs-md5 | cp-rust | md5 compute
fn d(pw: &str) { let _x = md5::compute(pw); }
### v-rs-accept-invalid | cp-rust | invalid certs accepted
fn e() { reqwest::Client::builder().danger_accept_invalid_certs(true); }
### v-rs-unwrap | cp-rust | unwrap in library code
fn f(x: Option<u32>) -> u32 { x.unwrap() }
### v-rs-transmute | cp-rust | transmute
fn g(x: u32) -> f32 { unsafe { std::mem::transmute(x) } }
== src/ts/more.tsx
import { createHash } from 'crypto'
### v-ts-eval-template | risky-code|cp-js | eval of a template literal
const r = eval(§(@{expr})§)
### v-ts-innerhtml-as-any | risky-code|cp-js | innerHTML with a cast
(el as HTMLElement).innerHTML = body as string
### v-ts-dangerously | risky-code | dangerouslySetInnerHTML in a tsx
const view = <div dangerouslySetInnerHTML={{ __html: html }} />
### v-ts-md5-hash | risky-code|weak-crypto-modes | createHash md5 in TypeScript
const id = createHash('md5').update(name).digest('hex')
### v-ts-regex-dos | regex-dos | nested quantifier in a regex literal
const emailRe = /^([a-zA-Z0-9]+)+@example\.com$/
### v-ts-regex-dos-ctor | regex-dos | nested quantifier in new RegExp
const re2 = new RegExp('(\\w+\\s?)+$')
== lib/merge-variants.js
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object') {
      target[key] = deepMerge(target[key] || {}, source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}
function extend(dest, src) {
  Object.keys(src).forEach((k) => {
    dest[k] = src[k]
  })
  return dest
}
function assignDeep(obj, path, value) {
  const parts = path.split('.')
  let cur = obj
  for (const p of parts.slice(0, -1)) cur = cur[p] = cur[p] || {}
  cur[parts[parts.length - 1]] = value
}
`

// ---- expectations for the secrets suite (built at runtime from random parts: the tool's source holds no real-looking secret) ----
function secretFiles(ctx) {
  const { S } = ctx
  return {
    'config/settings.json': [
      '{',
      '  "region": "eu-west-1",',
      ctx.d('v-sec-json-aws', 'an AWS access key id in a JSON settings file', `  "accessKeyId": "${S.awsId}",`),
      '  "retries": 3',
      '}',
    ],
    'config/app.yaml': [
      'server:',
      '  port: 8080',
      'notify:',
      ctx.d('v-sec-yaml-slack', 'a Slack token in YAML', `  slack_token: ${S.slack}`),
      '  channel: "#ops"',
    ],
    'deploy/release.sh': [
      '#!/bin/sh',
      'set -e',
      ctx.d('v-sec-sh-export-github', 'a GitHub token exported in a shell script', `export GITHUB_TOKEN=${S.ghPat}`),
      'echo releasing',
      ctx.d('v-sec-sh-curl-bearer', 'a bearer token in a curl header', `curl -sS -H "Authorization: Bearer ${S.ghPat}" https://api.github.com/user`),
    ],
    'src/js/keys.js': [
      "'use strict'",
      'const config = {',
      '  aws: {',
      ctx.d('v-sec-js-aws-object', 'an AWS access key id inside a nested JavaScript object', `    accessKeyId: '${S.awsId}',`),
      ctx.d('v-sec-js-aws-secret-object', 'an AWS secret access key in the same object', `    secretAccessKey: '${S.awsSecret}',`),
      '  },',
      '}',
      ctx.d('v-sec-js-stripe-template', 'a Stripe live key in a template literal', `const stripe = require('stripe')(\`${S.stripe}\`)`),
      ctx.d('v-sec-js-sendgrid-double', 'a SendGrid key in double quotes', `sgMail.setApiKey("${S.sendgrid}")`),
      ctx.d('v-sec-js-google-key', 'a Google API key inside a URL', `const url = 'https://maps.googleapis.com/maps/api/geocode/json?key=${S.google}&address='`),
      ctx.d('v-sec-js-npm-concat', 'an npm token split over two strings joined by plus', `const npmToken = '${S.npm.slice(0, 12)}' + '${S.npm.slice(12)}'`),
      ctx.d('v-sec-js-jwt-header', 'a signed JWT used as an Authorization header', `headers.Authorization = 'Bearer ${S.jwt}'`),
      ctx.d('v-sec-js-discord', 'a Discord webhook URL', `const hook = '${S.discord}'`),
      ctx.d('v-sec-js-telegram', 'a Telegram bot token inside an API URL', `const api = 'https://api.telegram.org/bot${S.telegram}/sendMessage'`),
      ctx.d('v-sec-js-password-config', 'a database password in a config object', `const db = { host: 'db.internal', user: 'app', password: '${S.dbPass}' }`),
    ],
    'src/py/keys.py': [
      'import os',
      ctx.d('v-sec-py-aws-dict', 'an AWS access key id in a Python dict', `CREDS = {"aws_access_key_id": "${S.awsId}", "region": "eu-west-1"}`),
      ctx.d('v-sec-py-github-fstring', 'a GitHub token in an f-string URL', `REPO = f"https://x-access-token:${S.ghPat}@github.com/example/repo.git"`),
      ctx.d('v-sec-py-slack-webhook-token', 'a Slack bot token passed to a client', `client = WebClient(token="${S.slack}")`),
      ctx.d('v-sec-py-db-url', 'a Postgres URL with a password', `DATABASE_URL = "postgres://app:${S.dbPass}@db.internal:5432/app"`),
      ctx.d('v-sec-py-twilio', 'a Twilio API key SID', `TWILIO_KEY = "${S.twilio}"`),
    ],
    'src/go/keys.go': [
      'package main',
      ctx.d('v-sec-go-const', 'a Stripe key in a Go constant', `const stripeKey = "${S.stripe}"`),
      ctx.d('v-sec-go-aws', 'an AWS key id in a Go struct literal', `var creds = Creds{ID: "${S.awsId}"}`),
    ],
    'src/java/Keys.java': [
      'class Keys {',
      ctx.d('v-sec-java-github', 'a GitHub token in a Java string', `    static final String TOKEN = "${S.ghPat}";`),
      ctx.d('v-sec-java-shopify', 'a Shopify token in a Java string', `    static final String SHOP = "${S.shopify}";`),
      '}',
    ],
    'src/rb/keys.rb': [
      ctx.d('v-sec-rb-stripe', 'a Stripe key in a Ruby initializer', `Stripe.api_key = '${S.stripe}'`),
    ],
    'src/php/keys.php': [
      '<?php',
      ctx.d('v-sec-php-sendgrid', 'a SendGrid key in PHP', `$mail = new SendGrid("${S.sendgrid}");`),
    ],
    'app.properties': [
      'app.name=demo',
      ctx.d('v-sec-props-aws', 'an AWS access key id in a properties file', `aws.accessKeyId=${S.awsId}`),
      ctx.d('v-sec-props-password', 'a password in a properties file', `db.password=${S.dbPass}`),
    ],
    'Dockerfile.worker': [
      'FROM node:20.11.1-alpine3.19',
      ctx.d('v-sec-docker-env-token', 'a GitHub token in an ENV line', `ENV GITHUB_TOKEN=${S.ghPat}`),
      'USER node',
    ],
  }
}

// ---- parse the blob into project files ----
function parseBlob(ctx) {
  const files = {}
  const expect = {}
  let cur = null
  let def = null
  const flush = () => {
    if (!def) return
    while (def.lines.length && def.lines[def.lines.length - 1].trim() === '') def.lines.pop()
    const text = def.lines.join('\n').replace(/§/g, '`').replace(/@\{/g, '${')
    cur.push(ctx.d(def.key, def.desc, text))
    for (let i = 0; i < 5; i++) cur.push('')
    expect[def.key] = def.expect
    def = null
  }
  for (const line of BLOB.split('\n')) {
    if (line.startsWith('== ')) {
      flush()
      cur = files[line.slice(3).trim()] = []
    } else if (line.startsWith('### ')) {
      flush()
      const [key, expectation, desc] = line.slice(4).split(' | ')
      def = { key: key.trim(), expect: expectation.trim(), desc: desc.trim(), lines: [] }
    } else if (def) def.lines.push(line)
    else if (cur) cur.push(line.replace(/§/g, '`').replace(/@\{/g, '${'))
  }
  flush()
  // The alias files hold their dangerous call inside a plain context block: the first line of each is the planted line.
  const alias = {
    'src/js/exec-aliases-1.js': ['v-js-exec-alias-destructure', JS, 'exec taken by destructuring require and called with a template literal'],
    'src/js/exec-aliases-2.mjs': ['v-js-exec-alias-renamed', JS, 'exec imported under another name and called with concatenation'],
    'src/js/exec-aliases-3.js': ['v-js-exec-alias-promisify', JS, 'exec wrapped with promisify and called with concatenation'],
    'src/js/exec-aliases-4.ts': ['v-js-exec-alias-namespace', JS, 'execSync called through a namespace import'],
    'src/py/subprocess-aliases-1.py': ['v-py-subprocess-alias-module', 'risky-code|cp-python', 'subprocess imported under another name with shell=True'],
    'src/py/subprocess-aliases-2.py': ['v-py-subprocess-alias-func', 'risky-code|cp-python', 'subprocess.call imported under another name with shell=True'],
    'src/py/subprocess-aliases-3.py': ['v-py-os-system-from-import', 'risky-code|cp-python', 'os.system imported by name'],
    'src/py/subprocess-aliases-4.py': ['v-py-os-system-alias', 'risky-code|cp-python', 'os imported under another name, system with an f-string'],
  }
  for (const [path, [key, expectation, desc]] of Object.entries(alias)) {
    const lines = files[path]
    const text = lines.join('\n')
    files[path] = [ctx.d(key, desc, text), '']
    expect[key] = expectation
  }
  return { files, expect }
}

export function projects(ctx) {
  const { files, expect } = parseBlob(ctx)
  // The Java and C# files are class bodies: close the class after the last member, then every defect has its own member.
  files['src/java/Variants.java'].push('}')
  files['src/cs/Variants.cs'].push('}')
  const secrets = secretFiles(ctx)
  for (const k of Object.keys(secrets)) for (const it of secrets[k]) if (typeof it !== 'string') expect[it.key] = 'secrets-plus|secret-scan|sensitive-files'
  // One project per language family: a check prints at most 25 findings, so a project that plants more than that for one check would hide the rest.
  const groups = { 'variants-js': /^(src\/js|src\/ts|lib)\//, 'variants-py': /^src\/py\//, 'variants-go': /^src\/go\//, 'variants-java': /^src\/java\//, 'variants-cs': /^src\/cs\//, 'variants-php': /^src\/php\//, 'variants-rb-rs': /^src\/(rb|rs)\// }
  const out = {}
  for (const [name, re] of Object.entries(groups)) out[name] = { files: { ...ctx.tidy(name), ...Object.fromEntries(Object.entries(files).filter(([k]) => re.test(k))) } }
  out['variants-secrets'] = { files: { ...ctx.tidy('variants-secrets'), ...secrets } }
  return {
    projects: out,
    expect,
  }
}
