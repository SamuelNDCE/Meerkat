// Critical planted defects, family: injection. Request data reaching a shell, an interpreter or a SQL string. One defect per file;
// the "-clean" twin project has the same files written safely (argument arrays, bound parameters, no eval) and must not be reported.
// Keys and projects are prefixed `crit-`.

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

const CP = "const cp = require('child_process')"

export function projects(ctx) {
  const cases = [
    ['inj-js-exec-concat', 'src/ping.js', 'cp-js|risky-code', 'exec with a shell string built from a query parameter', CP, "cp.exec('ping -c 1 ' + req.query.host, (err, out) => res.send(out))", "cp.execFile('ping', ['-c', '1', String(req.query.host)], (err, out) => res.send(out))"],
    ['inj-js-execsync-template', 'src/ls.js', 'cp-js|risky-code', 'execSync with a template literal holding a request field', CP, 'const listing = cp.execSync(`ls -la ${req.body.dir}`).toString()', "const listing = cp.execFileSync('ls', ['-la', String(req.body.dir)]).toString()"],
    ['inj-js-eval-body', 'src/calc.js', 'risky-code|cp-js', 'eval of a request body field', "const app = require('express')()", 'const result = eval(req.body.expression)', 'const result = Number(req.body.expression)'],
    ['inj-js-eval-spaced', 'src/calc2.js', 'risky-code|cp-js', 'eval with a space before the parenthesis', "const app = require('express')()", 'const out = eval (req.body.expr)', 'const out = JSON.parse(req.body.expr)'],
    ['inj-js-sql-template', 'src/users.js', 'sql-concat', 'SQL built with a template literal from a request field', "const db = require('./db')", "db.query(`SELECT * FROM users WHERE name = '${req.body.name}'`)", "db.query('SELECT * FROM users WHERE name = $1', [req.body.name])"],
    ['inj-js-sql-concat', 'src/orders.js', 'sql-concat', 'SQL built by concatenation from a query parameter', "const db = require('./db')", "db.query('SELECT * FROM orders WHERE id = ' + req.query.id)", "db.query('SELECT * FROM orders WHERE id = $1', [req.query.id])"],
    ['inj-py-sql-fstring', 'src/users.py', 'sql-concat|cp-python', 'SQL built with an f-string', 'import sqlite3', 'cursor.execute(f"SELECT * FROM users WHERE name = \'{name}\'")', 'cursor.execute("SELECT * FROM users WHERE name = ?", (name,))'],
    ['inj-py-os-system', 'src/convert.py', 'risky-code|cp-python', 'os.system with an f-string holding an upload name', 'import os', 'os.system(f"convert {upload} out.png")', 'subprocess.run(["convert", upload, "out.png"], check=True)'],
    ['inj-py-eval-request', 'src/expr.py', 'risky-code|cp-python', 'eval of request data', 'import ast', 'value = eval(request.args["expr"])', 'value = ast.literal_eval(request.args["expr"])'],
    ['inj-java-runtime-exec', 'src/Run.java', 'cp-java', 'Runtime.exec with a concatenated command', 'class Run {\n    void f(String dir) throws Exception {', '        Runtime.getRuntime().exec("ls " + dir);\n    }\n}', '        new ProcessBuilder("ls", dir).start();\n    }\n}'],
    ['inj-php-eval', 'src/run.php', 'cp-dotnet-php-ruby', 'eval of request data', '<?php', "eval($_POST['code']);", "$code = json_decode($_POST['code'], true);"],
    ['inj-rb-eval', 'src/run.rb', 'cp-dotnet-php-ruby', 'eval of a request parameter', "require 'json'", 'eval(params[:expr])', 'JSON.parse(params[:expr])'],
  ]
  return mk('injection', ctx, cases)
}
