// Safe shapes the cp-* code-pattern rules used to flag (the trap-web-cp-* false alarms), each with its near-miss that must still be reported.
// Per check, one project holds every safe file (nothing may be reported) and one holds every near-miss (each file must be reported).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

type Case = { rule: string; file: string; safe: string; bad: string }
const nl = (...l: string[]) => l.join('\n') + '\n'

const CASES: Record<string, Case[]> = {
  'cp-python': [
    { rule: 'py-xml-untrusted', file: 'xml.py', safe: nl('from defusedxml import minidom', 'doc = minidom.parse(p)'), bad: nl('from xml.dom import minidom', 'doc = minidom.parse(p)') },
    { rule: 'py-subprocess-string', file: 'sub.py', safe: nl('import subprocess', "subprocess.run('ls -l', shell=True)"), bad: nl('import subprocess', "subprocess.run('ls -l')") },
    { rule: 'py-shell-true', file: 'shell.py', safe: nl('import subprocess', "subprocess.run('ls -l', shell=True)"), bad: nl('import subprocess', 'subprocess.run(cmd, shell=True)') },
    { rule: 'py-django-mark-safe', file: 'mark.py', safe: nl("REQ = mark_safe('<abbr>*</abbr>')"), bad: nl('x = mark_safe(user_html)') },
    { rule: 'py-django-csrf-exempt', file: 'view.py', safe: nl('@csrf_exempt', 'def hook(request):', '    if not hmac.compare_digest(a, b):', '        return 401'), bad: nl('@csrf_exempt', 'def hook(request):', '    do_it(request.POST)') },
    { rule: 'py-tar-extractall-unfiltered', file: 'ext.py', safe: nl('import zipfile', 'zipfile.ZipFile(p).extractall(dest)'), bad: nl('import tarfile', 'tarfile.open(p).extractall(dest)') },
  ],
  'cp-go': [
    { rule: 'go-http-get-variable', file: 'get.go', safe: nl('func f() { http.Get(config.UpstreamURL) }'), bad: nl('func f() { http.Get(url) }') },
    { rule: 'go-default-listen-no-timeouts', file: 'listen.go', safe: nl('func f() { http.ListenAndServe("127.0.0.1:8080", mux) }'), bad: nl('func f() { http.ListenAndServe(":8080", mux) }') },
    { rule: 'go-exec-variable', file: 'bin.go', safe: nl('const gitBin = "git"', 'func f() { exec.Command(gitBin, "--version") }'), bad: nl('func f(gitBin string) { exec.Command(gitBin, "--version") }') },
    { rule: 'go-shell-dash-c', file: 'sh.go', safe: nl('func f() { exec.Command("sh", "-c", "clear").Run() }'), bad: nl('func f(s string) { exec.Command("sh", "-c", s).Run() }') },
    { rule: 'go-sql-built-string', file: 'sql.go', safe: nl('const cols = "id, name"', 'func f() { db.QueryRow(fmt.Sprintf("SELECT %s FROM u", cols)) }'), bad: nl('func f(c string) { db.QueryRow(fmt.Sprintf("SELECT %s FROM u", c)) }') },
    { rule: 'go-cookie-not-secure', file: 'cookie.go', safe: nl('c := &http.Cookie{', '  Name: "sid",', '  Secure: true,', '}'), bad: nl('c := &http.Cookie{', '  Name: "sid",', '}') },
    { rule: 'go-template-html-unescaped', file: 'tpl.go', safe: nl('var Break = template.HTML("<br>")'), bad: nl('var X = template.HTML(user)') },
    { rule: 'go-pprof-imported', file: 'pprof.go', safe: nl('import _ "net/http/pprof"', 'func f() { http.ListenAndServe("127.0.0.1:6060", nil) }'), bad: nl('import _ "net/http/pprof"', 'func f() { http.ListenAndServe(":6060", nil) }') },
    { rule: 'go-file-from-request', file: 'open.go', safe: nl('func f() { os.Open(filepath.Join(dir, filepath.Base(r.FormValue("f")))) }'), bad: nl('func f() { os.Open(filepath.Join(dir, r.FormValue("f"))) }') },
    { rule: 'go-zip-slip-join', file: 'zip.go', safe: nl('p := filepath.Join(dest, f.Name)', 'if !strings.HasPrefix(p, dest) { return }'), bad: nl('p := filepath.Join(dest, f.Name)', 'os.Create(p)') },
  ],
  'cp-java': [
    { rule: 'java-runtime-exec-variable', file: 'Ex.java', safe: nl('Runtime.getRuntime().exec(new String[] {"git", "--version"});'), bad: nl('Runtime.getRuntime().exec(cmd);') },
    { rule: 'java-cipher-no-padding', file: 'Gcm.java', safe: nl('Cipher.getInstance("AES/GCM/NoPadding");'), bad: nl('Cipher.getInstance("AES/CBC/NoPadding");') },
    { rule: 'java-processbuilder-variable', file: 'Pb.java', safe: nl('private static final String GIT = "git";', 'new ProcessBuilder(GIT, "status");'), bad: nl('new ProcessBuilder(git, "status");') },
    { rule: 'java-jndi-lookup-variable', file: 'Jn.java', safe: nl('private static final String DS = "java:comp/env/jdbc/Main";', 'ctx.lookup(DS);'), bad: nl('ctx.lookup(name);') },
    { rule: 'java-ldap-filter-concat', file: 'Ld.java', safe: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000]", "");', 'return "(uid=" + escaped + ")";'), bad: nl('return "(uid=" + name + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld2.java', safe: nl('String escaped = LdapEncoder.filterEncode(name);', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = StringEscapeUtils.escapeHtml4(name);', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld3.java', safe: nl('String escaped = Other.escapeLDAPSearchFilter(name);', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = Rdn.escapeValue(name);', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld4.java', safe: nl('String escaped = Encode.forLdapFilter(name);', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = LdapEncoder.filterEncode(name) + extra;', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld5.java', safe: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000]", "");', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = name.replaceAll("[^\\\\\\\\*()\\\\u0000]", "");', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld6.java', safe: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000]", "");', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000]", "X");', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld7.java', safe: nl('String escaped = LdapEncoder.filterEncode(name);', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = LdapEncoder.filterEncode(name);', 'escaped = raw;', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld8.java', safe: nl('String escaped = LdapEncoder.filterEncode(name);', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = LdapEncoder.filterEncode(name);', 'escaped += raw;', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld9.java', safe: nl('String escaped = Encode.forLdapFilter(name);', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = Encode.forLdapDN(name);', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld10.java', safe: nl('String escaped = Encode.forLdapFilter(name);', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = LdapNameBuilder.newInstance(name).build().toString();', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld11.java', safe: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000]", "");', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = name.replaceAll("[a[\\\\\\\\*()\\\\u0000]", "");', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld12.java', safe: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000]", "");', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000&&[^x]]", "");', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-ldap-filter-concat', file: 'Ld13.java', safe: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000]", "");', 'return "(uid=" + escaped + ")";'), bad: nl('String escaped = name.replaceAll("[\\\\\\\\*()\\\\u0000]x]", "");', 'return "(uid=" + escaped + ")";') },
    { rule: 'java-file-from-request', file: 'Fn.java', safe: nl('String leaf = Paths.get(request.getParameter("f")).getFileName().toString();'), bad: nl('Path p = Paths.get(request.getParameter("f"));') },
    { rule: 'java-spel-variable', file: 'Sp.java', safe: nl('private static final String RULE = "#a > 1";', 'parser.parseExpression(RULE);'), bad: nl('parser.parseExpression(rule);') },
    { rule: 'java-statement-concat', file: 'St.java', safe: nl('private static final String TABLE = "orders";', 'st.executeQuery("SELECT id FROM " + TABLE);'), bad: nl('st.executeQuery("SELECT id FROM " + table);') },
  ],
  'cp-dotnet-php-ruby': [
    { rule: 'cs-process-variable', file: 'P.cs', safe: nl('var p = Process.Start(new ProcessStartInfo("git", "status") { UseShellExecute = false });'), bad: nl('var p = Process.Start(new ProcessStartInfo("git", "status") { Arguments = arg });') },
    { rule: 'cs-sql-concat', file: 'Q.cs', safe: nl('private const string Table = "orders";', 'var q = "SELECT COUNT(*) FROM " + Table;'), bad: nl('var q = "SELECT COUNT(*) FROM " + table;') },
    { rule: 'php-eval-assert', file: 'a.php', safe: nl('<?php', 'assert($sum >= 0);'), bad: nl('<?php', 'assert($code);') },
    { rule: 'php-eval-assert', file: 'a2.php', safe: nl('<?php', 'assert($a === $b);'), bad: nl('<?php', 'assert($obj->flag);') },
    { rule: 'php-eval-assert', file: 'a3.php', safe: nl('<?php', 'assert($n instanceof Foo);'), bad: nl('<?php', 'assert($map => $code);') },
    { rule: 'php-eval-assert', file: 'a4.php', safe: nl('<?php', 'assert($n != 0);'), bad: nl('<?php', 'assert("$code > 1");') },
    { rule: 'php-eval-assert', file: 'a5.php', safe: nl('<?php', "assert($n > 0, 'msg');"), bad: nl('<?php', 'assert($code); $y = $a > 1;') },
    { rule: 'php-eval-assert', file: 'a6.php', safe: nl('<?php', 'assert(($a + 1) > 0);'), bad: nl('<?php', 'assert($a . $b == 1);') },
    { rule: 'php-eval-assert', file: 'a7.php', safe: nl('<?php', 'assert($a <= $b);'), bad: nl('<?php', 'assert($code, $a > 1);') },
    { rule: 'php-unserialize-variable', file: 'u.php', safe: nl('<?php', "$x = unserialize($c, ['allowed_classes' => false]);"), bad: nl('<?php', '$x = unserialize($c);') },
    { rule: 'php-include-variable', file: 'i.php', safe: nl('<?php', "$auto = __DIR__ . '/vendor/autoload.php';", 'require_once $auto;'), bad: nl('<?php', '$auto = $_GET["p"];', 'require_once $auto;') },
    { rule: 'rb-marshal-load', file: 'm.rb', safe: nl("C = Marshal.load(File.binread(File.join(__dir__, 'tmp', 'c.bin')))"), bad: nl('C = Marshal.load(File.binread(path))') },
    { rule: 'rb-system-interpolation', file: 's.rb', safe: nl('system("ls #{Shellwords.escape(name)}")'), bad: nl('system("ls #{name}")') },
    { rule: 'rb-system-interpolation', file: 's2.rb', safe: nl('system("ls #{name.shellescape}")'), bad: nl('system("ls #{Shellwords.escape(name) + extra}")') },
    { rule: 'rb-system-interpolation', file: 's3.rb', safe: nl('system("ls #{Shellwords.escape(@dir)}")'), bad: nl('system("ls #{Shellwords.escape(name)} #{other}")') },
    { rule: 'rb-system-interpolation', file: 's4.rb', safe: nl('system("ls #{Shellwords.escape(a.b)}")'), bad: nl('system("ls #{Shellwords.escape("x#{y}")}")') },
    { rule: 'rb-html-safe', file: 'h.rb', safe: nl("I18n.t('forms.required_html').html_safe"), bad: nl('name.html_safe') },
    { rule: 'rb-catch-all-route', file: 'routes.rb', safe: nl("get '*path', to: 'errors#not_found'"), bad: nl("get '*path', to: 'pages#show'") },
  ],
  'cp-js': [
    { rule: 'js-exec-variable', file: 'e.js', safe: nl("const cmd = 'git --version'", 'exec(cmd, done)'), bad: nl('exec(cmd, done)') },
    { rule: 'js-require-variable', file: 'r.js', safe: nl("const PLUGINS = new Set(['csv', 'json'])", 'exports.load = (name) => {', "  if (!PLUGINS.has(name)) throw new Error('no')", '  return require(name)', '}'), bad: nl('exports.load = (name) => {', '  return require(name)', '}') },
    { rule: 'js-spawn-shell', file: 's.js', safe: nl("spawn('npm', ['ci'], { shell: true })"), bad: nl('spawn(cmd, [dir], { shell: true })') },
    { rule: 'js-spawn-shell', file: 's2.js', safe: nl("spawn('git status --short', { shell: true })"), bad: nl('spawn("ls", [], { shell: true })') },
    { rule: 'js-spawn-shell', file: 's3.js', safe: nl("spawnSync('npm run build', { cwd, shell: true })"), bad: nl('spawnSync(`npm run ${script}`, { cwd, shell: true })') },
  ],
  'cp-rust': [
    { rule: 'rs-unsafe-no-safety', file: 'src/lib.rs', safe: nl('// SAFETY: p is valid for reads', '// and aligned, checked by the caller', '// (see the contract on the function)', '//', '// more detail here', '#[allow(clippy::deref_addrof)]', '', 'let x = unsafe { *p };'), bad: nl('let x = unsafe { *p };') },
    { rule: 'rs-unsafe-no-safety', file: 'src/lib.rs', safe: nl('// SAFETY: p is valid', 'let x = unsafe { *p };'), bad: nl('// SAFETY: p is valid', 'let a = 1;', 'let b = 2;', 'let c = 3;', 'let x = unsafe { *p };') },
  ],
}

function scan(check: string, files: Record<string, string>): { out: string; failed: Set<string> } {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-cps-'))
  made.push(dir)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  const r = spawnSync(process.execPath, [join(ROOT, 'thorough', 'code-patterns.mjs'), check, '--root', dir], { encoding: 'utf8', env: { ...process.env, MEERKAT_FINDINGS: 'all' } })
  const out = r.stdout
  return { out, failed: new Set([...out.matchAll(/^MEERKAT-SUB FAIL (\S+)/gm)].map((m) => m[1])) }
}

describe('safe shapes stay quiet, near-misses are still reported', () => {
  for (const [check, cases] of Object.entries(CASES)) {
    test(`${check}: safe files raise nothing`, () => {
      const { out } = scan(check, Object.fromEntries(cases.map((c) => [`safe/${c.file}`, c.safe])))
      const hit = cases.filter((c) => out.includes(`safe/${c.file}:`)).map((c) => c.rule)
      expect(hit).toEqual([])
    })
    test(`${check}: each near-miss is still found`, () => {
      const { out } = scan(check, Object.fromEntries(cases.map((c) => [`bad/${c.file}`, c.bad])))
      const missed = cases.filter((c) => !out.includes(`bad/${c.file}:`)).map((c) => c.rule)
      expect(missed).toEqual([])
    })
  }
})

