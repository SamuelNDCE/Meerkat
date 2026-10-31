// The dotnet pack: the .NET SDK's own format and build checks. Turn it on with { "packs": ["dotnet"] }.
// Both run from the repository root, so the .sln or .csproj must sit there. Not included: dotnet test (it needs test packages downloaded, so its self-test cannot run offline).
import { tool } from '../../lib/tool-check.mjs'

const DOTNET = ['**/*.cs', '**/*.csproj', '**/*.sln', '.editorconfig']
const PROJECT_FIXTURE = 'fixtures/tools/dotnet/Broken.csproj'
const SDK = 'install the .NET SDK from https://dotnet.microsoft.com/download'

export default [
  tool({ id: 'dotnet-format', expect: 'Program\\.cs|CS0029', bin: 'dotnet', args: ['format', '--verify-no-changes'], fixture: ['format', '--verify-no-changes', PROJECT_FIXTURE], install: SDK, title: '.NET: code formatting (dotnet format)', weight: 'light', estSeconds: 20, paths: DOTNET }),
  tool({ id: 'dotnet-build', expect: 'CS0029', bin: 'dotnet', args: ['build', '--nologo', '-warnaserror'], fixture: ['build', '--nologo', PROJECT_FIXTURE], install: SDK, title: '.NET: the build, with warnings treated as errors', weight: 'medium', estSeconds: 30, paths: DOTNET }),
]
