// Critical planted defects, family: unsafe deserialisation. Attacker-controlled bytes turned into live objects, which means remote
// code execution in most runtimes. One defect per file; the "-clean" twin project has the same files using a data-only format or
// a safe loader and must not be reported. Keys and projects are prefixed `crit-`.

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

export function projects(ctx) {
  const cases = [
    ['deser-py-pickle-loads', 'src/load_request.py', 'pickle-load|risky-code|cp-python', 'pickle.loads on request data', 'import pickle\nimport json', 'obj = pickle.loads(request.data)', 'obj = json.loads(request.data)'],
    ['deser-py-pickle-load', 'src/load_state.py', 'pickle-load|risky-code|cp-python', 'pickle.load of a file the user supplies', 'import pickle\nimport json', "state = pickle.load(open(path, 'rb'))", "state = json.load(open(path, 'r'))"],
    ['deser-py-yaml-load', 'src/conf.py', 'risky-code|cp-python', 'yaml.load without a safe loader', 'import yaml', 'conf = yaml.load(stream)', 'conf = yaml.safe_load(stream)'],
    ['deser-java-objectinput', 'src/Read.java', 'cp-java|xxe-and-deserialize', 'ObjectInputStream readObject on an input stream', 'class Read {\n    Object m(java.io.InputStream in) throws Exception {', '        java.io.ObjectInputStream ois = new java.io.ObjectInputStream(in);\n        return ois.readObject();\n    }\n}', '        return new com.fasterxml.jackson.databind.ObjectMapper().readTree(in);\n    }\n}'],
    ['deser-js-node-serialize', 'src/profile.js', 'cp-js', 'node-serialize unserialize of a cookie', "const serialize = require('node-serialize')", 'const obj = serialize.unserialize(req.cookies.profile)', 'const obj = JSON.parse(req.cookies.profile)'],
    ['deser-php-unserialize', 'src/cookie.php', 'cp-dotnet-php-ruby', 'unserialize of a cookie', '<?php', "$o = unserialize($_COOKIE['data']);", "$o = json_decode($_COOKIE['data'], true);"],
    ['deser-rb-marshal', 'src/state.rb', 'cp-dotnet-php-ruby', 'Marshal.load of a cookie', "require 'base64'\nrequire 'json'", 'data = Marshal.load(Base64.decode64(cookies[:state]))', 'data = JSON.parse(Base64.decode64(cookies[:state]))'],
    ['deser-rb-yaml-load', 'src/doc.rb', 'cp-dotnet-php-ruby|xxe-and-deserialize', 'YAML.load of a request parameter', "require 'yaml'", 'cfg = YAML.load(params[:doc])', 'cfg = YAML.safe_load(params[:doc])'],
    ['deser-cs-binaryformatter', 'src/Read.cs', 'cp-dotnet-php-ruby', 'BinaryFormatter Deserialize on a stream', 'class Read {', '    object I(System.IO.Stream s) { return new BinaryFormatter().Deserialize(s); }\n}', '    object I(System.IO.Stream s) { return System.Text.Json.JsonSerializer.Deserialize<object>(s); }\n}'],
  ]
  return mk('deserialise', ctx, cases)
}
