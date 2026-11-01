# Reference: outside tools, discovery and fallbacks

Some checks run a well-known outside tool (eslint, prettier, typos, yamllint, shellcheck and so on). If the tool is missing the check is NOT RUN, which is honest: nothing was checked. Meerkat reduces how often that happens without ever faking a pass.

## Where Meerkat looks for a tool

In this order, after the real `PATH` (a folder inside the project can never shadow `node`, `python`, `git` or `cargo`):

1. the project's `node_modules/.bin` (the app folder and the repository root)
2. the project's python virtual environment (`.venv` or `venv`: `Scripts` on Windows, `bin` elsewhere)
3. Meerkat's private tool cache, `~/.meerkat/tools/node_modules/.bin` (override the folder with `MEERKAT_TOOLS_DIR`)
4. cargo bin (`~/.cargo/bin`, or `CARGO_HOME`), Go bin (`GOBIN`, `GOPATH/bin`, `~/go/bin`), dotnet tools (`~/.dotnet/tools`)

On Windows the `.cmd` shims (for example `eslint.cmd`) resolve through `PATHEXT`.

## `meerkat tools` and `meerkat tools install`

`meerkat tools` lists every optional tool, whether it is found and where, and prints ONE combined install command per ecosystem for what is missing. `meerkat doctor` ends with the same one-line summary of missing tools.

`meerkat tools install` installs only the missing npm-based tools (eslint, prettier, typescript, madge, htmlhint, stylelint, markdownlint-cli2). It runs `npm install --prefix ~/.meerkat/tools --ignore-scripts`: never inside your project, never global, and no package install scripts run. It shows the package list first and asks for a yes; `--yes` skips the question, `--dry-run` shows the list and stops. Tools that are not npm packages (pip, cargo, system programs) are only listed with their command; Meerkat does not install those.

## Built-in fallbacks

Five checks have a small built-in fallback that runs ONLY when the real tool is not found. When the real tool is present, the real tool runs. A fallback's output always says `built-in fallback`, so the report never passes it off as the real tool. Each checks a small subset, so it can miss things the real tool finds, but it does not invent problems.

| Check | Real tool | Built-in fallback checks |
|---|---|---|
| `typos` | typos | a short list of well-known misspellings, in documents and whole-line code comments only (code blocks, inline code and URLs are skipped; add `typos: ignore` on a line to skip it) |
| `yamllint` | yamllint | tab indentation and duplicate keys in one mapping (template files with `{{` are skipped) |
| `markdownlint` | markdownlint-cli2 | a code fence never closed, a heading that jumps down more than one level, a link with an empty target |
| `local-links` | lychee | a relative link in a `.md` file whose target file does not exist (offline) |
| `shellcheck` | shellcheck | syntax errors via `bash -n` (nothing is run; CRLF line ends are ignored); NOT RUN if there is no bash or sh. Does not find the style problems shellcheck finds |

Each fallback proves itself in `meerkat self-test` against a bad sample in `fixtures/tools/builtin/<name>/`.

## When a check is still NOT RUN

The reason is one line, for example `needs prettier: meerkat tools install`. Checks with no honest plain-Node substitute (eslint, prettier, tsc, madge, hadolint, actionlint) stay NOT RUN until the tool is installed.
