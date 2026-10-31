// The php pack: Composer and PHPStan checks for PHP projects. Turn it on with { "packs": ["php"] }.
// PHPStan reads the folders to check from phpstan.neon (or phpstan.neon.dist) in the project, so add one before relying on it.
// Not included: a per-file "php -l" check, because php -l reads only the first file it is given and the file runner passes many at once.
import { tool } from '../../lib/tool-check.mjs'

export default [
  tool({ id: 'composer-validate', expect: 'valid JSON', bin: 'composer', args: ['validate', '--strict'], fixture: ['validate', '--strict', 'fixtures/tools/php/composer.json'], install: 'install Composer from https://getcomposer.org/download', title: 'Composer: composer.json is valid (strict)', weight: 'tiny', estSeconds: 5, paths: ['composer.json', 'composer.lock'] }),
  tool({ id: 'phpstan', expect: 'not found', bin: 'phpstan', args: ['analyse', '--no-progress'], fixture: ['analyse', '--no-progress', 'fixtures/tools/php/undefined.php'], install: 'install PHPStan: composer global require phpstan/phpstan (or download it from https://phpstan.org)', title: 'PHPStan: bugs and undefined code (also reports PHP syntax errors)', weight: 'medium', estSeconds: 30, paths: ['**/*.php', 'phpstan.neon', 'phpstan.neon.dist'] }),
]
