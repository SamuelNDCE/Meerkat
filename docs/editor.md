# Meerkat in your editor

Meerkat prints findings in the same shape the editor already understands, so a problem shows up on its line. The ids are the same ones `meerkat findings` lists, so `meerkat finding <id>` explains any of them.

Two formats, for `meerkat run`, `meerkat verify` and the presets, and for `meerkat findings`:

| Format | What you get |
|---|---|
| `--format vscode` | One JSON array on stdout: `file`, `line`, `column`, `severity` (`error`, `warning`, `info`), `message`, `code`, plus `id` and `check`. |
| `--format jetbrains` | One line per finding: `path:line:col: severity: check: message [id]`. |

Only the editor output goes to stdout. Progress and notes go to stderr, so the JSON always parses. A finding with no file says `(no file)` at 1:1. Findings you dismissed or that a team rule accepts are left out.

## VS Code

A VS Code problem matcher reads output line by line, not JSON. So the task runs Meerkat with the line format (`--format jetbrains`, the same line shape) and the matcher reads it with a regular expression:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "meerkat quick",
      "type": "shell",
      "command": "meerkat",
      "args": ["quick", "--plain", "--format", "jetbrains"],
      "problemMatcher": {
        "owner": "meerkat",
        "fileLocation": ["relative", "${workspaceFolder}"],
        "pattern": {
          "regexp": "^(.+?):(\\d+):(\\d+): (error|warning|info): ([^:\\s]+): (.*)$",
          "file": 1,
          "line": 2,
          "column": 3,
          "severity": 4,
          "code": 5,
          "message": 6
        }
      },
      "presentation": { "reveal": "never" }
    }
  ]
}
```

An extension that wants the structured form runs `meerkat quick --plain --format vscode` and reads the array.

## JetBrains (IntelliJ, WebStorm, PyCharm, RustRover)

Run `meerkat quick --plain --format jetbrains` in a Run configuration (a Shell Script or a Node.js one). Then add the filter in Settings, Tools, Process Output Filters (the "Console" regex filter):

```
^(.+?):(\d+):(\d+): (error|warning|info): ([^:\s]+): (.*)$
```

Use the groups as: file `$1`, line `$2`, column `$3`. Each line in the console is then a link to the place.

## Check it

```
meerkat quick --plain --format jetbrains
meerkat findings --format vscode
```

The second reads the newest run and prints the same array without running anything.
