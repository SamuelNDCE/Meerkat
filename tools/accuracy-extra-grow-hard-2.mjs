// Grown planted defects, hard and extreme, part 2: untrusted data that is turned back into objects or code in another file than the one that
// received it (deserialising, eval, YAML, templates), and signing and token trust that is split over several files. The planted line is the
// sink; the "-clean" twin has the same files written safely and must not be reported. Keys and projects are prefixed `grow-hard-`.
// A file line is a plain string (same in both projects) or [badLine, cleanLine, 'x'] ('x' marks the planted line).
// Case: [key, check id, description, { file: [lines] }]  // tier: impact=<critical|high|medium|low> difficulty=<easy|medium|hard|extreme>

const mk = (fam, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`grow-hard-${fam}`) }
  const good = { ...tidy(`grow-hard-${fam}-clean`) }
  for (const [k, exp, desc, files] of cases) {
    expect[`grow-hard-${k}`] = exp
    for (const [file, lines] of Object.entries(files)) {
      bad[file] = [...lines.map((l) => (Array.isArray(l) ? (l[2] === 'x' ? d(`grow-hard-${k}`, desc, l[0]) : l[0]) : l)), '']
      good[file] = [...lines.map((l) => (Array.isArray(l) ? l[1] : l)), '']
    }
  }
  return { projects: { [`grow-hard-${fam}`]: { files: bad }, [`grow-hard-${fam}-clean`]: { files: good } }, expect }
}

export function projects(ctx) {
  const cases = [
    ['deser-dill-cache', 'cp-python/py-marshal-load', 'a cache helper in one file restores values with dill, and a view in another file stores request data in it', {
      'cache/store.py': ['import dill', '', 'def get(blob):', ['    return dill.loads(blob)', '    return __import__("json").loads(blob)', 'x']],
      'cache/views.py': ['from cache.store import get', '', 'def restore(request):', "    return get(request.body)"],
    }], // tier: impact=critical difficulty=hard
    ['deser-yaml-config-upload', 'cp-python/py-yaml-load|xxe-and-deserialize|risky-code', 'a settings importer in one module loads an uploaded YAML file with yaml.load and no safe loader', {
      'settings/importer.py': ['import yaml', '', 'def import_settings(stream):', ['    return yaml.load(stream)', '    return yaml.safe_load(stream)', 'x']],
      'settings/views.py': ['from settings.importer import import_settings', '', 'def upload(request):', "    return import_settings(request.files['cfg'])"],
    }], // tier: impact=critical difficulty=hard
    ['deser-torch-model-upload', 'cp-python/py-torch-load-unsafe', 'a view saves an uploaded model file and a loader in another module opens it with torch.load and no weights_only', {
      'models/views.py': ['from models.loader import open_model', '', 'def upload(request):', "    return open_model(request.files['weights'])"],
      'models/loader.py': ['import torch', '', 'def open_model(f):', ['    return torch.load(f)', '    return torch.load(f, weights_only=True)', 'x']],
    }], // tier: impact=critical difficulty=hard
    ['deser-exec-plugin-source', 'cp-python/py-exec-text|risky-code', 'a plugin source string saved by an admin view is run later by exec in a runner module in another file', {
      'plugins/admin.py': ['PLUGINS = {}', '', 'def save_plugin(request):', "    PLUGINS[request.form['name']] = request.form['source']"],
      'plugins/runner.py': ['from plugins.admin import PLUGINS', '', 'def run_plugin(name):', ['    exec(PLUGINS[name])', '    compile(PLUGINS[name], name, "eval")', 'x']],
    }], // tier: impact=critical difficulty=extreme
    ['deser-eval-rule-engine', 'risky-code|cp-js/js-vm-variable', 'a rule typed into an admin form is stored by one module, loaded by a second and run with eval in a third', {
      'src/routes/rules-admin.js': ["const rules = require('../lib/rule-store')", "module.exports = (app) => app.post('/rules', (req, res) => { rules.save(req.body.name, req.body.expr); res.sendStatus(201) })"],
      'src/lib/rule-store.js': ['const all = new Map()', 'exports.save = (name, expr) => all.set(name, expr)', 'exports.get = (name) => all.get(name)'],
      'src/lib/rule-run.js': ["const rules = require('./rule-store')", ['exports.apply = (name, order) => eval(rules.get(name))', 'exports.apply = (name, order) => rules.get(name) === "free" ? 0 : order.total', 'x']],
    }], // tier: impact=critical difficulty=extreme
    ['deser-vm-expression-helper', 'cp-js/js-vm-variable|risky-code', 'a route passes a body expression to a helper in another file that runs it with vm.runInNewContext', {
      'src/routes/formula.js': ["const { calc } = require('../lib/formula-vm')", "module.exports = (app) => app.post('/formula', (req, res) => res.json({ v: calc(req.body.formula, req.body.vars) }))"],
      'src/lib/formula-vm.js': ["const vm = require('vm')", ['exports.calc = (code, vars) => vm.runInNewContext(code, vars)', 'exports.calc = (code, vars) => Number(vars[code]) || 0', 'x']],
    }], // tier: impact=critical difficulty=hard
    ['deser-node-serialize-cookie', 'cp-js/js-node-serialize|xxe-and-deserialize', 'a cookie value read in a session module is turned into an object by node-serialize in a helper in another file', {
      'src/lib/profile.js': [["const serialize = require('node-serialize')", 'const serialize = JSON'], ['exports.load = (raw) => serialize.unserialize(Buffer.from(raw, "base64").toString())', 'exports.load = (raw) => serialize.parse(Buffer.from(raw, "base64").toString())', 'x']],
      'src/middleware/profile.js': ["const { load } = require('../lib/profile')", "module.exports = (req, res, next) => { req.profile = load(req.cookies.profile); next() }"],
    }], // tier: impact=critical difficulty=hard
    ['deser-yaml-full-schema-helper', 'cp-js/js-yaml-full-schema|xxe-and-deserialize', 'a settings upload route passes the file text to a loader in another file that parses YAML with the full schema', {
      'src/routes/settings-upload.js': ["const { parseSettings } = require('../lib/settings-yaml')", "module.exports = (app) => app.post('/settings', (req, res) => res.json(parseSettings(req.body.text)))"],
      'src/lib/settings-yaml.js': ["const yaml = require('js-yaml')", ['exports.parseSettings = (text) => yaml.load(text, { schema: yaml.DEFAULT_FULL_SCHEMA })', 'exports.parseSettings = (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA })', 'x']],
    }], // tier: impact=critical difficulty=hard
    ['deser-xml-noent-constant', 'xxe-and-deserialize', 'a parser options constant in one file turns entity expansion on and an importer in another file passes it to libxml', {
      'src/config/xml-opts.js': [['exports.PARSE_OPTS = { noent: true, nonet: false }', 'exports.PARSE_OPTS = { noent: false, nonet: true }', 'x']],
      'src/lib/feed-import.js': ["const libxml = require('libxmljs')", "const { PARSE_OPTS } = require('../config/xml-opts')", 'exports.parse = (xml) => libxml.parseXml(xml, PARSE_OPTS)'],
    }], // tier: impact=high difficulty=hard
    ['deser-java-object-stream', 'cp-java/java-object-stream-read|xxe-and-deserialize', 'a controller passes the request body stream to a helper in another file that calls readObject on it', {
      'src/main/java/app/web/ImportController.java': ['package app.web;', 'public class ImportController {', '  public Object load(javax.servlet.http.HttpServletRequest request) throws Exception {', '    return app.util.Blobs.read(request.getInputStream());', '  }', '}'],
      'src/main/java/app/util/Blobs.java': ['package app.util;', 'public class Blobs {', '  public static Object read(java.io.InputStream in) throws Exception {', ['    return new java.io.ObjectInputStream(in).readObject();', '    return new com.fasterxml.jackson.databind.ObjectMapper().readValue(in, java.util.Map.class);', 'x'], '  }', '}'],
    }], // tier: impact=critical difficulty=hard
    ['deser-java-jndi-lookup', 'cp-java/java-jndi-lookup-variable', 'a controller passes a query value to a helper in another file that does a JNDI lookup on it', {
      'src/main/java/app/web/ResourceController.java': ['package app.web;', 'public class ResourceController {', '  public Object get(javax.servlet.http.HttpServletRequest request) throws Exception {', '    return app.util.Jndi.find(request.getParameter("name"));', '  }', '}'],
      'src/main/java/app/util/Jndi.java': ['package app.util;', 'public class Jndi {', '  public static Object find(String name) throws Exception {', '    javax.naming.Context ctx = new javax.naming.InitialContext();', ['    return ctx.lookup(name);', '    return ctx.lookup("java:comp/env/jdbc/ds");', 'x'], '  }', '}'],
    }], // tier: impact=critical difficulty=hard
    ['deser-java-spel-search', 'cp-java/java-spel-variable', 'a search controller passes a filter string to a helper in another file that evaluates it as a Spring expression', {
      'src/main/java/app/web/FilterController.java': ['package app.web;', 'public class FilterController {', '  public Object filter(javax.servlet.http.HttpServletRequest request) {', '    return app.util.Filters.eval(request.getParameter("expr"));', '  }', '}'],
      'src/main/java/app/util/Filters.java': ['package app.util;', 'public class Filters {', '  static org.springframework.expression.spel.standard.SpelExpressionParser parser = new org.springframework.expression.spel.standard.SpelExpressionParser();', '  public static Object eval(String input) {', ['    return parser.parseExpression(input).getValue();', '    return parser.parseExpression("1 + 1").getValue();', 'x'], '  }', '}'],
    }], // tier: impact=critical difficulty=hard
    ['deser-csharp-binaryformatter', 'cp-dotnet-php-ruby/cs-binary-formatter', 'a controller passes the request stream to a helper class in another file that uses BinaryFormatter', {
      'Controllers/RestoreController.cs': ['public class RestoreController {', '  public object Post(System.IO.Stream body) { return StateReader.Read(body); }', '}'],
      'Util/StateReader.cs': ['public static class StateReader {', '  public static object Read(System.IO.Stream s) {', ['    return new System.Runtime.Serialization.Formatters.Binary.BinaryFormatter().Deserialize(s);', '    return System.Text.Json.JsonSerializer.Deserialize<object>(s);', 'x'], '  }', '}'],
    }], // tier: impact=critical difficulty=hard
    ['deser-csharp-typename-handling', 'cp-dotnet-php-ruby/cs-typename-handling', 'a JSON settings holder in one file turns on type-name handling that a controller in another file relies on for request bodies', {
      'Config/JsonConfig.cs': ['public static class JsonConfig {', '  public static Newtonsoft.Json.JsonSerializerSettings Settings() {', '    var settings = new Newtonsoft.Json.JsonSerializerSettings();', ['    settings.TypeNameHandling = TypeNameHandling.All;', '    settings.TypeNameHandling = TypeNameHandling.None;', 'x'], '    return settings;', '  }', '}'],
      'Controllers/EventsController.cs': ['public class EventsController {', '  public object Post(string body) { return Newtonsoft.Json.JsonConvert.DeserializeObject(body, JsonConfig.Settings()); }', '}'],
    }], // tier: impact=critical difficulty=extreme
    ['deser-php-unserialize-cookie', 'cp-dotnet-php-ruby/php-unserialize-variable', 'a bootstrap file passes the cookie to a function in another file that unserializes it', {
      'lib/prefs.php': ['<?php', 'function load_prefs($raw) {', ['    return unserialize($raw);', '    return json_decode($raw, true);', 'x'], '}'],
      'public/bootstrap.php': ['<?php', "require_once __DIR__ . '/../lib/prefs.php';", "$prefs = load_prefs($_COOKIE['prefs']);"],
    }], // tier: impact=critical difficulty=hard
    ['deser-ruby-marshal-session', 'cp-dotnet-php-ruby/rb-marshal-load', 'a controller passes a cookie value to a service in another file that calls Marshal.load', {
      'app/controllers/prefs_controller.rb': ['class PrefsController < ApplicationController', '  def show', '    @prefs = PrefStore.restore(cookies[:prefs])', '  end', 'end'],
      'app/services/pref_store.rb': ['class PrefStore', '  def self.restore(data)', ['    Marshal.load(Base64.decode64(data))', '    JSON.parse(Base64.decode64(data))', 'x'], '  end', 'end'],
    }], // tier: impact=critical difficulty=hard
    ['deser-ruby-yaml-unsafe', 'cp-dotnet-php-ruby/rb-yaml-unsafe', 'an importer service loads an uploaded YAML file with unsafe_load and a controller in another file feeds it', {
      'app/services/importer.rb': ['class Importer', '  def self.parse(text)', ['    YAML.unsafe_load(text)', '    YAML.safe_load(text)', 'x'], '  end', 'end'],
      'app/controllers/imports_controller.rb': ['class ImportsController < ApplicationController', '  def create', '    Importer.parse(params[:file].read)', '  end', 'end'],
    }], // tier: impact=critical difficulty=hard
    ['deser-ruby-send-params', 'cp-dotnet-php-ruby/rb-send-params', 'a controller passes a params value as a method name to a model helper in another file that calls send on it', {
      'app/controllers/actions_controller.rb': ['class ActionsController < ApplicationController', '  def create', '    Account.perform(params[:action_name])', '  end', 'end'],
      'app/models/account.rb': ['class Account', '  def self.perform(name)', ['    User.send(params[:m]) if name', '    User.where(id: params[:id]) if name', 'x'], '  end', 'end'],
    }], // tier: impact=critical difficulty=hard
    ['deser-ruby-permit-all', 'cp-dotnet-php-ruby/rb-permit-all', 'a concern in one file permits every parameter and controllers in other files build records from it', {
      'app/controllers/concerns/mass_params.rb': ['module MassParams', '  def record_params', ['    params.permit!', '    params.require(:record).permit(:name, :note)', 'x'], '  end', 'end'],
      'app/controllers/records_controller.rb': ['class RecordsController < ApplicationController', '  include MassParams', '  def create', '    Record.create(record_params)', '  end', 'end'],
    }], // tier: impact=critical difficulty=extreme
  ]
  return mk('deser', ctx, cases)
}
