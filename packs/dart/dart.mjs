// The dart pack: the Dart SDK's analyzer and formatter (Flutter projects use the same SDK). Turn it on with { "packs": ["dart"] }.
// Not included: dart test (it needs packages downloaded first, so its self-test cannot run offline) and flutter analyze (optional, same analyzer).
import { tool } from '../../lib/tool-check.mjs'

const DART = ['**/*.dart', 'pubspec.yaml', 'analysis_options.yaml']
const SDK = 'install the Dart SDK from https://dart.dev/get-dart (Flutter includes it)'

export default [
  tool({ id: 'dart-analyze', expect: 'undefined_identifier', bin: 'dart', args: ['analyze', '--fatal-infos'], fixture: ['analyze', '--fatal-infos', 'fixtures/tools/dart'], install: SDK, title: 'Dart: analyzer (errors, warnings and lints)', weight: 'light', estSeconds: 20, paths: DART }),
  tool({ id: 'dart-format', expect: 'changed', bin: 'dart', args: ['format', '--output=none', '--set-exit-if-changed', '.'], fixture: ['format', '--output=none', '--set-exit-if-changed', 'fixtures/tools/dart/unformatted.dart'], install: SDK, title: 'Dart: code formatting (dart format)', weight: 'tiny', estSeconds: 5, paths: ['**/*.dart'] }),
]
