// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Meerkat's own tests. The fixtures hold deliberately broken test files, which must never be collected here.
export default { test: { include: ['*.test.ts', 'lib/**/*.test.ts'], exclude: ['fixtures/**', 'node_modules/**'], environment: 'node' } }
