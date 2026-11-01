// (b) A React/TypeScript front end with accessibility problems and an unhandled promise.
// Dependencies are declared and locked (with integrity hashes) but never installed: the checks read files only.
import { baseline, json, readme } from './kit.mjs'

const dep = (name, version) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', license: 'MIT' })

const pkg = json({ name: 'notes-ui', version: '1.0.0', private: true, license: 'MIT', engines: { node: '>=20' }, repository: { type: 'git', url: 'https://example.invalid/notes-ui.git' }, scripts: { test: 'node --test tests/' }, dependencies: { react: '18.3.1' } })
const lock = json({ name: 'notes-ui', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'notes-ui', version: '1.0.0', license: 'MIT', engines: { node: '>=20' }, dependencies: { react: '18.3.1' } }, 'node_modules/react': dep('react', '18.3.1') } })

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Notes is a small app for writing and keeping short notes in your browser." />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'" />
    <title>Notes: short notes</title>
    <link rel="stylesheet" href="src/styles.css" />
  </head>
  <body>
    <main id="root"></main>
    <script type="module" src="src/main.tsx"></script>
  </body>
</html>
`

const css = `:root { color-scheme: light; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1a1a1a; background: #ffffff; }
button { color: #ffffff; background: #1f4fbf; border: 0; padding: 8px 12px; }
button:focus-visible, input:focus-visible { outline: 3px solid #1f4fbf; outline-offset: 2px; }
`

const app = `import { useEffect, useState } from 'react'

type Note = { id: number; text: string }

export function NotesApp() {
  const [notes, setNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/notes')
      .then((r) => r.json())
      .then(setNotes)
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <section>
      <h1>Notes</h1>
      <img src="/logo.png" alt="Notes logo" width="64" height="64" />
      <label htmlFor="new-note">New note</label>
      <input id="new-note" type="text" />
      <button type="button" aria-label="Add note">Add</button>
      {error && <p role="alert">{error}</p>}
      <ul>
        {notes.map((n) => (
          <li key={n.id}>{n.text}</li>
        ))}
      </ul>
      <a href="https://example.invalid/help" target="_blank" rel="noopener noreferrer">Help</a>
    </section>
  )
}
`

const clean = {
  'package.json': pkg,
  'package-lock.json': lock,
  ...baseline({ test: 'npm test', ignore: 'node_modules/\ndist/\n' }),
  'README.md': readme('notes-ui', 'A small notes front end in React and TypeScript.', 'npm ci', 'npm run dev', 'npm test'),
  'index.html': html,
  'robots.txt': 'User-agent: *\nAllow: /\n',
  'src/styles.css': css,
  'src/main.tsx': `import { createRoot } from 'react-dom/client'\nimport { NotesApp } from './App'\n\ncreateRoot(document.getElementById('root')!).render(<NotesApp />)\n`,
  'src/App.tsx': app,
  'tsconfig.json': json({ compilerOptions: { target: 'ES2022', module: 'ESNext', jsx: 'react-jsx', strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true }, include: ['src'] }),
  'tests/app.test.js': `import test from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('notes are plain data', () => {\n  assert.deepEqual([{ id: 1, text: 'a' }].map((n) => n.id), [1])\n})\n`,
}

const defective = {
  ...clean,
  'src/App.tsx': app
    .replace("      .then(setNotes)\n      .catch((e) => setError(String(e)))\n", '      .then(setNotes)\n')
    .replace('<img src="/logo.png" alt="Notes logo" width="64" height="64" />', '<img src="/logo.png" width="64" height="64" />')
    .replace('<button type="button" aria-label="Add note">Add</button>', '<button type="button" aria-label=""></button>')
    .replace(' rel="noopener noreferrer"', ''),
  'src/styles.css': css.replace('button { color: #ffffff;', 'button { color: #e6e6e6;').replace('background: #1f4fbf; border', 'background: #f2f2f2; border'),
  'index.html': html.replace('<html lang="en">', '<html>'),
}

export default {
  name: 'notes-ui',
  clean,
  defective,
  defects: [
    { check: 'js-unhandled-promise', file: 'src/App.tsx', severity: 'medium' },
    { check: 'ui-static', file: 'src/App.tsx', severity: 'medium', match: 'img> with no alt' },
    { check: 'ui-static', file: 'src/App.tsx', severity: 'medium', match: 'empty <button>' },
    { check: 'target-blank-noopener', file: 'src/App.tsx', severity: 'high' },
    { check: 'ui-static', file: 'index.html', severity: 'medium', match: 'no lang attribute' },
    { check: 'css-contrast', file: 'src/styles.css', severity: 'medium' },
  ],
}
