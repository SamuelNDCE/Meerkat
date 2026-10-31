# Checks that run your project (functionality-run)

> **These checks run your project's code.** They install its dependencies, run its build and tests, run commands from its README and start its app. That is why they are **opt-in**: they never run in a normal `meerkat verify`. Turn them on with `--include runtime`, or run one by name with `meerkat check <id>`.

Most checks read files. These ones prove the project works: they take what is in git, put it in a fresh temp folder and use it the way a new person (or a CI machine) would.

## How to turn them on

| You type | What happens |
|---|---|
| `meerkat verify --thorough --include runtime` | all five run with the other thorough checks |
| `meerkat check clean-copy-builds` | one of them runs, even without `--include` |
| `node thorough/functionality-run.mjs <check> --root <folder>` | one script by hand |
| `node thorough/functionality-run.mjs <check> --fixtures` | the check's own self-test; it must exit 1 |

## The five checks

| Check | What it does | Fails when | NOT RUN (exit 75) when |
|---|---|---|---|
| `clean-copy-builds` | Copies the git-tracked files to a temp folder, then runs install, build and test (each with its own time limit). | A step exits non-zero or times out. The report names the step, the last 3 lines of its output, the files it could not find, and the files that exist in your folder but are not tracked by git (the usual cause). | no build or test command is found; the install fails with a network error; the folder is too big to copy |
| `install-reproducible` | Runs the frozen install in a clean copy: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`, `cargo build --locked`, `go mod verify`, or `pip install --dry-run --no-deps -r requirements.txt`. Compares the lockfile hash before and after. | The command fails (the lockfile does not match the manifest) or it rewrote the lockfile. | there is no lockfile; the network is needed and not reachable |
| `readme-commands-work` | Takes the shell commands from README.md (lines starting with `$`, and every line of a bash, sh, shell, console or powershell block) and runs only those on a strict allowlist, each with a 60 second limit. One sub-check line per command. | A documented command that is allowed to run exits non-zero. | the README has no commands, or none is on the allowlist (nothing was verified) |
| `flaky-tests` | Runs the test command several times in one clean copy. | The same tests pass in one run and fail in another. It names the runs and shows the end of a failing run. (Tests that fail every time are broken, not flaky: reported as not applicable.) | there is no test command; one run is slower than `testSeconds` divided by the number of runs |
| `env-example-boot` | Needs `.env.example` and a start (or dev) command. Writes a `.env` in the copy with dummy values for non-secret keys, runs the start command for up to 15 seconds. | The app stops with an error about a missing environment variable that `.env.example` does not list (an undocumented variable). | no `.env.example`, no start command, the install or build fails first |

Sub-check lines follow `docs/suites.md` (`MEERKAT-SUB <PASS|FAIL|NA> <rule-id> <reason>`). `readme-commands-work` prints one per command, so you can see which documented commands were verified and which were skipped ("not allowlisted").

### What the README allowlist accepts

`npm install`, `npm ci` (bare, or with `--no-audit`, `--no-fund`, `--ignore-scripts`, `--legacy-peer-deps`, `--prefer-offline`), `npm test`, `npm run <script>` (the script must exist and must not be a server script such as start, dev, serve, watch), `npm start --help`, `npx <tool> --help|--version` (only for a tool that is a dependency of the project, run with `--no-install`), `node <file> --help|--version`, `python <file> --help|--version` (the file must be inside the project), `pip install -r <file>` (run as a dry run), `cargo build|test`, `go build|test`, and `make <target>` for a target in the Makefile (not install, deploy, publish and similar).

Everything else is reported as not applicable with the reason "not allowlisted". Always refused: `sudo`, `curl`, `wget`, pipes, redirects, `;`, `&`, backticks, `$` variables and substitutions, quotes, `~`, `*`, and the programs `rm`, `git`, `docker`, `ssh`, `scp`, `kubectl`, `terraform`, `cd`, `export`, `echo`, `cat` and package managers of the system (`apt`, `brew`, `winget`, ...).

### What `env-example-boot` writes

A key whose name looks secret (SECRET, TOKEN, KEY, PASSWORD, CREDENTIAL, AUTH, DSN, CERT, SALT, COOKIE, SESSION and similar) is **left unset**. No secret is ever invented. Other keys with an empty or placeholder value get a dummy: `PORT` 0, `HOST` 127.0.0.1, `*_URL` http://127.0.0.1:9, `DEBUG` false, `NODE_ENV` development, otherwise "placeholder". A URL to a real host is replaced by a local one. The values are passed to the process and written to `.env` in the copy only.

## Safety model

1. **Opt-in.** Nothing here runs unless you ask (`--include runtime` or naming the check).
2. **A temp copy only.** The project is copied to a folder under the OS temp directory using `git ls-files`, so only tracked files are there (no `node_modules`, no `.env`, no build output). Files over 2 MB are skipped when the folder is over 200 MB; if it is still over the cap the check is NOT RUN. Without git, it walks the folder and skips `node_modules`, `.git`, `target`, `dist`, `build`, `venv` and `.venv`, and says so.
3. **Never writes to your folder.** All commands run with the copy as their working directory. The only things done in your folder are read-only: `git ls-files` (tracked, untracked and ignored lists) and reading the budgets file. The tests hash the folder before and after.
4. **A scrubbed environment.** The process gets only `PATH` (and `SystemRoot`, `ComSpec`, `PATHEXT` on Windows), a temp `HOME`/`USERPROFILE`, `TMP`/`TEMP`, `LANG`, `CI=1`, `NO_COLOR=1`, `npm_config_update_notifier=false` and `DO_NOT_TRACK=1`. No token, key, cloud credential, proxy setting or npm auth passes through, and your real home folder (npm, git, pip, cloud configs) is not read.
5. **No shell.** Programs start directly with an argument list. On Windows a `.cmd` shim (npm) goes through `cmd.exe` only after the arguments are checked for shell metacharacters.
6. **Hard time limits that kill the whole tree** (`taskkill /T /F` on Windows, a process-group kill elsewhere), and a cap on captured output.
7. **Cleanup even when interrupted.** The temp copy and temp home are removed at the end, on exit and on Ctrl+C. The remover refuses any path outside the OS temp folder.
8. **Honest limits.** The project's own scripts still run, and a malicious script can still use the network or the CPU inside that temp copy. Only run these on code you trust to that degree. `env-example-boot` does not block the network; it only passes no remote URLs.

## Budgets

In `.meerkat-budgets.json`, under `run` (seconds unless noted):

```json
{ "run": { "installSeconds": 600, "buildSeconds": 600, "testSeconds": 900, "readmeSeconds": 60, "bootSeconds": 15, "flakyRuns": 3 } }
```

`flakyRuns` is at least 2 and at most 10. The environment variable `MEERKAT_RUN_BUDGETS` (a JSON object with the same keys) overrides single values for one run, for example `MEERKAT_RUN_BUDGETS='{"testSeconds":60}'`.

## How to read a failure

- **`clean-copy-builds` FAIL, "files it could not find"**: the build needs a file that is not in git. The "probable cause" line lists files that exist in your folder but are untracked (`git add` them) or ignored by `.gitignore` (the build should not depend on them). This is the classic "works on my machine".
- **FAIL on install in `install-reproducible`**: the lockfile and the manifest disagree. Run the normal install on your machine and commit the lockfile it writes.
- **`readme-commands-work` FAIL**: a command the README tells people to type does not work in a clean copy. Fix the README or the project. "Not allowlisted" lines are not failures, they are commands Meerkat chose not to run.
- **`flaky-tests` FAIL**: read which runs failed and the end of the failing output; the usual causes are shared state between tests, clocks, ports and test order.
- **`env-example-boot` FAIL**: the app needs a variable that `.env.example` does not document. Add it to `.env.example`.
- **NOT RUN** is never a pass. The first line says why (no command found, no network, too slow).

The shared helper is `thorough/sandbox.mjs` (`makeCleanCopy`, `scrubbedEnv`, `runIn`, `detectCommands`, `cleanup`); other run-the-project checks should reuse it rather than spawn project code themselves.
