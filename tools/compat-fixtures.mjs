// Small, clean sample projects of many kinds, for the compatibility matrix (tools/compat-matrix.mjs, lib/compat.test.ts).
// Each one is a minimal but real project that follows good practice (final newlines, LF endings, licence, README with install and usage,
// .gitignore, no secrets, https links only), so any FAIL a check reports on it is a false-positive candidate.
//   node tools/compat-fixtures.mjs [dir]     writes every project under <dir> (default: a new folder in the OS temp dir)
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIT = `MIT License

Copyright (c) 2026 Example Author

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

const readme = (name, install, usage) => `# ${name}

A small example project that shows what a tidy repository looks like: a clear description, install steps,
usage steps, a licence and a security policy. It has no secrets and uses only https links.

## Install

${install}

## Usage

${usage}

## Licence

MIT, see LICENSE.
`

const gitignore = (...lines) => `${[...lines, '.DS_Store', 'Thumbs.db'].join('\n')}\n`

const SECURITY = '# Security policy\n\nPlease report a security problem privately by email to security@example.com. Do not open a public issue.\n'
const DEPENDABOT = 'version: 2\nupdates:\n  - package-ecosystem: "github-actions"\n    directory: "/"\n    schedule:\n      interval: "weekly"\n'
const CSP = `  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">\n`
const html = (title, body = '<h1>Hello</h1>\n  <p>A small page.</p>', extraHead = '') => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A small example page that shows the markup a well formed site uses for search and sharing.">
  <title>${title}</title>
${CSP}${extraHead}</head>
<body>
  <main>
  ${body}
  </main>
</body>
</html>
`

const lockfile = JSON.stringify({ name: 'example', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'example', version: '1.0.0', license: 'MIT' } } }, null, 2) + '\n'
const electronLock = JSON.stringify({ name: 'example', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'example', version: '1.0.0', license: 'MIT', devDependencies: { electron: '^45.2.1' } }, 'node_modules/electron': { version: '45.2.1', resolved: 'https://registry.npmjs.org/electron/-/electron-45.2.1.tgz', integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', dev: true, license: 'MIT' } } }, null, 2) + '\n'
const pkgJson = (o) => JSON.stringify({ name: 'example', version: '1.0.0', description: 'A small example project.', license: 'MIT', private: true, ...o }, null, 2) + '\n'

// name -> { files: { path: text }, git: true | false | 'empty' }
export const FIXTURES = {
  'node-cli': {
    files: {
      'package.json': pkgJson({ type: 'module', bin: { example: 'index.js' }, scripts: { start: 'node index.js' }, engines: { node: '>=18' } }),
      'package-lock.json': lockfile,
      'index.js': "console.log('hello')\n",
      'README.md': readme('node-cli', 'Clone the repository, then run `npm install`.', 'Run `node index.js`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('node_modules/', '.env'),
    },
  },
  'node-web-ts': {
    files: {
      'package.json': pkgJson({ type: 'module', scripts: { build: 'tsc' }, engines: { node: '>=18' } }),
      'package-lock.json': lockfile,
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, outDir: 'dist', skipLibCheck: true }, include: ['src'] }, null, 2) + '\n',
      'src/index.ts': "export const greet = (name: string): string => `Hello, ${name}`\n",
      'index.html': html('Web TS example'),
      'robots.txt': 'User-agent: *\nAllow: /\n',
      'README.md': readme('node-web-ts', 'Run `npm install`.', 'Run `npm run build`, then open `index.html`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('node_modules/', 'dist/', '.env'),
    },
  },
  'electron-app': {
    files: {
      'package.json': pkgJson({ main: 'main.js', scripts: { start: 'electron .' }, engines: { node: '>=18' }, devDependencies: { electron: '^45.2.1' } }),
      'package-lock.json': electronLock,
      'main.js': `const { app, BrowserWindow } = require('electron')
const path = require('node:path')

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.loadFile('index.html')
}

app.whenReady().then(createWindow).catch((e) => {
  console.error(e)
  app.quit()
})
app.on('window-all-closed', () => app.quit())
`,
      'preload.js': `const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('api', { version: () => '1.0.0' })
`,
      'index.html': html('Electron example', '<h1>Hello</h1>'),
      'README.md': readme('electron-app', 'Run `npm install`.', 'Run `npm start`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('node_modules/', 'dist/', '.env'),
    },
  },
  'python-lib': {
    files: {
      'pyproject.toml': '[build-system]\nrequires = ["setuptools>=68"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "example"\nversion = "1.0.0"\ndescription = "A small example library."\nreadme = "README.md"\nrequires-python = ">=3.9"\nlicense = { text = "MIT" }\nclassifiers = ["Programming Language :: Python :: 3", "License :: OSI Approved :: MIT License"]\n',
      'src/example/__init__.py': '"""A small example library."""\n\n\ndef add(a: int, b: int) -> int:\n    """Return the sum of a and b."""\n    return a + b\n',
      'tests/test_add.py': 'from example import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n',
      'README.md': readme('python-lib', 'Run `pip install .`.', 'Call `example.add(1, 2)`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('__pycache__/', '*.egg-info/', '.venv/', 'dist/', '.env'),
    },
  },
  'rust-crate': {
    files: {
      'Cargo.toml': '[package]\nname = "example"\nversion = "1.0.0"\nedition = "2021"\nlicense = "MIT"\ndescription = "A small example crate."\n\n[dependencies]\n',
      'Cargo.lock': '# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 3\n\n[[package]]\nname = "example"\nversion = "1.0.0"\n',
      'src/main.rs': 'fn main() {\n    println!("hello");\n}\n',
      'README.md': readme('rust-crate', 'Run `cargo build`.', 'Run `cargo run`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('target/', '.env'),
    },
  },
  'go-module': {
    files: {
      'go.mod': 'module example.com/example\n\ngo 1.21\n',
      'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello")\n}\n',
      'README.md': readme('go-module', 'Run `go build ./...`.', 'Run `go run .`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('bin/', '.env'),
    },
  },
  'java-maven': {
    files: {
      'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>example</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
</project>
`,
      'src/main/java/com/example/App.java': 'package com.example;\n\npublic final class App {\n    private App() {}\n\n    public static void main(String[] args) {\n        System.out.println("hello");\n    }\n}\n',
      'README.md': readme('java-maven', 'Run `mvn package`.', 'Run `java -cp target/classes com.example.App`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('target/', '.env'),
    },
  },
  dotnet: {
    files: {
      'Example.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n',
      'Program.cs': 'Console.WriteLine("hello");\n',
      'README.md': readme('dotnet', 'Run `dotnet build`.', 'Run `dotnet run`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('bin/', 'obj/', '.env'),
    },
  },
  php: {
    files: {
      'composer.json': JSON.stringify({ name: 'example/example', description: 'A small example project.', type: 'project', license: 'MIT', require: { php: '>=8.1' } }, null, 2) + '\n',
      'index.php': '<?php\n\ndeclare(strict_types=1);\n\necho "hello\\n";\n',
      'README.md': readme('php', 'Run `composer install`.', 'Run `php index.php`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('vendor/', '.env'),
    },
  },
  ruby: {
    files: {
      Gemfile: "source 'https://rubygems.org'\n\nruby '>= 3.0'\n",
      'lib/x.rb': '# frozen_string_literal: true\n\nmodule X\n  def self.hello\n    "hello"\n  end\nend\n',
      'README.md': readme('ruby', 'Run `bundle install`.', 'Run `ruby -Ilib -e "require \'x\'; puts X.hello"`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('vendor/', '.bundle/', '.env'),
    },
  },
  swift: {
    files: {
      'Package.swift': '// swift-tools-version:5.9\nimport PackageDescription\n\nlet package = Package(\n    name: "Example",\n    targets: [\n        .executableTarget(name: "Example", path: "Sources/Example")\n    ]\n)\n',
      'Sources/Example/main.swift': 'print("hello")\n',
      'README.md': readme('swift', 'Run `swift build`.', 'Run `swift run`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('.build/', '.env'),
    },
  },
  dart: {
    files: {
      'pubspec.yaml': 'name: example\ndescription: A small example package.\nversion: 1.0.0\n\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n',
      'bin/example.dart': "void main() {\n  print('hello');\n}\n",
      'README.md': readme('dart', 'Run `dart pub get`.', 'Run `dart run`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('.dart_tool/', 'build/', '.env'),
    },
  },
  terraform: {
    files: {
      'main.tf': 'terraform {\n  required_version = ">= 1.5.0"\n}\n\nvariable "greeting" {\n  type        = string\n  description = "A greeting."\n  default     = "hello"\n}\n\noutput "greeting" {\n  value = var.greeting\n}\n',
      'README.md': readme('terraform', 'Run `terraform init`.', 'Run `terraform plan`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('.terraform/', '*.tfstate', '*.tfstate.*', '.env'),
    },
  },
  kubernetes: {
    files: {
      'deploy.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: example
  labels:
    app: example
spec:
  replicas: 2
  selector:
    matchLabels:
      app: example
  template:
    metadata:
      labels:
        app: example
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
        - name: example
          image: registry.example.com/example:1.0.0
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 10001
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
`,
      'README.md': readme('kubernetes', 'Run `kubectl apply -f deploy.yaml`.', 'Run `kubectl get deployments`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('.env'),
    },
  },
  'docker-compose-app': {
    files: {
      Dockerfile: 'FROM node:20.11.1-alpine3.19\nWORKDIR /app\nCOPY index.js ./\nUSER node\nHEALTHCHECK CMD node -e "process.exit(0)"\nCMD ["node", "index.js"]\n',
      '.dockerignore': 'node_modules\n.git\n.env\n',
      'compose.yaml': 'services:\n  app:\n    build: .\n    read_only: true\n    restart: unless-stopped\n    ports:\n      - "127.0.0.1:3000:3000"\n',
      'index.js': "process.stdout.write('hello\\n')\n",
      'README.md': readme('docker-compose-app', 'Run `docker compose build`.', 'Run `docker compose up`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('node_modules/', '.env'),
    },
  },
  'static-site': {
    files: {
      'index.html': html('Home of the example static site', '<h1>Home</h1>\n  <nav><a href="about.html">About</a> <a href="contact.html">Contact</a></nav>', '  <link rel="stylesheet" href="style.css">\n'),
      'about.html': html('About this example site', '<h1>About</h1>\n  <p><a href="index.html">Home</a></p>', '  <link rel="stylesheet" href="style.css">\n'),
      'contact.html': html('Contact the example site', '<h1>Contact</h1>\n  <p><a href="index.html">Home</a></p>', '  <link rel="stylesheet" href="style.css">\n'),
      'style.css': 'body {\n  font-family: system-ui, sans-serif;\n  margin: 0 auto;\n  max-width: 40rem;\n  color: #222;\n  background: #fff;\n}\n',
      'robots.txt': 'User-agent: *\nAllow: /\n',
      'README.md': readme('static-site', 'No install step: it is plain HTML.', 'Open `index.html` in a browser.'),
      LICENSE: MIT,
      '.gitignore': gitignore('.env'),
    },
  },
  monorepo: {
    files: {
      'package.json': pkgJson({ workspaces: ['packages/*'], engines: { node: '>=18' } }),
      'package-lock.json': lockfile,
      'packages/a/package.json': pkgJson({ name: '@example/a', main: 'index.js', engines: { node: '>=18' } }),
      'packages/a/index.js': "module.exports = 'a'\n",
      'packages/b/package.json': pkgJson({ name: '@example/b', main: 'index.js', engines: { node: '>=18' } }),
      'packages/b/index.js': "module.exports = 'b'\n",
      'README.md': readme('monorepo', 'Run `npm install`.', 'Each package lives under `packages/`.'),
      LICENSE: MIT,
      '.gitignore': gitignore('node_modules/', '.env'),
    },
  },
  'docs-only': {
    files: {
      'README.md': readme('docs-only', 'There is nothing to install: this is documentation.', 'Read the pages under `docs/`.'),
      'docs/guide.md': '# Guide\n\nA short guide to the project.\n\n## Steps\n\n1. Read the README.\n2. Read this guide.\n',
      'docs/faq.md': '# FAQ\n\n## What is this?\n\nA documentation-only project.\n',
      LICENSE: MIT,
      '.gitignore': gitignore('.env'),
    },
  },
  'empty-git-repo': { files: {}, git: 'empty' },
  'not-a-git-folder': { files: null, copyOf: 'node-cli', git: false },
}

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=Sam Rivera', '-c', 'user.email=sam.rivera@project.test', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: 'ignore', env: GIT_ENV })

const COMMON = { 'SECURITY.md': SECURITY, '.github/dependabot.yml': DEPENDABOT }

function write(dir, files) {
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body)
  }
}

// Creates the named fixtures (default all) under `root` and returns { name: folder }.
export function makeFixtures(root, names = Object.keys(FIXTURES)) {
  mkdirSync(root, { recursive: true })
  const out = {}
  for (const name of names) {
    const spec = FIXTURES[name]
    if (!spec) throw new Error(`no fixture called ${name}`)
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    const files = spec.copyOf ? FIXTURES[spec.copyOf].files : spec.files
    write(dir, Object.keys(files).length ? { ...COMMON, ...files } : files)
    if (spec.git !== false) {
      git(dir, 'init', '-q', '-b', 'main')
      if (spec.git === 'empty') git(dir, 'commit', '-q', '--allow-empty', '-m', 'Initial commit')
      else {
        git(dir, 'add', '-A')
        git(dir, 'commit', '-q', '-m', 'Initial commit')
      }
    }
    out[name] = dir
  }
  return out
}

const fixtureNames = () => Object.keys(FIXTURES)

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'meerkat-compat-'))
  const made = makeFixtures(root)
  for (const [name, dir] of Object.entries(made)) console.log(`${name.padEnd(20)} ${dir}`)
}
