# Reference drivers

Drivers for the click-through runner (see `docs/click-through.md`). A driver is the only part that knows your stack.

## Windows (native apps): `windows-uia-driver.ps1`

Drives any native Windows app (Win32, WPF, WinForms, UWP, WinUI) through Windows UI Automation. It speaks the persistent protocol v2: one JSON object per line on stdin, one reply per line on stdout, logs on stderr. The window and its UI Automation tree are kept for the whole run.

Needs:

- **Windows PowerShell 5.1** (`powershell.exe`, built into Windows). `System.Windows.Automation` ships with it, so nothing is installed. PowerShell 7 (`pwsh`) has not been tried.
- **`UIA_WINDOW_TITLE`** set to a part of the window title, for example `Notepad`. Matching is case-insensitive and by substring. At `hello` the driver waits up to 20 seconds for the window (change with `UIA_WINDOW_WAIT_S`) and replies `ok: false` with `no window titled X within 20 s` if it never shows up.
- **The same privilege level as the app.** Windows blocks a normal process from automating an elevated (administrator) window. If the app runs as administrator, start the driver elevated too; otherwise it cannot find the window or its controls.
- A real, unlocked desktop session. The mouse fallback and `screenshot` need a visible window that is not minimised.

Scenario driver entry:

```json
{ "driver": { "cmd": "powershell.exe", "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "examples/drivers/windows-uia-driver.ps1"], "env": { "UIA_WINDOW_TITLE": "Notepad" } } }
```

Steps:

| Step | Fields | What it does |
|---|---|---|
| `open` | `url` (program path), optional `args` | Starts the program, then waits for the window |
| `click` | `text` or `selector` | Finds an element by name (or AutomationId), exact match first, buttons, menu items and links preferred. Uses InvokePattern, otherwise a mouse click at its centre |
| `type` | `selector`, `value` | Finds an editable Edit or Document element and sets its value with ValuePattern. `selector` may be `edit` for the first one, or part of its name |
| `wait-for` | `text` | Polls every 200 ms until an element with that name (or text value) appears, up to `timeoutMs` |
| `assert` | `text` | One check. Matches element names and the text value of editable elements |
| `screenshot` | `path` | Saves the window bounds as a PNG |

A failed lookup reports `expected: element named X` and `actual: not found; window has: ...` with the first 10 element names, so the next scenario edit is obvious.

Test it against a real window (Windows only, opens Notepad, off by default):

```powershell
$env:RUN_UIA_TESTS = '1'
npx vitest run tests/uiadriver.test.ts
```
