// The python pack: the usual Python checks, from tools you install with pip. Turn it on with { "packs": ["python"] }.
import { tool } from '../../lib/tool-check.mjs'

const PY = ['**/*.py', 'pyproject.toml', 'requirements*.txt']

export default [
  tool({ id: 'ruff', expect: 'F401', bin: 'ruff', args: ['check', '.'], fixture: ['check', '--isolated', 'fixtures/tools/ruff/broken.py'], install: 'pip install ruff', title: 'Ruff: lint and import order', weight: 'tiny', estSeconds: 3, paths: PY }),
  tool({ id: 'mypy', expect: 'Incompatible types', bin: 'mypy', args: ['.'], fixture: ['--ignore-missing-imports', 'fixtures/tools/mypy/broken.py'], install: 'pip install mypy', title: 'mypy: type errors', estSeconds: 30, paths: PY }),
  tool({ id: 'pytest', expect: 'assert 1 == 2', bin: 'pytest', args: ['-q'], fixture: ['-q', '-p', 'no:cacheprovider', 'fixtures/tools/pytest/test_broken.py'], install: 'pip install pytest', title: 'pytest: the test suite', weight: 'heavy', estSeconds: 60, paths: PY }),
  tool({ id: 'bandit', expect: 'B602|shell=True', bin: 'bandit', args: ['-r', '.', '-q', '--exclude', './.venv,./venv,./node_modules'], fixture: ['-q', 'fixtures/tools/bandit/broken.py'], install: 'pip install bandit', title: 'Bandit: common Python security mistakes', group: 'security', estSeconds: 10, paths: PY }),
  tool({ id: 'dead-python', expect: 'never_used', bin: 'vulture', args: ['.', '--min-confidence', '80', '--exclude', '.venv,venv,node_modules'], fixture: ['--min-confidence', '60', 'fixtures/tools/vulture/broken.py'], install: 'pip install vulture', title: 'Dead Python code (vulture)', group: 'refactor', tier: 'thorough', estSeconds: 10, paths: PY }),
]
