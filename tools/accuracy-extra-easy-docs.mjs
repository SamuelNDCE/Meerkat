// Planted defects, EASY tier, docs, data files and HTML: a one-line pattern a rule finds without needing context (Markdown structure,
// common typos, changelog headings, invalid JSON, plain HTML accessibility slips, links that open a new tab).
// Each has a clean twin in `easy-docs-clean`. Keys are prefixed `easy-`.

export function projects(ctx) {
  const { d, tidy } = ctx
  const expect = {}
  const bad = {}
  const good = {}
  const add = (key, id, desc, file, pre, line, post, fix) => {
    const k = `easy-${key}`
    expect[k] = id
    bad[file] = [...pre, d(k, desc, line), ...post, '']
    good[file] = [...pre, fix, ...post, '']
  }
  const page = (...body) => ['<!doctype html>', '<html lang="en">', '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page</title></head>', '<body>', '<main>', ...body]
  const pageEnd = ['</main>', '</body>', '</html>']

  // ---------------------------------------------------------------- Markdown
  add('md-heading-skip', 'markdown-headings', 'a heading that jumps from level 2 to level 4', 'docs/e_heading.md', ['# Guide', '', '## Setup', ''], '#### Details', ['', 'Run the installer.'], '### Details')
  add('md-heading-skip-h3', 'markdown-headings', 'a heading that jumps from level 1 to level 3', 'docs/e_heading2.md', ['# Reference', ''], '### Options', ['', 'See the table below.'], '## Options')
  add('md-anchor-broken', 'markdown-anchors', 'a link to a heading that does not exist', 'docs/e_anchor.md', ['# Guide', '', '## Install', ''], 'See [the usage section](#usage-notes) next.', ['', '## Usage'], 'See [the usage section](#usage) next.')
  add('md-anchor-renamed', 'markdown-anchors', 'a link to an anchor spelt another way', 'docs/e_anchor2.md', ['# Guide', '', '## Getting started', ''], 'Back to [start](#get-started).', [], 'Back to [start](#getting-started).')
  add('md-fence-unclosed', 'markdown-code-fences', 'a code fence that is never closed', 'docs/e_fence.md', ['# Example', ''], '```sh\nnpm install', ['', 'Then start the app.'], '```sh\nnpm install\n```')
  add('md-typo-recieve', 'spell-common-typos', 'common misspellings in a README paragraph', 'docs/e_typo.md', ['# Notes', ''], 'You will recieve an email once the build has finnished.', [], 'You will receive an email once the build has finished.')
  add('md-typo-seperate', 'spell-common-typos', 'common misspellings in a list item', 'docs/e_typo2.md', ['# Notes', ''], '- Keep the config in a seperate file and the enviroment in another.', [], '- Keep the config in a separate file and the environment in another.')
  add('txt-typo-teh', 'spell-common-typos', 'a misspelling in a plain text file', 'docs/e_typo.txt', ['Release notes'], 'Make sure teh service is running and the adress is correct.', [], 'Make sure the service is running and the address is correct.')
  add('changelog-no-date', 'changelog-format', 'a version heading with no date', 'CHANGELOG.md', ['# Changelog', '', '## 1.3.0 - 2026-10-01', '- added export', ''], '## 1.2.0', ['- fixed the login redirect'], '## 1.2.0 - 2026-09-01')

  // ---------------------------------------------------------------- data files
  add('json-trailing-comma', 'json-valid', 'a trailing comma in a JSON file', 'data/e_trailing.json', ['{', '  "name": "demo",'], '  "items": [1, 2, 3,],', ['  "ok": true', '}'], '  "items": [1, 2, 3],')
  add('json-single-quotes', 'json-valid', 'single quotes in a JSON file', 'data/e_quotes.json', ['{'], "  'name': 'demo'", ['}'], '  "name": "demo"')
  add('json-duplicate-key', 'json-duplicate-keys', 'a key given twice in one JSON object', 'data/e_dup.json', ['{', '  "port": 80,'], '  "port": 8080,', ['  "host": "localhost"', '}'], '  "bind": 8080,')
  add('toml-unclosed-string', 'toml-valid', 'a TOML string that is never closed', 'data/e_unclosed.toml', ['[server]'], 'name = "demo', ['port = 80'], 'name = "demo"')
  add('yaml-tab-indent', 'yaml-valid', 'a tab used as indentation in YAML', 'data/e_tab.yaml', ['service:', '  name: demo'], '\tport: 80', [], '  port: 80')
  add('csv-ragged-row', 'csv-consistent', 'a CSV row with a missing column', 'data/e_rows.csv', ['id,name,score', '1,ana,4'], '2,bo', ['3,cy,5'], '2,bo,3')

  // ---------------------------------------------------------------- HTML
  add('html-img-no-alt', 'image-alt-quality|ui-static|html-valid-basics', 'an image with no alt attribute', 'site/e_img.html', page('<h1>Team</h1>'), '<img src="team.jpg">', pageEnd, '<img src="team.jpg" alt="The team at the 2026 offsite">')
  add('html-link-click-here', 'link-text', 'link text that says click here', 'site/e_link.html', page('<h1>Docs</h1>'), '<a href="/docs">Click here</a>', pageEnd, '<a href="/docs">Read the documentation</a>')
  add('html-blank-no-rel', 'target-blank-noopener', 'a link that opens a new tab with no rel noopener', 'site/e_blank.html', page('<h1>Links</h1>'), '<a href="https://example.com" target="_blank">Example</a>', pageEnd, '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Example</a>')
  add('html-inline-onclick', 'inline-event-handlers', 'an inline onclick handler', 'site/e_inline.html', page('<h1>Buttons</h1>'), '<button onclick="save()">Save</button>', pageEnd, '<button id="save">Save</button>')
  add('html-iframe-no-title', 'iframe-title', 'an iframe with no title', 'site/e_iframe.html', page('<h1>Map</h1>'), '<iframe src="https://maps.example.com/embed"></iframe>', pageEnd, '<iframe src="https://maps.example.com/embed" title="Office map"></iframe>')
  add('html-duplicate-id', 'duplicate-ids', 'the same id used twice on a page', 'site/e_dupid.html', page('<h1>Form</h1>', '<div id="panel">one</div>'), '<div id="panel">two</div>', pageEnd, '<div id="panel-two">two</div>')
  add('html-sri-missing', 'sri-missing', 'a third-party script with no integrity attribute', 'site/e_sri.html', page('<h1>App</h1>'), '<script src="https://cdn.example.com/lib.js"></script>', pageEnd, '<script src="https://cdn.example.com/lib.js" integrity="sha384-AAAA" crossorigin="anonymous"></script>')
  add('html-table-no-th', 'table-headers', 'a data table with no header cells', 'site/e_table.html', page('<h1>Scores</h1>'), '<table><tr><td>Ana</td><td>4</td></tr><tr><td>Bo</td><td>3</td></tr></table>', pageEnd, '<table><tr><th>Name</th><th>Score</th></tr><tr><td>Ana</td><td>4</td></tr><tr><td>Bo</td><td>3</td></tr></table>')
  add('css-outline-none', 'focus-visible', 'focus outline removed with no replacement', 'site/e_focus.css', ['button:focus {'], '  outline: none;', ['}'], '  outline: 2px solid #1a56db;')

  // ---------------------------------------------------------------- one-file hygiene in package.json
  add('pkg-star-version', 'wildcard-versions', 'a dependency pinned to *', 'pkgs/e_star/package.json', ['{', '  "name": "e-star", "version": "1.0.0", "license": "MIT", "private": true,', '  "dependencies": {', '    "left": "1.0.0",'], '    "right": "*"', ['  }', '}'], '    "right": "2.1.0"')
  add('pkg-latest-version', 'wildcard-versions|dependency-pinning', 'a dependency pinned to latest', 'pkgs/e_latest/package.json', ['{', '  "name": "e-latest", "version": "1.0.0", "license": "MIT", "private": true,', '  "dependencies": {', '    "left": "1.0.0",'], '    "right": "latest"', ['  }', '}'], '    "right": "2.1.0"')
  add('req-unpinned', 'dependency-pinning', 'a Python requirement with no version', 'pkgs/e_req/requirements.txt', ['flask==3.0.3'], 'requests', ['gunicorn==22.0.0'], 'requests==2.32.3')

  const name = 'easy-docs'
  return {
    projects: {
      [name]: { files: { ...tidy(name), ...bad } },
      [`${name}-clean`]: { files: { ...tidy(`${name}-clean`), ...good } },
    },
    expect,
  }
}
