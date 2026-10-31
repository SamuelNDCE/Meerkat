// The swift pack: SwiftLint and the Swift package build. Turn it on with { "packs": ["swift"] }.
// The build runs from the repository root, so Package.swift must sit there. It creates a .build folder, which should be git-ignored.
// Not included: swift test (it needs a test target and XCTest, so its self-test is not offline-safe on every machine).
import { tool } from '../../lib/tool-check.mjs'

const SWIFT_FIXTURE = 'fixtures/tools/swift'

export default [
  tool({ id: 'swiftlint', expect: 'Force Cast', bin: 'swiftlint', args: ['lint', '--strict'], fixture: ['lint', '--strict', '--path', `${SWIFT_FIXTURE}/Sources/Broken/main.swift`], install: 'install SwiftLint: brew install swiftlint (macOS), or see https://github.com/realm/SwiftLint', title: 'SwiftLint: Swift style and safety', weight: 'tiny', estSeconds: 10, paths: ['**/*.swift', '.swiftlint.yml'] }),
  tool({ id: 'swift-build', expect: 'cannot convert', bin: 'swift', args: ['build'], fixture: ['build', '--package-path', SWIFT_FIXTURE], install: 'install the Swift toolchain from https://www.swift.org/download', title: 'Swift: the package builds', weight: 'heavy', estSeconds: 120, paths: ['Package.swift', '**/*.swift'] }),
]
