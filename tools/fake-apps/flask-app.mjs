// (d) A Python Flask app: a hard-coded secret and debug=True. Never run: the checks read the sources.
import { baseline, readme } from './kit.mjs'

const app = (secret, run) => `"""A tiny Flask app that lists tasks."""
import os

from flask import Flask, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)
limiter = Limiter(get_remote_address, app=app, default_limits=["60 per minute"])
app.config["SECRET_KEY"] = ${secret}


@app.get("/tasks")
def tasks():
    return jsonify([{"id": 1, "title": "write tests"}])


if __name__ == "__main__":
    ${run}
`

const clean = {
  ...baseline({ test: 'python -m unittest', ecosystem: 'pip', ignore: '__pycache__/\n.venv/\n' }),
  'README.md': readme('tasks-app', 'A tiny Flask app that lists tasks.', 'pip install -r requirements.txt', 'python app.py', 'python -m unittest'),
  'requirements.txt': 'flask==3.0.3\nflask-limiter==3.8.0\n',
  '.env.example': 'SECRET_KEY=\nPORT=5000\n',
  'pyproject.toml': '[project]\nname = "tasks-app"\nversion = "1.0.0"\ndescription = "A tiny Flask app that lists tasks."\nreadme = "README.md"\nrequires-python = ">=3.10"\nlicense = { text = "MIT" }\nclassifiers = ["Programming Language :: Python :: 3", "Framework :: Flask"]\n',
  'app.py': app('os.environ["SECRET_KEY"]', 'app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")))'),
  'tests/test_app.py': 'import unittest\n\n\nclass TaskTests(unittest.TestCase):\n    def test_titles(self):\n        self.assertEqual("write tests".split()[0], "write")\n\n\nif __name__ == "__main__":\n    unittest.main()\n',
}

const defective = {
  ...clean,
  'app.py': app('"hunter2-super-secret-key-9f8e7d6c"', 'app.run(debug=True)'),
}

export default {
  name: 'tasks-app',
  clean,
  defective,
  defects: [
    { check: 'debug-enabled', file: 'app.py', severity: 'medium' },
    { check: 'secrets-plus', rule: 'generic-keyword-secret', file: 'app.py', severity: 'critical' },
  ],
}
