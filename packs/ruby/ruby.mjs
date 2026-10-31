// The ruby pack: RuboCop and RSpec checks for Ruby projects. Turn it on with { "packs": ["ruby"] }.
// Not included: bundler-audit (it downloads its advisory database, so its self-test cannot run offline) and a per-file "ruby -c" check (ruby -c reads only one file).
import { tool } from '../../lib/tool-check.mjs'

const RUBY = ['**/*.rb', 'Gemfile', '.rubocop.yml']

export default [
  tool({ id: 'rubocop', expect: 'Layout/SpaceAroundOperators', bin: 'rubocop', args: [], fixture: ['fixtures/tools/ruby/broken.rb'], install: 'gem install rubocop', title: 'RuboCop: Ruby style and common bugs', weight: 'light', estSeconds: 15, paths: RUBY }),
  tool({ id: 'rspec', expect: 'expected: 2', bin: 'rspec', args: [], fixture: ['fixtures/tools/ruby/broken_spec.rb'], install: 'gem install rspec', title: 'RSpec: the test suite', weight: 'heavy', estSeconds: 60, paths: ['**/*.rb'] }),
]
