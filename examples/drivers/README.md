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
- Tested against a fake CDP client only. It has not been run against a real Electron app or browser yet.
