// False-alarm TRAPS, part 2: Go, Rust, Java, C#, PHP, Ruby, Kotlin, Swift and C/C++. Clean projects (names end in -clean) whose code LOOKS like a
// bug to a naive rule but is safe. No defect is planted: a trap passes when its named check raises no bug-severity finding on that file.
// The module also exports TRAPS (project, file, check, name) for tools/trap-lang-verify.mjs. Project names start with `trap-lang-`.
// Source text is written with § for a backtick and @{ for ${ so it can sit in a template literal.

const fix = (s) => s.replaceAll('§', '`').replaceAll('@{', '${')
export const TRAPS = []
const FILES = {}
const raw = String.raw

const add = (project, check, name, file, text) => {
  FILES[project] ??= {}
  if (FILES[project][file]) throw new Error(`trap-lang: ${project}/${file} written twice`)
  FILES[project][file] = [fix(text).replace(/^\n/, '')]
  TRAPS.push({ project: `trap-lang-${project}-clean`, file, check, name })
}

// ---------------------------------------------------------------------------------------------------------------------- Go
const G = 'go'
add(G, 'cp-go', 'secret-word-in-names-only', 'conf/labels.go', raw`
package conf

const passwordLabel = "Password"
const secretStoreName = "db-credentials"
`)
add(G, 'cp-go', 'listen-loopback', 'srv/local.go', raw`
package srv

import (
	"net"
	"net/http"
)

func Serve(mux *http.ServeMux) error {
	ln, err := net.Listen("tcp", "127.0.0.1:8080")
	if err != nil {
		return err
	}
	return (&http.Server{Handler: mux, ReadHeaderTimeout: 5e9}).Serve(ln)
}
`)
add(G, 'cp-go', 'ssh-known-hosts', 'deploy/ssh.go', raw`
package deploy

import "golang.org/x/crypto/ssh"

func Config(cb ssh.HostKeyCallback) *ssh.ClientConfig {
	return &ssh.ClientConfig{User: "deploy", HostKeyCallback: cb}
}
`)
add(G, 'cp-go', 'http-get-constant-url', 'health/ping.go', raw`
package health

import "net/http"

func Ping() (*http.Response, error) {
	return http.Get("https://status.example.com/ping")
}
`)
add(G, 'cp-go', 'pprof-behind-build-tag', 'cmd/debug_pprof.go', raw`
//go:build debugtools

package main

import (
	_ "net/http/pprof"
)
`)
add(G, 'cp-go', 'copy-limited-decompressor', 'pack/unpack.go', raw`
package pack

import (
	"compress/gzip"
	"io"
)

func Unzip(dst io.Writer, gz *gzip.Reader) (int64, error) {
	return io.Copy(dst, io.LimitReader(gz, 1<<20))
}
`)
add(G, 'cp-go', 'server-with-timeouts-multiline', 'srv/timeouts.go', raw`
package srv

import (
	"net/http"
	"time"
)

func New(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}
}
`)
add(G, 'cp-go', 'sql-table-from-allow-list', 'db/count.go', raw`
package db

import (
	"database/sql"
	"fmt"
)

var tables = map[string]string{"orders": "orders", "users": "users"}

func Count(db *sql.DB, name string) (n int, err error) {
	t, ok := tables[name]
	if !ok {
		return 0, fmt.Errorf("unknown table")
	}
	err = db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM %s", t)).Scan(&n)
	return
}
`)
add(G, 'cp-go', 'exec-constant-binary-name', 'vcs/git.go', raw`
package vcs

import "os/exec"

const gitBinary = "git"

func Status() ([]byte, error) {
	return exec.Command(gitBinary, "status", "--short").Output()
}
`)
add(G, 'cp-go', 'sh-c-constant-pipeline', 'ops/count.go', raw`
package ops

import "os/exec"

func Lines() ([]byte, error) {
	return exec.Command("sh", "-c", "ls | wc -l").Output()
}
`)
add(G, 'cp-go', 'owner-only-modes', 'out/write.go', raw`
package out

import "os"

func Save(path string, data []byte) error {
	return os.WriteFile(path, data, 0o600)
}

func Dir(path string) error {
	return os.MkdirAll(path, 0o750)
}
`)
add(G, 'cp-go', 'tempdir-api', 'out/tmp.go', raw`
package out

import "os"

func Scratch() (string, error) {
	return os.MkdirTemp("", "scratch-")
}
`)
add(G, 'cp-go', 'open-basename-in-fixed-dir', 'web/report.go', raw`
package web

import (
	"net/http"
	"os"
	"path/filepath"
)

func Report(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.FormValue("name"))
	f, err := os.Open(filepath.Join("/srv/reports", name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
}
`)
add(G, 'cp-go', 'zip-entry-checked-against-prefix', 'imp/zip.go', raw`
package imp

import (
	"archive/zip"
	"fmt"
	"path/filepath"
	"strings"
)

func Target(dest string, f *zip.File) (string, error) {
	target := filepath.Join(dest, f.Name)
	if !strings.HasPrefix(target, filepath.Clean(dest)+string(filepath.Separator)) {
		return "", fmt.Errorf("entry escapes the folder")
	}
	return target, nil
}
`)
add(G, 'cp-go', 'md5-etag-only', 'web/etag.go', raw`
package web

import (
	"crypto/md5"
	"encoding/hex"
)

// ETag for caching static files: a content fingerprint, not a security control.
func ETag(body []byte) string {
	sum := md5.Sum(body)
	return hex.EncodeToString(sum[:])
}
`)
add(G, 'cp-go', 'tls12-minimum', 'net/tlsconf.go', raw`
package net

import "crypto/tls"

func Config() *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS12}
}
`)
add(G, 'cp-go', 'rsa-4096', 'keys/rsa.go', raw`
package keys

import (
	"crypto/rand"
	"crypto/rsa"
)

func New() (*rsa.PrivateKey, error) {
	return rsa.GenerateKey(rand.Reader, 4096)
}
`)
add(G, 'cp-go', 'math-rand-for-jitter', 'retry/jitter.go', raw`
package retry

import (
	"math/rand"
	"time"
)

// Backoff jitter only spreads retries out; it protects nothing.
func Jitter(base time.Duration) time.Duration {
	return base + time.Duration(rand.Int63n(int64(base)))
}
`)
add(G, 'cp-go', 'aes-gcm-random-nonce', 'keys/aead.go', raw`
package keys

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
)

func Seal(key, data []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, data, nil), nil
}
`)
add(G, 'cp-go', 'sha1-git-object-id', 'vcs/blob.go', raw`
package vcs

import (
	"crypto/sha1"
	"fmt"
)

// A git blob id is defined as the SHA-1 of "blob <len>\x00<data>"; we compute it only to compare with git's own ids.
func BlobID(data []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(data))
	h.Write(data)
	return fmt.Sprintf("%x", h.Sum(nil))
}
`)
add(G, 'cp-go', 'cookie-secure-multiline', 'auth/cookie.go', raw`
package auth

import "net/http"

func Start(w http.ResponseWriter, sid string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    sid,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
}
`)
add(G, 'cp-go', 'cors-from-allow-list', 'api/cors.go', raw`
package api

import "net/http"

var allowed = map[string]bool{"https://app.example.com": true}

func CORS(w http.ResponseWriter, r *http.Request) {
	if o := r.Header.Get("Origin"); allowed[o] {
		w.Header().Set("Access-Control-Allow-Origin", o)
	}
}
`)
add(G, 'cp-go', 'template-html-constant', 'web/br.go', raw`
package web

import "html/template"

var LineBreak = template.HTML("<br>")
`)
add(G, 'go-ignored-errors', 'close-error-in-defer', 'io/close.go', raw`
package iox

import "os"

func Read(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	b := make([]byte, 16)
	n, err := f.Read(b)
	return b[:n], err
}
`)
add(G, 'go-defer-in-loop', 'defer-inside-func-literal', 'io/loop.go', raw`
package iox

import "os"

func Touch(paths []string) {
	for _, p := range paths {
		func() {
			f, err := os.Open(p)
			if err != nil {
				return
			}
			defer f.Close()
		}()
	}
}
`)
add(G, 'sql-concat', 'go-order-by-const', 'db/order.go', raw`
package db

import "database/sql"

func List(db *sql.DB) (*sql.Rows, error) {
	const order = " ORDER BY created_at DESC"
	return db.Query("SELECT id FROM users WHERE active = $1"+order, true)
}
`)
add(G, 'http-timeouts', 'go-client-with-timeout', 'net/client.go', raw`
package net

import (
	"net/http"
	"time"
)

var Client = &http.Client{Timeout: 10 * time.Second}
`)

// --------------------------------------------------------------------------------------------------------------------- Rust
const R = 'rust'
add(R, 'cp-rust', 'unsafe-with-safety-note-two-lines-up', 'src/ptr.rs', raw`
pub fn first(ptr: *const u8) -> u8 {
    // SAFETY: the caller guarantees ptr is non-null, aligned and points at a live byte.
    // The pointer is read exactly once.
    unsafe { *ptr }
}
`)
add(R, 'cp-rust', 'transmute-same-size-pod', 'src/bits.rs', raw`
pub fn word(bytes: [u8; 4]) -> u32 {
    // SAFETY: [u8; 4] and u32 have the same size and every bit pattern is a valid u32.
    unsafe { std::mem::transmute::<[u8; 4], u32>(bytes) }
}
`)
add(R, 'cp-rust', 'forget-after-into-raw', 'src/raw.rs', raw`
use std::os::fd::IntoRawFd;

pub fn leak_fd(file: std::fs::File) -> i32 {
    file.into_raw_fd()
}
`)
add(R, 'cp-rust', 'command-from-const', 'src/git.rs', raw`
use std::process::Command;

const GIT: &str = "git";

pub fn version() -> std::io::Result<std::process::Output> {
    Command::new(GIT).arg("--version").output()
}
`)
add(R, 'cp-rust', 'unwrap-in-test-module', 'src/lib.rs', raw`
pub fn double(x: i32) -> i32 {
    x * 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles() {
        let v: Result<i32, ()> = Ok(double(2));
        assert_eq!(v.unwrap(), 4);
    }
}
`)
add(R, 'cp-rust', 'certs-validated', 'src/http.rs', raw`
pub fn client() -> reqwest::Client {
    reqwest::Client::builder().danger_accept_invalid_certs(false).https_only(true).build().expect("client")
}
`)
add(R, 'cp-rust', 'md5-cache-key', 'src/cachekey.rs', raw`
// A cache key for build outputs: it only needs to differ for different inputs.
pub fn cache_key(blob: &[u8]) -> String {
    format!("{:x}", md5::compute(blob))
}
`)
add(R, 'cp-rust', 'thread-rng-for-jitter', 'src/jitter.rs', raw`
use rand::Rng;

pub fn jitter_ms() -> u64 {
    rand::thread_rng().gen_range(0..100)
}
`)
add(R, 'cp-rust', 'token-count-printed', 'src/count.rs', raw`
pub fn report(token_count: usize) {
    println!("tokens processed: {}", token_count);
}
`)
add(R, 'cp-rust', 'pragma-with-integer-constant', 'src/schema.rs', raw`
const VERSION: i64 = 3;

pub fn stamp(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute(&format!("PRAGMA user_version = {}", VERSION), [])?;
    Ok(())
}
`)
add(R, 'unsafe-rust', 'safety-note-above-attribute', 'src/attr.rs', raw`
pub fn peek(p: *const u32) -> u32 {
    // SAFETY: p was created from a reference one line earlier by every caller.
    #[allow(clippy::needless_return)]
    unsafe { *p }
}
`)
add(R, 'unsafe-rust', 'safety-note-doc-section', 'src/unsafefn.rs', raw`
/// Reads a byte.
///
/// # Safety
/// The pointer must be valid for reads and aligned.
pub unsafe fn read(p: *const u8) -> u8 {
    // SAFETY: guaranteed by the caller, see the section above.
    unsafe { *p }
}
`)
add(R, 'unsafe-rust', 'word-unsafe-in-comment', 'src/note.rs', raw`
// This module has no unsafe code at all; the word only appears here.
pub fn add(a: u32, b: u32) -> u32 {
    a + b
}
`)
add(R, 'rp-safety', 'static-mut-free-atomics', 'src/counter.rs', raw`
use std::sync::atomic::{AtomicUsize, Ordering};

static COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn bump() -> usize {
    COUNT.fetch_add(1, Ordering::Relaxed)
}
`)
add(R, 'rp-async', 'blocking-in-spawn-blocking', 'src/asyncio.rs', raw`
pub async fn read(path: std::path::PathBuf) -> std::io::Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || std::fs::read(path)).await.expect("join")
}
`)
add(R, 'rp-async', 'std-lock-released-before-await', 'src/lockawait.rs', raw`
use std::sync::Mutex;

pub async fn bump(m: &Mutex<u32>) -> u32 {
    let n = {
        let mut g = m.lock().unwrap_or_else(|e| e.into_inner());
        *g += 1;
        *g
    };
    tokio::task::yield_now().await;
    n
}
`)
add(R, 'rp-errors', 'expect-with-message', 'src/expect.rs', raw`
pub fn port() -> u16 {
    "8080".parse().expect("the constant 8080 is a valid port")
}
`)
add(R, 'rust-unwrap-overuse', 'unwrap-or-default-family', 'src/defaults.rs', raw`
pub fn read(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

pub fn first(v: &[u8]) -> u8 {
    v.first().copied().unwrap_or(0)
}
`)
add(R, 'rust-todo-macros', 'todo-word-in-string', 'src/words.rs', raw`
pub const HELP: &str = "use the todo! macro only in drafts";
`)
add(R, 'rp-cargo', 'cargo-pinned-versions', 'Cargo.toml', raw`
[package]
name = "trap-lang-rust-clean"
version = "0.1.0"
edition = "2021"
description = "a clean crate"
license = "MIT"
repository = "https://example.com/trap-lang-rust-clean"

[dependencies]
serde = "=1.0.200"
rand = { version = "=0.8.5", default-features = false }
`)
add(R, 'rp-api-ffi-wasm', 'ffi-documented-extern-c', 'src/ffi.rs', raw`
/// Adds two numbers for C callers.
#[no_mangle]
pub extern "C" fn trap_add(a: i32, b: i32) -> i32 {
    a.wrapping_add(b)
}
`)

// -------------------------------------------------------------------------------------------------------------------- Java
const J = 'java'
add(J, 'cp-java', 'exec-constant-command', 'src/Tool.java', raw`
import java.io.IOException;

public class Tool {
    void run() throws IOException {
        Runtime.getRuntime().exec("git --version");
    }
}
`)
add(J, 'cp-java', 'processbuilder-constant-args', 'src/Pdf.java', raw`
import java.io.IOException;

public class Pdf {
    void run() throws IOException {
        new ProcessBuilder("pdftotext", "-v").start();
    }
}
`)
add(J, 'cp-java', 'objectoutputstream-write-only', 'src/Save.java', raw`
import java.io.*;

public class Save {
    void save(Serializable o, OutputStream out) throws IOException {
        new ObjectOutputStream(out).writeObject(o);
    }
}
`)
add(J, 'cp-java', 'xml-factory-hardened', 'src/Xml.java', raw`
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

public class Xml {
    DocumentBuilderFactory factory() throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        return f;
    }
}
`)
add(J, 'cp-java', 'md5-file-checksum', 'src/Checksum.java', raw`
import java.security.MessageDigest;

public class Checksum {
    // dedupe key for uploaded files, not a security control
    byte[] of(byte[] data) throws Exception {
        return MessageDigest.getInstance("MD5").digest(data);
    }
}
`)
add(J, 'cp-java', 'cipher-gcm', 'src/Gcm.java', raw`
import javax.crypto.Cipher;

public class Gcm {
    Cipher make() throws Exception {
        return Cipher.getInstance("AES/GCM/NoPadding");
    }
}
`)
add(J, 'cp-java', 'trust-manager-delegates', 'src/Trust.java', raw`
import java.security.cert.*;
import javax.net.ssl.X509TrustManager;

public class Trust implements X509TrustManager {
    private final X509TrustManager inner;
    Trust(X509TrustManager inner) { this.inner = inner; }
    public void checkClientTrusted(X509Certificate[] c, String a) throws CertificateException { inner.checkClientTrusted(c, a); }
    public void checkServerTrusted(X509Certificate[] c, String a) throws CertificateException { inner.checkServerTrusted(c, a); }
    public X509Certificate[] getAcceptedIssuers() { return inner.getAcceptedIssuers(); }
}
`)
add(J, 'cp-java', 'hostname-verifier-real-check', 'src/Host.java', raw`
import javax.net.ssl.HttpsURLConnection;

public class Host {
    void setup() {
        HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> hostname.endsWith(".example.com"));
    }
}
`)
add(J, 'cp-java', 'random-for-shuffle', 'src/Shuffle.java', raw`
import java.util.*;

public class Shuffle {
    List<Integer> order(List<Integer> in) {
        List<Integer> copy = new ArrayList<>(in);
        Collections.shuffle(copy, new Random(42));
        return copy;
    }
}
`)
add(J, 'cp-java', 'password-word-in-names', 'src/Labels.java', raw`
public class Labels {
    static final String PASSWORD_LABEL = "Password";
    static final int PASSWORD_MIN = 12;
}
`)
add(J, 'cp-java', 'prepared-statement-with-order-constant', 'src/Users.java', raw`
import java.sql.*;

public class Users {
    private static final String ORDER = " ORDER BY created DESC";

    ResultSet active(Connection c) throws SQLException {
        PreparedStatement ps = c.prepareStatement("SELECT id FROM users WHERE active = ?" + ORDER);
        ps.setBoolean(1, true);
        return ps.executeQuery();
    }
}
`)
add(J, 'cp-java', 'file-under-base-with-normalize-check', 'src/Files.java', raw`
import java.io.File;
import javax.servlet.http.HttpServletRequest;

public class Files {
    File pick(HttpServletRequest request, File baseDir) throws Exception {
        File f = new File(baseDir, new File(request.getParameter("file")).getName());
        if (!f.getCanonicalPath().startsWith(baseDir.getCanonicalPath())) throw new SecurityException();
        return f;
    }
}
`)
add(J, 'cp-java', 'spel-constant-expression', 'src/Rule.java', raw`
import org.springframework.expression.spel.standard.SpelExpressionParser;

public class Rule {
    Object price(SpelExpressionParser parser) {
        return parser.parseExpression("basePrice * quantity").getValue();
    }
}
`)
add(J, 'cp-java', 'jndi-lookup-fixed-name', 'src/Ds.java', raw`
import javax.naming.*;

public class Ds {
    Object find(Context ctx) throws NamingException {
        return ctx.lookup("java:comp/env/jdbc/orders");
    }
}
`)
add(J, 'cp-java', 'log4shell-text-in-javadoc', 'src/Doc.java', raw`
public class Doc {
    /** Log lines never contain the lookup syntax; patterns like jndi are rejected by the filter. */
    String clean(String s) { return s.replace("$", ""); }
}
`)
add(J, 'cp-java', 'cookie-secure-true', 'src/Cookies.java', raw`
import javax.servlet.http.Cookie;

public class Cookies {
    Cookie make(String sid) {
        Cookie c = new Cookie("sid", sid);
        c.setSecure(true);
        c.setHttpOnly(true);
        return c;
    }
}
`)
add(J, 'cp-java', 'crossorigin-named-origin', 'src/Api.java', raw`
import org.springframework.web.bind.annotation.*;

public class Api {
    @CrossOrigin(origins = "https://desk.example.com")
    @GetMapping("/reports")
    public String list() { return "[]"; }
}
`)
add(J, 'cp-java', 'regex-constant', 'src/Pat.java', raw`
import java.util.regex.Pattern;

public class Pat {
    static final Pattern WORD = Pattern.compile("[a-z]{1,32}");
}
`)
add(J, 'cp-java', 'iv-from-securerandom', 'src/Iv.java', raw`
import java.security.SecureRandom;
import javax.crypto.spec.IvParameterSpec;

public class Iv {
    IvParameterSpec fresh() {
        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);
        return new IvParameterSpec(iv);
    }
}
`)
add(J, 'cp-java', 'ldap-filter-parameterised', 'src/Dir.java', raw`
public class Dir {
    static final String FILTER = "(uid={0})";
}
`)

// --------------------------------------------------------------------------------------------------------------------- C#
const C = 'csharp'
add(C, 'cp-dotnet-php-ruby', 'json-typenamehandling-none', 'Sync/Json.cs', raw`
using Newtonsoft.Json;

public static class Json
{
    public static void Setup(JsonSerializerSettings settings)
    {
        settings.TypeNameHandling = TypeNameHandling.None;
    }
}
`)
add(C, 'cp-dotnet-php-ruby', 'process-start-constant', 'Sync/Open.cs', raw`
using System.Diagnostics;

public static class Open
{
    public static void Notepad() => Process.Start("notepad.exe");
}
`)
add(C, 'cp-dotnet-php-ruby', 'md5-etag', 'Sync/Etag.cs', raw`
using System.Security.Cryptography;

public static class Etag
{
    // content fingerprint for caching, not a security control
    public static byte[] Of(byte[] body) => MD5.HashData(body);
}
`)
add(C, 'cp-dotnet-php-ruby', 'aes-cbc-random-iv', 'Sync/Aes.cs', raw`
using System.Security.Cryptography;

public static class AesBox
{
    public static Aes Make()
    {
        var aes = Aes.Create();
        aes.Mode = CipherMode.CBC;
        aes.GenerateIV();
        return aes;
    }
}
`)
add(C, 'cp-dotnet-php-ruby', 'random-for-layout', 'Sync/Layout.cs', raw`
using System;

public static class Layout
{
    public static int Offset() => new Random(7).Next(0, 10);
}
`)
add(C, 'cp-dotnet-php-ruby', 'sql-parameter-name-looks-concatenated', 'Sync/Cart.cs', raw`
public static class Cart
{
    public const string ClearSql = "DELETE FROM carts WHERE userId = @userId";
}
`)
add(C, 'cp-dotnet-php-ruby', 'xmlreader-prohibit-dtd', 'Sync/Xml.cs', raw`
using System.IO;
using System.Xml;

public static class Xml
{
    public static XmlReader Open(Stream s) => XmlReader.Create(s, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit });
}
`)
add(C, 'cp-dotnet-php-ruby', 'cookie-httponly-true', 'Sync/Cookie.cs', raw`
using Microsoft.AspNetCore.Http;

public static class Cookie
{
    public static CookieOptions Make() => new CookieOptions { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict };
}
`)
add(C, 'cp-dotnet-php-ruby', 'password-from-config', 'Sync/Pw.cs', raw`
using Microsoft.Extensions.Configuration;

public static class Pw
{
    public static string Get(IConfiguration config) => config["Db:Password"] ?? "";
}
`)
add(C, 'cp-dotnet-php-ruby', 'html-raw-of-constant', 'Views/Footer.cshtml', raw`
@Html.Raw("<hr />")
<p>@Model.Comment</p>
`)
add(C, 'cp-dotnet-php-ruby', 'antiforgery-validated', 'Sync/Controllers.cs', raw`
using Microsoft.AspNetCore.Mvc;

public class FormController : Controller
{
    [ValidateAntiForgeryToken]
    [HttpPost]
    public IActionResult Save() => Ok();
}
`)
add(C, 'cp-dotnet-php-ruby', 'cert-callback-checks-errors', 'Sync/Http.cs', raw`
using System.Net.Http;
using System.Net.Security;

public static class Http
{
    public static void Setup(HttpClientHandler handler)
    {
        handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => errors == SslPolicyErrors.None;
    }
}
`)

// --------------------------------------------------------------------------------------------------------------------- PHP
const H = 'php'
add(H, 'cp-dotnet-php-ruby', 'eval-word-in-comment', 'src/note.php', raw`
<?php
// never use eval() on input; this file only documents that
function note(): string { return "no eval here"; }
`)
add(H, 'cp-dotnet-php-ruby', 'preg-replace-callback', 'src/pre.php', raw`
<?php
function clean(string $s): string {
    return preg_replace('/\s+/', ' ', $s);
}
`)
add(H, 'cp-dotnet-php-ruby', 'unserialize-with-allowed-classes-false', 'src/unser.php', raw`
<?php
function load(string $raw) {
    return unserialize($raw, ['allowed_classes' => false]);
}
`)
add(H, 'cp-dotnet-php-ruby', 'extract-of-constant-array', 'src/ext.php', raw`
<?php
function defaults(): int {
    extract(['width' => 10, 'height' => 20]);
    return $width * $height;
}
`)
add(H, 'cp-dotnet-php-ruby', 'include-constant-file', 'src/inc.php', raw`
<?php
require __DIR__ . '/header.php';
include "footer.php";
`)
add(H, 'cp-dotnet-php-ruby', 'system-constant', 'src/sys.php', raw`
<?php
function version(): string {
    return (string) shell_exec('git --version');
}
`)
add(H, 'cp-dotnet-php-ruby', 'random-int-token', 'src/tok.php', raw`
<?php
function token(): string {
    return bin2hex(random_bytes(16));
}
`)
add(H, 'cp-dotnet-php-ruby', 'pdo-prepared', 'src/pdo.php', raw`
<?php
function find(PDO $pdo, int $id) {
    $s = $pdo->prepare("SELECT * FROM users WHERE id = ?");
    $s->execute([$id]);
    return $s->fetch();
}
`)
add(H, 'cp-dotnet-php-ruby', 'display-errors-off', 'src/ini.php', raw`
<?php
ini_set('display_errors', '0');
ini_set('log_errors', '1');
`)
add(H, 'cp-dotnet-php-ruby', 'readfile-fixed', 'src/read.php', raw`
<?php
readfile(__DIR__ . '/notes.txt');
`)
add(H, 'cp-dotnet-php-ruby', 'curl-verify-on', 'src/curl.php', raw`
<?php
function client() {
    $c = curl_init('https://api.example.com/');
    curl_setopt($c, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($c, CURLOPT_SSL_VERIFYHOST, 2);
    return $c;
}
`)
add(H, 'cp-dotnet-php-ruby', 'sql-concat-int-cast', 'src/cast.php', raw`
<?php
function byId(mysqli $c, $id) {
    return mysqli_query($c, "SELECT * FROM users WHERE id=" . (int) $id);
}
`)

// -------------------------------------------------------------------------------------------------------------------- Ruby
const B = 'ruby'
add(B, 'cp-dotnet-php-ruby', 'eval-constant', 'lib/calc.rb', raw`
def two
  eval("1 + 1")
end
`)
add(B, 'cp-dotnet-php-ruby', 'send-allow-listed', 'lib/dispatch.rb', raw`
ALLOWED = %i[name email].freeze

def read(user, field)
  user.public_send(field) if ALLOWED.include?(field.to_sym)
end
`)
add(B, 'cp-dotnet-php-ruby', 'json-not-marshal', 'lib/load.rb', raw`
require 'json'

def load(data)
  JSON.parse(data)
end
`)
add(B, 'cp-dotnet-php-ruby', 'sha256-digest', 'lib/digest.rb', raw`
require 'digest'

def fingerprint(text)
  Digest::SHA256.hexdigest(text)
end
`)
add(B, 'cp-dotnet-php-ruby', 'yaml-safe-load', 'lib/yml.rb', raw`
require 'yaml'

def read(s)
  YAML.safe_load(s)
end
`)
add(B, 'cp-dotnet-php-ruby', 'system-argument-list', 'lib/sys.rb', raw`
def list(dir)
  system("ls", dir)
end
`)
add(B, 'cp-dotnet-php-ruby', 'params-require-permit', 'app/users_controller.rb', raw`
class UsersController < ApplicationController
  def user_params
    params.require(:user).permit(:name, :email)
  end
end
`)
add(B, 'cp-dotnet-php-ruby', 'html-safe-of-constant', 'app/helpers.rb', raw`
module Helpers
  BREAK = "<br>".html_safe
end
`)
add(B, 'cp-dotnet-php-ruby', 'csrf-verified-api-token', 'app/api_controller.rb', raw`
class ApiController < ApplicationController
  before_action :authenticate_user!
  protect_from_forgery with: :exception
end
`)
add(B, 'cp-dotnet-php-ruby', 'file-read-fixed', 'lib/readfile.rb', raw`
def notes
  File.read(File.join(__dir__, "notes.txt"))
end
`)
add(B, 'cp-dotnet-php-ruby', 'render-constant-template', 'app/pages_controller.rb', raw`
class PagesController < ApplicationController
  def home
    render "pages/home"
  end
end
`)
add(B, 'cp-dotnet-php-ruby', 'named-routes', 'config/routes.rb', raw`
Rails.application.routes.draw do
  get "about", to: "pages#about"
  get "contact", to: "pages#contact"
end
`)

// ------------------------------------------------------------------------------------------------------------------- Kotlin
const K = 'kotlin'
add(K, 'secrets-plus', 'kotlin-placeholder-password-from-env', 'src/Config.kt', raw`
object Config {
    val dbPassword: String = System.getenv("DB_PASSWORD") ?: ""
    const val PASSWORD_LABEL = "Password"
}
`)
add(K, 'hardcoded-ip', 'kotlin-doc-and-loopback-address', 'src/Net.kt', raw`
object Net {
    const val LOOPBACK = "127.0.0.1"
    const val DOC = "192.0.2.44"
}
`)
add(K, 'sql-concat', 'kotlin-bound-parameter', 'src/Users.kt', raw`
import java.sql.Connection

fun active(c: Connection) = c.prepareStatement("SELECT id FROM users WHERE active = ?").apply { setBoolean(1, true) }.executeQuery()
`)
add(K, 'weak-crypto-modes', 'kotlin-sha256', 'src/Hash.kt', raw`
import java.security.MessageDigest

fun sha(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
`)
add(K, 'path-traversal-pattern', 'kotlin-name-only-in-fixed-dir', 'src/Files.kt', raw`
import java.io.File

fun pick(baseDir: File, requested: String): File = File(baseDir, File(requested).name)
`)
add(K, 'debug-leftovers', 'kotlin-logger-not-println', 'src/Log.kt', raw`
import java.util.logging.Logger

private val log = Logger.getLogger("app")

fun hello() = log.info("started")
`)
add(K, 'pii-patterns-in-source', 'kotlin-reserved-example-email', 'src/Contact.kt', raw`
const val SUPPORT = "support@example.com"
`)

// ------------------------------------------------------------------------------------------------------------------- Swift
const S = 'swift'
add(S, 'secrets-plus', 'swift-key-read-from-keychain', 'Sources/Keys.swift', raw`
import Security

func apiKey() -> String? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: "api", kSecReturnData as String: true]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
}
`)
add(S, 'hardcoded-ip', 'swift-loopback-only', 'Sources/Net.swift', raw`
let loopback = "127.0.0.1"
let documentation = "198.51.100.3"
`)
add(S, 'weak-crypto-modes', 'swift-cryptokit-sha256', 'Sources/Hash.swift', raw`
import CryptoKit

func sha(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
`)
add(S, 'mixed-content', 'swift-https-url-literal', 'Sources/Urls.swift', raw`
let docs = URL(string: "https://example.com/docs")!
`)
add(S, 'debug-leftovers', 'swift-oslog-not-print', 'Sources/Log.swift', raw`
import os

let log = Logger(subsystem: "com.example.app", category: "main")

func hello() { log.info("started") }
`)
add(S, 'sql-concat', 'swift-bound-statement', 'Sources/Db.swift', raw`
let sql = "SELECT id FROM users WHERE name = ?"
`)

// ----------------------------------------------------------------------------------------------------------------------- C/C++
const Q = 'c-cpp'
add(Q, 'secrets-plus', 'c-password-from-getenv', 'src/conf.c', raw`
#include <stdlib.h>

const char *db_password(void) { return getenv("DB_PASSWORD"); }
`)
add(Q, 'hardcoded-ip', 'c-bind-loopback', 'src/bind.c', raw`
#include <string.h>

static const char *HOST = "127.0.0.1";
size_t host_len(void) { return strlen(HOST); }
`)
add(Q, 'risky-code', 'cpp-strncpy-bounded', 'src/copy.cpp', raw`
#include <cstring>

void copy(char *dst, std::size_t cap, const char *src) {
    std::strncpy(dst, src, cap - 1);
    dst[cap - 1] = '\0';
}
`)
add(Q, 'risky-code', 'cpp-system-word-in-comment', 'src/sys.cpp', raw`
// We never call system() with input; build steps run through a fixed argv instead.
int answer() { return 42; }
`)
add(Q, 'weak-crypto-modes', 'cpp-openssl-sha256', 'src/hash.cpp', raw`
#include <openssl/evp.h>

const EVP_MD *digest() { return EVP_sha256(); }
`)
add(Q, 'debug-leftovers', 'cpp-printf-in-cli-main', 'src/main.cpp', raw`
#include <cstdio>

int main() {
    std::puts("ok");
    return 0;
}
`)
add(Q, 'pii-patterns-in-source', 'c-example-contact-in-header', 'src/about.h', raw`
#define SUPPORT_EMAIL "support@example.com"
`)

export function projects(ctx) {
  const { tidy } = ctx
  const out = {}
  for (const [name, files] of Object.entries(FILES)) {
    const base = { ...tidy(`trap-lang-${name}-clean`) }
    if (name === 'go') base['go.mod'] = ['module example.com/trap\n\ngo 1.22\n']
    if (name === 'rust' && !files['Cargo.toml']) base['Cargo.toml'] = ['[package]\nname = "t"\nversion = "0.1.0"\nedition = "2021"\n']
    out[`trap-lang-${name}-clean`] = { files: { ...base, ...files } }
  }
  return { projects: out, expect: {} }
}
