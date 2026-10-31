// The data-science pack: Jupyter notebooks, ML projects and data files, checked with no tool installed. Turn it on with { "packs": ["data-science"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const DS = `${MK}/thorough/data-science.mjs`
const make = (id, group, title) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  suite: 'data-files',
  title,
  estSeconds: 2,
  needs: ['node'],
  run: { cmd: 'node', args: [DS, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [DS, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('notebook-valid-json', 'functionality', 'Notebooks are valid JSON with the fields Jupyter needs'),
  make('notebook-outputs-stripped', 'functionality', 'Committed notebooks have no outputs, run counts or big embedded images'),
  make('notebook-secrets', 'security', 'No keys, tokens or passwords in notebook cells or outputs'),
  make('notebook-size', 'functionality', 'No notebook is over the size budget'),
  make('notebook-absolute-paths', 'functionality', 'Notebooks use no absolute paths from one machine'),
  make('notebook-pip-magics', 'functionality', 'Notebook pip installs name exact versions'),
  make('model-files-in-git', 'functionality', 'Large model files are stored with git-lfs, not plain git'),
  make('data-files-in-git', 'functionality', 'Large data files are stored with git-lfs, not plain git'),
  make('pickle-load', 'functionality', 'Pickle loads read a fixed path or use weights_only'),
  make('random-seed-missing', 'functionality', 'Scripts that train with random numbers set a seed'),
  make('requirements-pinned-ml', 'functionality', 'ML packages in requirements or pyproject have exact versions'),
  make('dataset-license-note', 'functionality', 'Every data folder says where its data came from'),
]
