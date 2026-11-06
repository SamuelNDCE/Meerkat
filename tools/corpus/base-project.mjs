// Complete base projects for the planted-defect corpus. A planted file alone is not a project: checks that need a whole project (licence,
// security policy, build config, lockfile, CI, tests) would fire on it whatever the rule under test says. So every defect and every clean
// twin is written INTO a complete, clean base project, replacing the one file the sample is about. The bases are the clean fake apps from
// tools/fake-apps (the same housekeeping kit), plus one small base per language the fake apps do not cover.
//
// baseFor(family, file) -> base name; baseTree(name) -> { relative path: text }. Deterministic, no network, nothing installed.
import { baseline, json, readme } from '../fake-apps/kit.mjs'
import electron from '../fake-apps/electron-app.mjs'
import express from '../fake-apps/express-api.mjs'
import flask from '../fake-apps/flask-app.mjs'
import react from '../fake-apps/react-ts.mjs'
import rust from '../fake-apps/rust-crate.mjs'

const TEST = 'make test'
// A small project of another language: the housekeeping kit, a README, a manifest and (where the ecosystem has one) a lockfile, one test.
const lang = (name, ecosystem, files) => ({
  ...baseline({ test: TEST, ecosystem }),
  'README.md': readme(name, `A small ${ecosystem} project.`, 'make install', 'make run', TEST),
  Makefile: 'install:\n\t@echo install\n\nrun:\n\t@echo run\n\ntest:\n\t@echo test\n',
  ...files,
})

const BASES = {
  electron: electron.clean,
  node: express.clean,
  react: react.clean,
  python: flask.clean,
  rust: rust.clean,
  go: lang('tally', 'gomod', { 'go.mod': 'module example.invalid/tally\n\ngo 1.22\n', 'go.sum': '', 'main_test.go': 'package main\n\nimport "testing"\n\nfunc TestOne(t *testing.T) {\n\tif 1+1 != 2 {\n\t\tt.Fatal("math")\n\t}\n}\n' }),
  java: lang('tally', 'maven', { 'pom.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>invalid.example</groupId>\n  <artifactId>tally</artifactId>\n  <version>1.0.0</version>\n  <licenses><license><name>MIT</name></license></licenses>\n</project>\n', 'src/test/java/TallyTest.java': 'public class TallyTest {\n  public void testOne() {\n    assert 1 + 1 == 2;\n  }\n}\n' }),
  dotnet: lang('Tally', 'nuget', { 'Tally.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <PackageLicenseExpression>MIT</PackageLicenseExpression>\n  </PropertyGroup>\n</Project>\n', 'tests/TallyTests.cs': 'public class TallyTests\n{\n    public void One() { }\n}\n' }),
  php: lang('tally', 'composer', { 'composer.json': json({ name: 'example/tally', description: 'A small project.', license: 'MIT', require: { php: '>=8.2' } }), 'composer.lock': json({ packages: [], 'packages-dev': [] }), 'tests/TallyTest.php': '<?php\n\nfinal class TallyTest\n{\n    public function testOne(): void\n    {\n    }\n}\n' }),
  ruby: lang('tally', 'bundler', { Gemfile: "source 'https://rubygems.org'\n\nruby '>= 3.2'\n", 'Gemfile.lock': 'GEM\n  remote: https://rubygems.org/\n  specs:\n\nPLATFORMS\n  ruby\n\nDEPENDENCIES\n\nBUNDLED WITH\n   2.5.0\n', 'test/tally_test.rb': "require 'minitest/autorun'\n\nclass TallyTest < Minitest::Test\n  def test_one\n    assert_equal 2, 1 + 1\n  end\nend\n" }),
}

const NODE_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'])
const BY_EXT = { py: 'python', rs: 'rust', toml: 'rust', go: 'go', java: 'java', cs: 'dotnet', php: 'php', rb: 'ruby' }

export function baseFor(family, file) {
  if (family === 'electron-plus') return 'electron'
  if (family === 'rust-plus') return 'rust'
  if (family === 'client-frameworks') return 'react'
  const ext = (file.split('.').pop() ?? '').toLowerCase()
  return NODE_EXT.has(ext) ? 'node' : (BY_EXT[ext] ?? 'node')
}

export const baseTree = (name) => {
  if (!BASES[name]) throw new Error(`no base project ${name}`)
  return BASES[name]
}
export const BASE_NAMES = Object.keys(BASES)

// Base variants: a few rules are about something the ordinary base would silence or already has, so the project that holds their planted
// file is a base with that one thing changed. The rule is not edited to pass; the project is made the kind the rule is about.
// ep-window-open-variable: the ordinary Electron main.js denies every window the page opens (setWindowOpenHandler), which is exactly what the
// rule treats as a reason not to report window.open(variable). This base has no such handler.
const NO_HANDLER = /\n {2}win\.webContents\.setWindowOpenHandler\([\s\S]*?\n {2}\}\)\n/
const noHandlerMain = BASES.electron['main.js'].replace(NO_HANDLER, '\n')
if (noHandlerMain === BASES.electron['main.js']) throw new Error('electron base main.js has no setWindowOpenHandler block to remove')
BASES['electron-no-open-handler'] = { ...BASES.electron, 'main.js': noHandlerMain }
// rcargo-no-lockfile-binary: a binary crate with no Cargo.lock; the ordinary Rust base ships a lockfile and has no main.rs.
const { 'Cargo.lock': _lock, ...rustNoLock } = BASES.rust
BASES['rust-no-lockfile'] = { ...rustNoLock, 'src/main.rs': 'fn main() {}\n' }
export const BASE_VARIANT = { 'ep-window-open-variable': 'electron-no-open-handler', 'rcargo-no-lockfile-binary': 'rust-no-lockfile' }
// The clean twin of the lockfile rule is the same binary crate WITH its Cargo.lock (the ordinary Rust base; the companion main.rs makes it a binary).
export const TWIN_BASE = { 'rcargo-no-lockfile-binary': 'rust' }
