// Critical planted defects, family: dangerous exec. A shell or process started from a string the caller controls. One defect per
// file; the "-clean" twin project has the same files with a fixed program and an argument array, and must not be reported.
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

export function projects(ctx) {
  const cases = [
    ['exec-js-destructured', 'src/ping-destructured.js', 'cp-js|risky-code', 'exec taken by destructuring require and called with a template literal', "const { exec, execFile } = require('child_process')", 'exec(`ping -c 1 ${host}`, (err, out) => console.log(out))', "execFile('ping', ['-c', '1', host], (err, out) => console.log(out))"],
    ['exec-js-renamed', 'src/lookup-renamed.mjs', 'cp-js|risky-code', 'exec imported under another name and called with concatenation', "import { exec as run, execFile as runFile } from 'node:child_process'", "export const lookup = (name) => run('nslookup ' + name)", "export const lookup = (name) => runFile('nslookup', [name])"],
    ['exec-js-spawn-shell', 'src/git-log.js', 'cp-js|risky-code', 'spawn with shell true and a caller supplied branch', "const cp = require('child_process')", "cp.spawn('git', ['log', branch], {\n  shell: true,\n})", "cp.spawn('git', ['log', branch], {\n  shell: false,\n})"],
    ['exec-py-shell-true', 'src/run_shell.py', 'risky-code|cp-python', 'Popen with shell=True on a caller supplied command', 'import subprocess', 'subprocess.Popen(\n    cmd,\n    shell=True,\n)', 'subprocess.Popen(\n    ["convert", cmd],\n    shell=False,\n)'],
    ['exec-py-check-output', 'src/grep.py', 'risky-code|cp-python', 'check_output with an f-string and shell=True', 'import subprocess', 'out = subprocess.check_output(f"grep {term} {path}", shell=True)', 'out = subprocess.check_output(["grep", term, path])'],
    ['exec-py-alias-call', 'src/clean.py', 'risky-code|cp-python', 'subprocess.call imported under another name with shell=True', 'from subprocess import call as invoke', 'invoke("rm -rf " + directory, shell=True)', 'invoke(["rm", "-rf", directory])'],
    ['exec-py-popen', 'src/popen.py', 'cp-python', 'os.popen with a variable command', 'import os', 'text = os.popen(command).read()', 'text = open(command).read()'],
    ['exec-go-sh-c', 'src/run.go', 'cp-go', 'exec.Command sh -c with a caller supplied directory', 'package main\n\nimport "os/exec"', 'var out, err = exec.Command("sh", "-c", "ls "+dir).Output()', 'var out, err = exec.Command("ls", dir).Output()'],
    ['exec-go-bash-c', 'src/runbash.go', 'cp-go', 'bash -c over lines with a user command', 'package main\n\nimport "os/exec"', 'var cmd2 = exec.Command(\n\t"bash", "-c",\n\tuserCmd,\n)', 'var cmd2 = exec.Command(\n\t"/usr/bin/true",\n)'],
    ['exec-rs-format', 'src/run.rs', 'cp-rust', 'Command::new with a format! built program', 'use std::process::Command;', 'fn a(dir: &str) { Command::new(&format!("ls {}", dir)).output().ok(); }', 'fn a(dir: &str) { Command::new("ls").arg(dir).output().ok(); }'],
    ['exec-php-shell-exec', 'src/ping.php', 'cp-dotnet-php-ruby', 'shell_exec with an interpolated host', '<?php', '$out = shell_exec("ping -c 1 $host");', '$out = shell_exec("ping -c 1 " . escapeshellarg($host));'],
    ['exec-rb-backtick', 'src/ls.rb', 'cp-dotnet-php-ruby', 'backticks with an interpolated parameter', "require 'shellwords'", 'out = `ls #{params[:dir]}`', 'out = IO.popen(["ls", params[:dir]]).read'],
  ]
  return mk('exec', ctx, cases)
}
