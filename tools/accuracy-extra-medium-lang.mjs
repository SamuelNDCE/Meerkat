// Planted defects, MEDIUM tier, language-specific code (Python, Go, Rust, Java, C#, PHP, Ruby): a real defect a single-file rule
// finds with some surrounding context. Each bug has a clean twin in `med-lang-clean`. Keys are prefixed `med-`.

export function projects(ctx) {
  const { d, tidy } = ctx
  const expect = {}
  const bad = {}
  const good = {}
  const add = (key, id, desc, file, pre, line, post, fix) => {
    const k = `med-${key}`
    expect[k] = id
    bad[file] = [...pre, d(k, desc, line), ...post, '']
    good[file] = [...pre, fix, ...post, '']
  }

  // ---------------------------------------------------------------- Python
  add('py-mutable-list-default', 'py-mutable-default', 'a list used as a default argument and appended to', 'src/py_mutable_list.py', [], 'def add_tag(tag, tags=[]):', ['    tags.append(tag)', '    return tags'], 'def add_tag(tag, tags=None):\n    tags = [] if tags is None else tags')
  add('py-mutable-dict-default', 'py-mutable-default', 'a dict used as a default argument and filled in', 'src/py_mutable_dict.py', ['import time', ''], 'def remember(key, value, seen={}):', ['    seen[key] = (value, time.time())', '    return seen'], 'def remember(key, value, seen=None):\n    seen = {} if seen is None else seen')
  add('py-bare-except-parse', 'py-bare-except', 'a bare except around a parse that hides every error', 'src/py_bare_parse.py', ['def to_int(text):', '    try:', '        return int(text)'], '    except:', ['        return 0'], '    except ValueError:')
  add('py-bare-except-loop', 'py-bare-except', 'a bare except inside a retry loop', 'src/py_bare_loop.py', ['def fetch_all(urls, get):', '    out = []', '    for url in urls:', '        try:', '            out.append(get(url))'], '        except:', ['            continue', '    return out'], '        except OSError:')
  add('py-assert-admin', 'py-assert-in-prod', 'an authorisation check written as assert', 'src/py_assert_admin.py', ['def delete_account(user, account):'], '    assert user.is_admin', ['    account.delete()'], '    if not user.is_admin:\n        raise PermissionError("admin only")')
  add('py-assert-none', 'py-assert-in-prod', 'input validated with assert is not None', 'src/py_assert_none.py', ['def charge(order):'], '    assert order is not None', ['    return order.total * 100'], '    if order is None:\n        raise ValueError("order required")')
  add('py-verify-false-session', 'risky-code|cp-python', 'a requests session with certificate checking turned off', 'src/py_verify_false.py', ['import requests', '', 'def client():', '    s = requests.Session()'], '    s.verify = False', ['    return s'], '    s.verify = True')
  add('py-yaml-load-config', 'risky-code|cp-python', 'yaml.load without a safe loader on a request body', 'src/py_yaml_load.py', ['import yaml', '', 'def parse(request):'], '    return yaml.load(request.data)', [], '    return yaml.safe_load(request.data)')
  add('py-pickle-cookie', 'pickle-load|risky-code|cp-python', 'pickle.loads on a cookie value', 'src/py_pickle_cookie.py', ['import base64', 'import pickle', '', 'def read_prefs(request):', '    raw = base64.b64decode(request.cookies["prefs"])'], '    return pickle.loads(raw)', [], '    return json.loads(raw)')
  add('py-shell-true-ping', 'risky-code|cp-python', 'subprocess with shell=True and a caller host name', 'src/py_shell_true.py', ['import subprocess', '', 'def ping(host):'], '    return subprocess.run("ping -c 1 " + host, shell=True, capture_output=True)', [], '    return subprocess.run(["ping", "-c", "1", host], capture_output=True)')

  // ---------------------------------------------------------------- Go
  add('go-defer-in-loop-files', 'go-defer-in-loop', 'defer inside a loop over files', 'src/go_defer_files.go', ['package main', '', 'import "os"', '', 'func readAll(paths []string) {', '\tfor _, p := range paths {', '\t\tf, err := os.Open(p)', '\t\tif err != nil {', '\t\t\tcontinue', '\t\t}'], '\t\tdefer f.Close()', ['\t\t_ = f.Name()', '\t}', '}'], '\t\tf.Close()')
  add('go-ignored-err-rename', 'go-ignored-errors', 'the error from os.Rename is thrown away', 'src/go_ignored_rename.go', ['package main', '', 'import "os"', '', 'func rotate(old, next string) {'], '\t_ = os.Rename(old, next)', ['}'], '\tif err := os.Rename(old, next); err != nil {\n\t\tpanic(err)\n\t}')
  add('go-ignored-err-assign', 'go-ignored-errors', 'a call result assigned to _ along with its error', 'src/go_ignored_assign.go', ['package main', '', 'import "os"', '', 'func size(p string) int64 {'], '\tinfo, _ := os.Stat(p)', ['\treturn info.Size()', '}'], '\tinfo, err := os.Stat(p)\n\tif err != nil {\n\t\treturn 0\n\t}')
  add('go-insecure-skip-verify', 'risky-code|cp-go', 'a Go TLS config that skips certificate verification', 'src/go_skip_verify.go', ['package main', '', 'import "crypto/tls"', '', 'func cfg() *tls.Config {'], '\treturn &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}', ['}'], '\treturn &tls.Config{MinVersion: tls.VersionTLS12}')
  add('go-shell-dash-c', 'cp-go/go-shell-dash-c|risky-code', 'bash -c started with a caller command', 'src/go_shell_dash_c.go', ['package main', '', 'import "os/exec"', '', 'func run(cmd string) ([]byte, error) {'], '\treturn exec.Command("bash", "-c", cmd).Output()', ['}'], '\treturn exec.Command("/usr/bin/convert", cmd).Output()')
  add('go-md5-checksum', 'cp-go/go-md4-md5-sha1|risky-code', 'MD5 used to fingerprint a password', 'src/go_md5.go', ['package main', '', 'import (', '\t"crypto/md5"', '\t"crypto/sha256"', ')', '', 'var _ = sha256.Sum256', '', 'func fp(pw []byte) [16]byte {'], '\treturn md5.Sum(pw)', ['}'], '\treturn [16]byte{}')

  // ---------------------------------------------------------------- Rust
  add('rust-todo-handler', 'rust-todo-macros', 'todo!() left in a handler that ships', 'src/rust_todo_handler.rs', ['pub fn handle(kind: u8) -> u32 {', '    match kind {', '        0 => 10,', '        1 => 20,'], '        _ => todo!(),', ['    }', '}'], '        _ => 0,')
  add('rust-unimplemented-trait', 'rust-todo-macros', 'unimplemented!() in a trait method', 'src/rust_unimplemented.rs', ['pub trait Store {', '    fn get(&self, key: &str) -> Option<String>;', '}', '', 'pub struct Mem;', '', 'impl Store for Mem {', '    fn get(&self, key: &str) -> Option<String> {'], '        unimplemented!()', ['    }', '}'], '        Some(key.to_string())')
  add('rust-unsafe-no-safety', 'cp-rust/rs-unsafe-no-safety|unsafe-rust', 'an unsafe block with no SAFETY comment', 'src/rust_unsafe_block.rs', ['pub fn first(ptr: *const u8) -> u8 {'], '    unsafe { *ptr }', ['}'], '    // SAFETY: the caller guarantees ptr is valid and aligned.\n    unsafe { *ptr }')
  add('rust-blocking-sleep-async', 'rp-async/rasync-blocking-thread-sleep', 'a blocking thread::sleep inside an async fn', 'src/rust_sleep_async.rs', ['pub async fn poll_once() -> u32 {'], '    std::thread::sleep(std::time::Duration::from_secs(1));', ['    7', '}'], '    tokio::time::sleep(std::time::Duration::from_secs(1)).await;')

  // ---------------------------------------------------------------- Java, C#, PHP, Ruby
  add('java-runtime-exec-dir', 'cp-java/java-runtime-exec-variable', 'Runtime.exec with a concatenated directory name', 'src/RuntimeExecDir.java', ['class RuntimeExecDir {', '    Process list(String dir) throws Exception {'], '        return Runtime.getRuntime().exec("ls " + dir);', ['    }', '}'], '        return new ProcessBuilder("ls", dir).start();')
  add('java-weak-digest-md5', 'cp-java/java-weak-digest', 'an MD5 message digest', 'src/WeakDigest.java', ['import java.security.MessageDigest;', '', 'class WeakDigest {', '    byte[] hash(byte[] data) throws Exception {'], '        return MessageDigest.getInstance("MD5").digest(data);', ['    }', '}'], '        return MessageDigest.getInstance("SHA-256").digest(data);')
  add('java-object-stream', 'cp-java/java-object-stream-read', 'ObjectInputStream reading untrusted bytes', 'src/ObjectStream.java', ['import java.io.*;', '', 'class ObjectStream {', '    Object load(InputStream in) throws Exception {'], '        return new ObjectInputStream(in).readObject();', ['    }', '}'], '        return new String(in.readAllBytes());')
  add('cs-sql-concat-users', 'cp-dotnet-php-ruby/cs-sql-concat|sql-concat', 'a SqlCommand built by concatenation', 'src/SqlUsers.cs', ['using System.Data.SqlClient;', '', 'class SqlUsers {', '    SqlCommand Find(SqlConnection c, string name) {'], '        return new SqlCommand("SELECT * FROM Users WHERE Name = \'" + name + "\'", c);', ['    }', '}'], '        var cmd = new SqlCommand("SELECT * FROM Users WHERE Name = @n", c); cmd.Parameters.AddWithValue("@n", name); return cmd;')
  add('cs-accept-any-cert', 'cp-dotnet-php-ruby/cs-accept-any-certificate', 'a certificate callback that always returns true', 'src/AnyCert.cs', ['using System.Net;', '', 'class AnyCert {', '    void Setup() {'], '        ServicePointManager.ServerCertificateValidationCallback = (s, c, ch, e) => true;', ['    }', '}'], '        ServicePointManager.CheckCertificateRevocationList = true;')
  add('php-include-page', 'cp-dotnet-php-ruby/php-include-variable', 'include of a file name taken from the query string', 'src/php_include_page.php', ['<?php', '$base = __DIR__ . "/pages/";'], 'include $base . $_GET["page"] . ".php";', ['echo "done";'], 'include $base . "home.php";')
  add('php-unserialize-cookie', 'cp-dotnet-php-ruby/php-unserialize-variable', 'unserialize on a cookie value', 'src/php_unserialize.php', ['<?php', '$raw = $_COOKIE["prefs"] ?? "";'], '$prefs = unserialize($raw);', ['echo count($prefs);'], '$prefs = json_decode($raw, true);')
  add('rb-marshal-body', 'cp-dotnet-php-ruby/rb-marshal-load', 'Marshal.load on a request body', 'src/rb_marshal_body.rb', ['class ImportsController < ApplicationController', '  def create'], '    data = Marshal.load(request.body.read)', ['    render json: data', '  end', 'end'], '    data = JSON.parse(request.body.read)')
  add('rb-system-interp-dir', 'cp-dotnet-php-ruby/rb-system-interpolation', 'system with an interpolated request parameter', 'src/rb_system_interp.rb', ['class ArchivesController < ApplicationController', '  def build'], '    system("tar czf out.tgz #{params[:dir]}")', ['    head :ok', '  end', 'end'], '    system("tar", "czf", "out.tgz", File.basename(params[:dir]))')

  const name = 'med-lang'
  return {
    projects: {
      [name]: { files: { ...tidy(name, 'target/\nbin/\nobj/\nvendor/\n__pycache__/\n.env\n'), ...bad } },
      [`${name}-clean`]: { files: { ...tidy(`${name}-clean`, 'target/\nbin/\nobj/\nvendor/\n__pycache__/\n.env\n'), ...good } },
    },
    expect,
  }
}
