// Meerkat's own tests. The fixtures hold deliberately broken test files, which must never be collected here.
// Locally the tests use few workers and run at low priority (vitest.setup.mjs): the suite is heavy on processes and files, and antivirus scans each of them.
export default {
  test: {
    include: ['tests/*.test.ts', 'lib/**/*.test.ts'],
    exclude: ['fixtures/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    setupFiles: ['./vitest.setup.mjs'],
    ...(process.env.CI ? {} : { maxWorkers: 3 }),
  },
}
