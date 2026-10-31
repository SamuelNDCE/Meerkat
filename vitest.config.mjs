// Meerkat's own tests. The fixtures hold deliberately broken test files, which must never be collected here.
export default { test: { include: ['tests/*.test.ts', 'lib/**/*.test.ts'], exclude: ['fixtures/**', 'node_modules/**'], environment: 'node' } }
