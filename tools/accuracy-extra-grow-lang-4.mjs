// Grown planted defects, part 4: notebooks and data files (a churn analysis, a sales pipeline's data folder, a dashboard's config files).
// Same layout as parts 1 to 3: one distinct line per case in its own file, a "-clean" twin with the safe version. A notebook is written as
// readable JSON lines so the planted line is the line that holds the problem. Tier comments feed tools/accuracy-tier-fragments/grow-lang.txt.
// Case: [key, file, expected check(s), description, text before, bad line, good line, text after].

const mk = (name, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`grow-lang-${name}`) }
  const good = { ...tidy(`grow-lang-${name}-clean`) }
  for (const [k, file, exp, desc, pre, badText, goodText, post = ''] of cases) {
    if (exp) expect[k] = exp
    const tail = post ? [post] : []
    bad[file] = [pre, d(k, desc, badText), ...tail, '', '', '', '', '']
    good[file] = [pre, goodText, ...tail, '']
  }
  return { projects: { [`grow-lang-${name}`]: { files: bad }, [`grow-lang-${name}-clean`]: { files: good } }, expect }
}

const merge = (parts) => ({ projects: Object.assign({}, ...parts.map((p) => p.projects)), expect: Object.assign({}, ...parts.map((p) => p.expect)) })

// A one-cell notebook split around the line that is planted: the cell source line, the execution count line or an output text line.
const NB_HEAD = '{\n "cells": [\n  {\n   "cell_type": "code",'
const NB_TAIL = ' ],\n "metadata": {},\n "nbformat": 4,\n "nbformat_minor": 5\n}'
const SRC_PRE = NB_HEAD + '\n   "execution_count": null,\n   "metadata": {},\n   "outputs": [],\n   "source": ['
const SRC_POST = '   ]\n  }\n' + NB_TAIL
const OUT_PRE = NB_HEAD + '\n   "execution_count": null,\n   "metadata": {},\n   "outputs": [\n    {\n     "name": "stdout",\n     "output_type": "stream",\n     "text": ['
const OUT_POST = '     ]\n    }\n   ],\n   "source": [\n    "print(1)"\n   ]\n  }\n' + NB_TAIL

export function projects(ctx) {
  const { S } = ctx
  const parts = []

  parts.push(mk('notebook-churn', ctx, [
    ['grow-lang-nb-mac-home-path', 'notebooks/churn.ipynb', 'notebook-absolute-paths', 'a churn notebook that reads a CSV from one analyst\'s home folder', SRC_PRE, '    "df = pd.read_csv(\'/Users/priya/Documents/churn.csv\')"', '    "df = pd.read_csv(\'data/churn.csv\')"', SRC_POST], // tier: impact=low difficulty=easy
    ['grow-lang-nb-linux-home-path', 'notebooks/features.ipynb', 'notebook-absolute-paths', 'a feature notebook that loads from a Linux home folder', SRC_PRE, '    "features = pd.read_parquet(\'/home/ubuntu/work/features.parquet\')"', '    "features = pd.read_parquet(\'data/features.parquet\')"', SRC_POST], // tier: impact=low difficulty=easy
    ['grow-lang-nb-pip-unpinned', 'notebooks/setup.ipynb', 'notebook-pip-magics', 'a setup cell that installs packages with no versions', SRC_PRE, '    "!pip install pandas scikit-learn matplotlib"', '    "!pip install pandas==2.2.2 scikit-learn==1.5.0 matplotlib==3.9.0"', SRC_POST], // tier: impact=low difficulty=easy
    ['grow-lang-nb-pip-percent-torch', 'notebooks/gpu.ipynb', 'notebook-pip-magics', 'a %pip install of torch with a loose version', SRC_PRE, '    "%pip install torch>=2.0"', '    "%pip install torch==2.3.1"', SRC_POST], // tier: impact=low difficulty=easy
    ['grow-lang-nb-openai-key-in-source', 'notebooks/ask.ipynb', 'notebook-secrets|secret-scan', 'an OpenAI style key assigned in a notebook cell', SRC_PRE, '    "openai.api_key = \'sk-proj-' + 'a8Fk2LmQ9xT4vB7nR1cW6yZ3'.slice(0, 24) + '\'"', '    "openai.api_key = os.environ[\'OPENAI_API_KEY\']"', SRC_POST], // tier: impact=critical difficulty=easy
    ['grow-lang-nb-github-token-output', 'notebooks/clone.ipynb', 'notebook-secrets|secret-scan', 'a GitHub token echoed in a notebook output', OUT_PRE, `      "token=${S.ghPat}\\n"`, '      "ok\\n"', OUT_POST], // tier: impact=critical difficulty=easy
    ['grow-lang-nb-executed-outputs', 'notebooks/eda.ipynb', 'notebook-outputs-stripped', 'a notebook committed with an execution count and output', NB_HEAD, '   "execution_count": 12,', '   "execution_count": null,', '   "metadata": {},\n   "outputs": [],\n   "source": [\n    "df.describe()"\n   ]\n  }\n' + NB_TAIL], // tier: impact=low difficulty=easy
    ['grow-lang-nb-pickle-load-arg', 'notebooks/score.ipynb', 'pickle-load', 'a scoring notebook that loads a model file from a path held in a variable', SRC_PRE, '    "model = joblib.load(model_path)"', '    "model = joblib.load(\'model.joblib\')"', SRC_POST], // tier: impact=high difficulty=medium
    ['grow-lang-nb-trailing-comma-json', 'notebooks/broken.ipynb', 'notebook-valid-json', 'a notebook file with a trailing comma, so it no longer opens', NB_HEAD + '\n   "execution_count": null,\n   "metadata": {},\n   "outputs": [],\n   "source": [\n    "x = 1"\n   ]\n  }\n ],\n "metadata": {},\n "nbformat": 4,', ' "nbformat_minor": 5,', ' "nbformat_minor": 5', '}'], // tier: impact=medium difficulty=easy
  ]))

  parts.push(mk('data-salesfolder', ctx, [
    ['grow-lang-data-csv-short-row', 'data/orders.csv', 'csv-consistent', 'an orders export with a row missing its last column', 'id,customer,total\n1,acme,40.00\n2,globex,15.50', '3,initech', '3,initech,22.00', '4,umbrella,9.99'], // tier: impact=low difficulty=easy
    ['grow-lang-data-csv-long-row', 'data/returns.csv', 'csv-consistent', 'a returns export where one row has an extra comma', 'id,order,reason\n1,1001,damaged', '2,1002,late,extra', '2,1002,late', '3,1003,wrong item'], // tier: impact=low difficulty=easy
    ['grow-lang-data-json-comment', 'config/dashboard.json', 'json-valid', 'a dashboard config with a // comment inside the JSON', '{', '  // refresh every minute', '  "note": "refresh every minute",', '  "refresh": 60\n}'], // tier: impact=low difficulty=easy
    ['grow-lang-data-json-dup-key', 'config/widgets.json', 'json-duplicate-keys', 'a widget list that repeats a key, so the last one wins', '{\n  "layout": "grid",\n  "columns": 3,', '  "columns": 4', '  "rows": 4', '}'], // tier: impact=low difficulty=easy
    ['grow-lang-data-json-trailing-comma', 'config/targets.json', 'json-valid', 'a targets file with a trailing comma', '{\n  "region": "emea",\n  "goal": 120000,', '  "stretch": 150000,', '  "stretch": 150000', '}'], // tier: impact=low difficulty=easy
  ]))

  return merge(parts)
}
