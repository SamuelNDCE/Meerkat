# Reference drivers

`cdp-driver.mjs` is a reference click-through driver. It speaks persistent protocol v2 (one JSON object per line on stdin and stdout) and drives a page over the Chrome DevTools Protocol. It has no dependencies: it uses the built-in `fetch` and `WebSocket` of Node 22 or newer. Logs go to stderr only.

## 1. Start the target with a debugging port

The driver connects to `http://127.0.0.1:<port>/json/list` and attaches to the first page target. The port comes from the `CDP_PORT` environment variable (default `9222`).

Electron app: start it with the port flag, or the driver cannot connect.

```powershell
.\node_modules\.bin\electron . --remote-debugging-port=9222
```

Edge (ships with Windows) or Chrome: use a throwaway profile so it does not attach to your normal browser session.

```powershell
& "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\meerkat-cdp"
```

```powershell
chrome --remote-debugging-port=9222 --user-data-dir="$env:TEMP\meerkat-cdp"
```

## 2. Point a scenario at the driver

In the scenario's `driver` block, run the file with Node. Pass the port with `CDP_PORT` if it is not 9222.

```json
{
  "name": "save flow",
  "driver": { "cmd": "node", "args": ["examples/drivers/cdp-driver.mjs"] },
  "steps": [
    { "type": "open", "url": "http://localhost:3000/" },
    { "type": "click", "text": "Save" },
    { "type": "wait-for", "text": "Saved", "timeoutMs": 5000 },
    { "type": "assert", "text": "Saved" },
    { "type": "screenshot", "path": "saved.png" }
  ]
}
```

Supported steps: `open {url}`, `click {text|selector}`, `type {selector, value}`, `wait-for {text|url|urlMatches}`, `assert {text|element|urlMatches}`, `screenshot {path}`. A failing step replies with `expected` and `actual`. A missed click says `not found` and includes the first 200 characters of the page text.

## What it does not do yet

- It attaches to the first page target only. No tab or window switching, and no choosing a target by title or URL.
- Clicks are located by visible text or CSS selector in the main document. Elements inside iframes and shadow DOM are not found.
- No keyboard steps other than `type`, which inserts text. No key presses, hover, drag, select boxes, file upload or dialog handling.
- `open` waits for `document.readyState` to be `complete`. Single-page apps that load data afterwards need a `wait-for`.
- No reconnect: if the app or browser exits mid-run, the next step fails with a driver error.
- Tested against a fake CDP client only. It has not been run against a real Electron app or browser yet.Drivers for the click-through runner (see `docs/click-through.md`). A driver is the only part that knows your stack. This file covers `cdp-driver.mjs` (browsers and Electron) and `windows-uia-driver.ps1` (native Windows apps).

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
