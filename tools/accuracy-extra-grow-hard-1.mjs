// Grown planted defects, hard and extreme, part 1: injection that crosses files (SQL, shell, file paths). The request value enters in a route
// file and reaches the dangerous call through a helper, a service or a repository in other files. The planted line is the sink; the route
// and the helper that feed it are separate files. The "-clean" twin has the same files written safely and must not be reported.
// Keys and projects are prefixed `grow-hard-`. A file line is a plain string (same in both projects) or [badLine, cleanLine, 'x']
// ('x' marks the planted line; without it the line only differs between the twins). In the text, § stands for a backtick and @{ for ${.
// Case: [key, check id, description, { file: [lines] }]  // tier: impact=<critical|high|medium|low> difficulty=<easy|medium|hard|extreme>

const fix = (s) => (s ?? '').replaceAll('§', '`').replaceAll('@{', '${')

const mk = (fam, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`grow-hard-${fam}`) }
  const good = { ...tidy(`grow-hard-${fam}-clean`) }
  for (const [k, exp, desc, files] of cases) {
    expect[`grow-hard-${k}`] = exp
    for (const [file, lines] of Object.entries(files)) {
      bad[file] = [...lines.map((l) => (Array.isArray(l) ? (l[2] === 'x' ? d(`grow-hard-${k}`, desc, fix(l[0])) : fix(l[0])) : fix(l))), '']
      good[file] = [...lines.map((l) => (Array.isArray(l) ? fix(l[1]) : fix(l))), '']
    }
  }
  return { projects: { [`grow-hard-${fam}`]: { files: bad }, [`grow-hard-${fam}-clean`]: { files: good } }, expect }
}

export function projects(ctx) {
  const cases = [
    ['sql-knex-repo', 'sql-concat', 'a route hands a query-string status to a repository in another file that puts it into a knex.raw template', {
      'src/routes/orders-list.js': ["const repo = require('../repo/orders-repo')", "module.exports = (app) => app.get('/orders', async (req, res) => res.json(await repo.byStatus(req.query.status)))"],
      'src/repo/orders-repo.js': ["const knex = require('./knex')", ["exports.byStatus = (status) => knex.raw(§SELECT * FROM orders WHERE status = '@{status}'§)", "exports.byStatus = (status) => knex.raw('SELECT * FROM orders WHERE status = ?', [status])", 'x']],
    }], // tier: impact=critical difficulty=hard
    ['sql-three-layers', 'sql-concat', 'a user id passes from a route through a service to a repository that joins it into a DELETE statement', {
      'src/routes/account-delete.js': ["const svc = require('../services/accounts')", "module.exports = (app) => app.delete('/accounts/:id', async (req, res) => { await svc.remove(req.params.id); res.sendStatus(204) })"],
      'src/services/accounts.js': ["const repo = require('../repo/accounts-repo')", 'exports.remove = (id) => repo.deleteById(id)'],
      'src/repo/accounts-repo.js': ["const db = require('./pool')", ["exports.deleteById = (id) => db.query('DELETE FROM accounts WHERE id = ' + id)", "exports.deleteById = (id) => db.query('DELETE FROM accounts WHERE id = $1', [id])", 'x']],
    }], // tier: impact=critical difficulty=extreme
    ['sql-where-fragment', 'sql-concat', 'a route builds a WHERE fragment from a query value and a shared query helper in another file appends it to a SELECT', {
      'src/routes/search.js': ["const { search } = require('../lib/query')", ["module.exports = (app) => app.get('/search', async (req, res) => res.json(await search(\"name = '\" + req.query.q + \"'\")))", "module.exports = (app) => app.get('/search', async (req, res) => res.json(await search('name = $1', [req.query.q])))"]],
      'src/lib/query.js': ["const db = require('./pool')", ["exports.search = (clause) => db.query('SELECT id, name FROM products WHERE ' + clause)", "exports.search = (clause, args = []) => db.query('SELECT id, name FROM products WHERE name = $1', args)", 'x']],
    }], // tier: impact=critical difficulty=hard
    ['sql-sequelize-order', 'sql-concat', 'a sort column from the query string is spliced into a Sequelize raw query by a helper in another file', {
      'src/routes/products.js': ["const { listProducts } = require('../lib/products-db')", "module.exports = (app) => app.get('/products', async (req, res) => res.json(await listProducts(req.query.sort)))"],
      'src/lib/products-db.js': ["const { sequelize } = require('./sequelize')", "const SORTABLE = { name: 'name', price: 'price' }", ["exports.listProducts = (sort) => sequelize.query(§SELECT * FROM products ORDER BY @{sort}§)", "exports.listProducts = (sort) => sequelize.query('SELECT * FROM products ORDER BY name', { replacements: [SORTABLE[sort]] })", 'x']],
    }], // tier: impact=critical difficulty=hard
    ['sql-python-fstring-dao', 'sql-concat|cp-python/py-raw-sql-formatted', 'a Flask view passes a request value to a data-access function in another file that builds the SQL with an f-string', {
      'shop/views.py': ['from shop.dao import find_customer', '', 'def customer(request):', "    return find_customer(request.args['email'])"],
      'shop/dao.py': ['from shop.db import cursor', '', 'def find_customer(email):', ['    cursor.execute(f"SELECT * FROM customers WHERE email = \'{email}\'")', '    cursor.execute("SELECT * FROM customers WHERE email = %s", (email,))', 'x'], '    return cursor.fetchone()'],
    }], // tier: impact=critical difficulty=hard
    ['sql-python-format-report', 'sql-concat|cp-python/py-raw-sql-formatted', 'a report name from a request goes through a service module into a % formatted statement', {
      'reports/api.py': ['from reports.service import run_report', '', 'def report(request):', "    return run_report(request.GET['table'])"],
      'reports/service.py': ['from reports.store import load_rows', '', 'def run_report(table):', '    return load_rows(table)'],
      'reports/store.py': ['from reports.db import cursor', '', 'def load_rows(table):', ['    cursor.execute("SELECT * FROM %s LIMIT 100" % table)', '    cursor.execute("SELECT * FROM reports_view LIMIT 100")', 'x'], '    return cursor.fetchall()'],
    }], // tier: impact=critical difficulty=extreme
    ['sql-java-dao-concat', 'cp-java/java-statement-concat|sql-concat', 'a controller passes a request parameter to a DAO in another file that joins it into the statement text', {
      'src/main/java/shop/web/UserController.java': ['package shop.web;', 'public class UserController {', '  public Object find(javax.servlet.http.HttpServletRequest request) throws Exception {', '    return new shop.dao.UserDao().byName(request.getParameter("name"));', '  }', '}'],
      'src/main/java/shop/dao/UserDao.java': ['package shop.dao;', 'public class UserDao {', '  java.sql.Statement stmt;', '  public Object byName(String name) throws Exception {', ['    return stmt.executeQuery("SELECT * FROM users WHERE name = \'" + name + "\'");', '    return stmt.executeQuery("SELECT * FROM users");', 'x'], '  }', '}'],
    }], // tier: impact=critical difficulty=hard
    ['sql-go-handler-repo', 'cp-go/go-sql-built-string|sql-concat', 'a handler passes a form value to a repository in another file that builds the query with Sprintf', {
      'internal/web/handler.go': ['package web', '', 'import "net/http"', '', 'func Lookup(w http.ResponseWriter, r *http.Request) {', '\tfindInvoice(r.FormValue("id"))', '}'],
      'internal/web/repo.go': ['package web', '', 'import ("database/sql"; "fmt")', '', 'var db *sql.DB', '', 'func findInvoice(id string) {', ['\tdb.Query(fmt.Sprintf("SELECT * FROM invoices WHERE id=%s", id))', '\tdb.Query("SELECT * FROM invoices WHERE id = ?", id)', 'x'], '}'],
    }], // tier: impact=critical difficulty=hard
    ['sql-php-model-concat', 'cp-dotnet-php-ruby/php-sql-concat|sql-concat', 'a controller passes $_GET["id"] to a model function in another file that appends it to a mysqli query', {
      'app/controllers/order.php': ['<?php', "require_once __DIR__ . '/../models/order_model.php';", "echo json_encode(order_by_id($_GET['id']));"],
      'app/models/order_model.php': ['<?php', 'function order_by_id($id) {', '    global $conn;', ['    return mysqli_query($conn, "SELECT * FROM orders WHERE id=" . $id);', '    return $conn->prepare("SELECT * FROM orders WHERE id = ?");', 'x'], '}'],
    }], // tier: impact=critical difficulty=hard
    ['sql-csharp-repository', 'cp-dotnet-php-ruby/cs-sql-concat|sql-concat', 'a controller action hands a query value to a repository class that concatenates it into the SQL text', {
      'Controllers/CustomerController.cs': ['public class CustomerController {', '  private readonly CustomerRepository repo = new CustomerRepository();', '  public object Get(string name) { return repo.FindByName(name); }', '}'],
      'Data/CustomerRepository.cs': ['public class CustomerRepository {', '  public object FindByName(string name) {', ['    var q = "SELECT * FROM Customers WHERE Name = \'" + name + "\'";', '    var q = "SELECT * FROM Customers WHERE Name = @name";', 'x'], '    return Run(q);', '  }', '}'],
    }], // tier: impact=critical difficulty=hard
    ['path-sendfile-helper', 'path-traversal-pattern|cp-js/js-fs-request-path', 'a route passes a URL parameter to a report helper in another file that joins it into a sendFile path', {
      'src/routes/reports-dl.js': ["const { sendReport } = require('../lib/report-files')", "module.exports = (app) => app.get('/reports/:file', (req, res) => sendReport(res, req.params.file))"],
      'src/lib/report-files.js': ["const path = require('path')", "const DIR = path.join(__dirname, '..', '..', 'reports')", ['exports.sendReport = (res, file) => res.sendFile(path.join(DIR, file))', 'exports.sendReport = (res, file) => res.sendFile(path.join(DIR, path.basename(file)))', 'x']],
    }], // tier: impact=critical difficulty=hard
    ['path-three-file-dir-const', 'path-traversal-pattern|cp-js/js-fs-request-path', 'a download folder constant, a storage helper and a route live in three files and the helper never strips the name', {
      'src/config/dirs.js': ["const path = require('path')", "exports.EXPORT_DIR = path.join(__dirname, '..', '..', 'exports')"],
      'src/lib/export-store.js': ["const fs = require('fs')", "const path = require('path')", "const { EXPORT_DIR } = require('../config/dirs')", ['exports.read = (name) => fs.createReadStream(path.join(EXPORT_DIR, name))', 'exports.read = (name) => fs.createReadStream(path.join(EXPORT_DIR, path.basename(name)))', 'x']],
      'src/routes/exports-dl.js': ["const store = require('../lib/export-store')", "module.exports = (app) => app.get('/exports/:name', (req, res) => store.read(req.params.name).pipe(res))"],
    }], // tier: impact=critical difficulty=extreme
    ['path-write-upload-helper', 'path-traversal-pattern|cp-js/js-fs-request-path', 'an upload route passes the client file name to a storage helper in another file that writes under it', {
      'src/routes/avatar.js': ["const { saveAvatar } = require('../lib/avatars')", "module.exports = (app) => app.post('/avatar', (req, res) => { saveAvatar(req.body.filename, req.body.data); res.sendStatus(201) })"],
      'src/lib/avatars.js': ["const fs = require('fs')", "const path = require('path')", ["exports.saveAvatar = (name, data) => fs.writeFileSync(path.join('uploads', name), data)", "exports.saveAvatar = (name, data) => fs.writeFileSync(path.join('uploads', path.basename(name)), data)", 'x']],
    }], // tier: impact=critical difficulty=hard
    ['path-go-zip-slip-unpack', 'cp-go/go-zip-slip-join|path-traversal-pattern', 'an upload handler passes an archive to an unpack helper in another file that joins each entry name into the target folder', {
      'internal/web/import.go': ['package web', '', 'import "archive/zip"', '', 'func ImportArchive(r *zip.Reader) {', '\tunpack(r, "/srv/imports")', '}'],
      'internal/web/unpack.go': ['package web', '', 'import ("archive/zip"; "path/filepath")', '', 'func unpack(r *zip.Reader, dest string) {', '\tfor _, f := range r.File {', ['\t\tpath := filepath.Join(dest, f.Name)', '\t\tpath := filepath.Join(dest, filepath.Base(f.Name))', 'x'], '\t\t_ = path', '\t}', '}'],
    }], // tier: impact=critical difficulty=hard
    ['path-python-tar-unpack', 'cp-python/py-tar-extractall-unfiltered', 'a view saves an uploaded archive and a worker two modules away extracts it with no member filter', {
      'imports/views.py': ['from imports.jobs import queue_unpack', '', 'def upload(request):', "    return queue_unpack(request.files['bundle'])"],
      'imports/jobs.py': ['from imports.unpack import unpack_bundle', '', 'def queue_unpack(f):', '    return unpack_bundle(f)'],
      'imports/unpack.py': ['import tarfile', '', 'def unpack_bundle(f):', '    tar = tarfile.open(fileobj=f)', ['    tar.extractall("/srv/imports")', '    tar.extractall("/srv/imports", filter="data")', 'x']],
    }], // tier: impact=critical difficulty=extreme
    ['cmd-exec-promisified-helper', 'cp-js/js-exec-alias|cp-js/js-exec-variable|risky-code', 'a route passes a body field to a promisified exec helper in another file that runs it as a command string', {
      'src/routes/ping.js': ["const { ping } = require('../lib/net-tools')", "module.exports = (app) => app.post('/ping', async (req, res) => res.json({ out: await ping(req.body.host) }))"],
      'src/lib/net-tools.js': ["const { promisify } = require('util')", "const { exec } = require('child_process')", "const run = promisify(exec)", ["exports.ping = async (host) => (await run('ping -c 1 ' + host)).stdout", "exports.ping = async (host) => (await promisify(require('child_process').execFile)('ping', ['-c', '1', host])).stdout", 'x']],
    }], // tier: impact=critical difficulty=hard
    ['cmd-spawn-shell-ffmpeg', 'cp-js/js-spawn-shell|risky-code', 'a route passes a file name to a transcode helper in another file that spawns ffmpeg through a shell', {
      'src/routes/transcode.js': ["const { toMp4 } = require('../lib/ffmpeg')", "module.exports = (app) => app.post('/transcode', (req, res) => { toMp4(req.body.file); res.sendStatus(202) })"],
      'src/lib/ffmpeg.js': ["const { spawn } = require('child_process')", ["exports.toMp4 = (file) => spawn('ffmpeg', ['-i', file, 'out.mp4'], { shell: true })", "exports.toMp4 = (file) => spawn('ffmpeg', ['-i', file, 'out.mp4'])", 'x']],
    }], // tier: impact=critical difficulty=hard
    ['cmd-three-file-git-wrapper', 'cp-js/js-exec-variable|risky-code', 'a route calls a git service that calls a shell wrapper in a third file which runs any string with exec', {
      'src/routes/repo-info.js': ["const git = require('../services/git')", "module.exports = (app) => app.get('/repo/log', (req, res) => git.log(req.query.branch, (e, out) => res.send(out)))"],
      'src/services/git.js': ["const { sh } = require('../lib/shell')", ["exports.log = (branch, cb) => sh('git log --oneline ' + branch, cb)", "exports.log = (branch, cb) => sh('git', ['log', '--oneline', String(branch)], cb)"]],
      'src/lib/shell.js': ["const cp = require('child_process')", ['exports.sh = (cmd, cb) => cp.exec(cmd, cb)', 'exports.sh = (bin, args, cb) => cp.execFile(bin, args, cb)', 'x']],
    }], // tier: impact=critical difficulty=extreme
    ['cmd-java-runtime-exec', 'cp-java/java-runtime-exec-variable|risky-code', 'a controller passes a request parameter to a utility class in another file that runs it through Runtime.exec', {
      'src/main/java/ops/web/DiagController.java': ['package ops.web;', 'public class DiagController {', '  public String ping(javax.servlet.http.HttpServletRequest request) throws Exception {', '    return ops.util.Shell.run("ping -c 1 " + request.getParameter("host"));', '  }', '}'],
      'src/main/java/ops/util/Shell.java': ['package ops.util;', 'public class Shell {', '  public static String run(String cmd) throws Exception {', ['    Process p = Runtime.getRuntime().exec(cmd);', '    Process p = Runtime.getRuntime().exec("uptime");', 'x'], '    return p.toString();', '  }', '}'],
    }], // tier: impact=critical difficulty=hard
    ['cmd-go-exec-command-var', 'cp-go/go-exec-variable|cp-go/go-shell-dash-c', 'a handler passes a form value to a helper in another file that starts the program it names', {
      'internal/web/tools.go': ['package web', '', 'import "net/http"', '', 'func Convert(w http.ResponseWriter, r *http.Request) {', '\trunTool(r.FormValue("tool"))', '}'],
      'internal/web/runner.go': ['package web', '', 'import "os/exec"', '', 'func runTool(name string) {', ['\texec.Command(name).Run()', '\texec.Command("convert", "-version").Run()', 'x'], '}'],
    }], // tier: impact=critical difficulty=hard
    ['cmd-csharp-process-start', 'cp-dotnet-php-ruby/cs-process-variable|risky-code', 'a controller hands a query value to a helper class in another file that starts a process from it', {
      'Controllers/ToolsController.cs': ['public class ToolsController {', '  public void Run(string cmd) { ProcessHelper.Launch(cmd); }', '}'],
      'Util/ProcessHelper.cs': ['public static class ProcessHelper {', '  public static void Launch(string cmd) {', ['    System.Diagnostics.Process.Start(cmd);', '    System.Diagnostics.Process.Start("notepad.exe");', 'x'], '  }', '}'],
    }], // tier: impact=critical difficulty=hard
    ['cmd-php-system-helper', 'cp-dotnet-php-ruby/php-shell-variable|risky-code', 'a page passes $_GET["host"] to a helper in another file that calls system with a command built from it', {
      'public/lookup.php': ['<?php', "require_once __DIR__ . '/../lib/net.php';", "echo lookup_host($_GET['host']);"],
      'lib/net.php': ['<?php', 'function lookup_host($host) {', '    $cmd = "nslookup " . $host;', ['    return system($cmd);', '    return gethostbyname($host);', 'x'], '}'],
    }], // tier: impact=critical difficulty=hard
    ['cmd-php-include-page', 'cp-dotnet-php-ruby/php-include-variable', 'a router passes a page name from the query to a loader in another file that includes it', {
      'public/index.php': ['<?php', "require_once __DIR__ . '/../lib/loader.php';", "load_page($_GET['page']);"],
      'lib/loader.php': ['<?php', 'function load_page($page) {', ['    include $page;', '    include "home.php";', 'x'], '}'],
    }], // tier: impact=critical difficulty=hard
    ['cmd-python-shell-true-helper', 'cp-python/py-shell-true|risky-code', 'a view passes a host name to a helper in another file that runs a command string with shell=True', {
      'netops/views.py': ['from netops.tools import traceroute', '', 'def trace(request):', "    return traceroute(request.args['host'])"],
      'netops/tools.py': ['import subprocess', '', 'def traceroute(host):', ["    return subprocess.run(f'traceroute {host}', shell=True, capture_output=True)", "    return subprocess.run(['traceroute', host], capture_output=True)", 'x']],
    }], // tier: impact=critical difficulty=hard
    ['cmd-python-popen-variable', 'cp-python/py-popen-variable|risky-code', 'a view passes a command fragment to a job module in another file that runs it with os.popen', {
      'jobs/api.py': ['from jobs.runner import run_job', '', 'def start(request):', "    return run_job(request.json['args'])"],
      'jobs/runner.py': ['import os', '', 'def run_job(args):', ['    return os.popen(args).read()', '    return os.popen("uptime").read()', 'x']],
    }], // tier: impact=critical difficulty=hard
    ['cmd-ruby-system-interp', 'cp-dotnet-php-ruby/rb-system-interpolation|risky-code', 'a controller passes a params value to a service object in another file that interpolates it into system()', {
      'app/controllers/backups_controller.rb': ['class BackupsController < ApplicationController', '  def create', '    BackupService.new.run(params[:dir])', '  end', 'end'],
      'app/services/backup_service.rb': ['class BackupService', '  def run(dir)', ['    system("tar czf /backups/out.tgz #{dir}")', '    system("tar", "czf", "/backups/out.tgz", dir)', 'x'], '  end', 'end'],
    }], // tier: impact=critical difficulty=hard
  ]
  return mk('inject', ctx, cases)
}
