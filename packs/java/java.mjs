// The java pack: Maven checks for Java projects (a pom.xml at the repository root). Turn it on with { "packs": ["java"] }.
// Not included: Gradle (no offline self-test that is certain to fail for the right reason) and checkstyle (it needs a rules file per project).
import { tool } from '../../lib/tool-check.mjs'

const JAVA = ['pom.xml', '**/*.java']
const POM_FIXTURE = 'fixtures/tools/maven/pom.xml'
const MAVEN = 'install Maven from https://maven.apache.org/download.cgi'

export default [
  tool({ id: 'maven-validate', expect: 'Non-parseable POM', bin: 'mvn', args: ['-q', '-B', 'validate'], fixture: ['-B', '-f', POM_FIXTURE, 'validate'], install: MAVEN, title: 'Maven: the project file (pom.xml) is valid', weight: 'tiny', estSeconds: 10, paths: ['pom.xml'] }),
  tool({ id: 'maven-compile', expect: 'Non-parseable POM', bin: 'mvn', args: ['-q', '-B', 'compile'], fixture: ['-B', '-f', POM_FIXTURE, 'compile'], install: MAVEN, title: 'Maven: the Java code compiles', weight: 'medium', estSeconds: 60, paths: JAVA }),
  tool({ id: 'maven-test', expect: 'Non-parseable POM', bin: 'mvn', args: ['-q', '-B', 'test'], fixture: ['-B', '-f', POM_FIXTURE, 'test'], install: MAVEN, title: 'Maven: the test suite', weight: 'medium', estSeconds: 90, paths: JAVA }),
]
