// The go pack: the Go toolchain's own checks. Turn it on with { "packs": ["go"] }.
import { tool } from '../../lib/tool-check.mjs'

const GO = ['**/*.go', 'go.mod', 'go.sum']

export default [
  tool({ id: 'go-vet', expect: 'Printf|%d', bin: 'go', args: ['vet', './...'], fixture: ['-C', 'fixtures/tools/go', 'vet', './...'], install: 'install Go from https://go.dev/dl', title: 'go vet: suspicious constructs', estSeconds: 60, paths: GO }),
  tool({ id: 'go-test', expect: 'broken on purpose', bin: 'go', args: ['test', './...'], fixture: ['-C', 'fixtures/tools/go-test', 'test', './...'], install: 'install Go from https://go.dev/dl', title: 'go test: the test suite', weight: 'heavy', estSeconds: 90, paths: GO }),
]
