// Grown planted defects, part 3: Java (Spring) services and PHP sites for a shop, a booking site and an internal admin tool. One defect per file,
// five blank lines after it. Each project has a "-clean" twin with the safe line.
// Keys are prefixed `grow-web-`. Case: [key, file, check id, description, lines before, planted line, safe line, lines after (optional)]  // tier: ...

const mk = (name, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`grow-web-${name}`) }
  const good = { ...tidy(`grow-web-${name}-clean`) }
  for (const [k, file, exp, desc, pre, badText, goodText, post = ''] of cases) {
    expect[`grow-web-${k}`] = exp
    const tail = post ? [post] : []
    bad[file] = [pre, d(`grow-web-${k}`, desc, badText), ...tail, '', '', '', '', '']
    good[file] = [pre, goodText, ...tail, '']
  }
  return { projects: { [`grow-web-${name}`]: { files: bad }, [`grow-web-${name}-clean`]: { files: good } }, expect }
}

// A Spring-style class around one statement.
const J = (cls, imports = '') => `package dev.lakeside.web;\n${imports}\npublic class ${cls} {\n    public Object handle(HttpServletRequest request, String value) throws Exception {`
const JEND = '        return null;\n    }\n}'

export function projects(ctx) {
  const parts = []

  // ---- 1. Java: a Spring shop and its admin tool ----
  parts.push(mk('java-spring', ctx, [
    ['java-runtime-exec', 'src/main/java/dev/lakeside/web/ImageJob.java', 'cp-java/java-runtime-exec-variable', 'Runtime.exec with a command string from a variable', J('ImageJob'), '        Runtime.getRuntime().exec(value);', '        int cpus = Runtime.getRuntime().availableProcessors();', JEND], // tier: impact=critical difficulty=easy
    ['java-processbuilder', 'src/main/java/dev/lakeside/web/ReportJob.java', 'cp-java/java-processbuilder-variable', 'ProcessBuilder started with a command from a variable', J('ReportJob'), '        new ProcessBuilder(value).start();', '        new ProcessBuilder("report", "--daily").start();', JEND], // tier: impact=critical difficulty=medium
    ['java-object-stream', 'src/main/java/dev/lakeside/web/CartRestore.java', 'cp-java/java-object-stream-read|xxe-and-deserialize', 'a cart restored with ObjectInputStream from the request body', J('CartRestore'), '        return new ObjectInputStream(request.getInputStream()).readObject();', '        return new ObjectMapper().readValue(request.getInputStream(), Cart.class);', '    }\n}'], // tier: impact=critical difficulty=easy
    ['java-md5-digest', 'src/main/java/dev/lakeside/web/PasswordHash.java', 'cp-java/java-weak-digest', 'passwords digested with MD5', J('PasswordHash'), '        MessageDigest md = MessageDigest.getInstance("MD5");', '        MessageDigest md = MessageDigest.getInstance("SHA-256");', JEND], // tier: impact=high difficulty=easy
    ['java-cipher-aes-default', 'src/main/java/dev/lakeside/web/CardSeal.java', 'cp-java/java-cipher-default-ecb', 'Cipher.getInstance with just AES, which means ECB', J('CardSeal'), '        Cipher cipher = Cipher.getInstance("AES");', '        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");', JEND], // tier: impact=high difficulty=easy
    ['java-cipher-nopadding', 'src/main/java/dev/lakeside/web/BookingSeal.java', 'cp-java/java-cipher-no-padding', 'AES CBC with no padding for booking records', J('BookingSeal'), '        Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");', '        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");', JEND], // tier: impact=medium difficulty=easy
    ['java-trust-all-manager', 'src/main/java/dev/lakeside/web/TrustAll.java', 'cp-java/java-trust-all-certificates', 'a trust manager that accepts every server certificate', 'package dev.lakeside.web;\n\npublic class TrustAll implements X509TrustManager {', '    public void checkServerTrusted(X509Certificate[] c, String a) throws CertificateException {}', '    public void checkServerTrusted(X509Certificate[] c, String a) throws CertificateException { delegate.checkServerTrusted(c, a); }', '}'], // tier: impact=high difficulty=easy
    ['java-random-token', 'src/main/java/dev/lakeside/web/ResetToken.java', 'cp-java/java-random-secret|weak-crypto-modes', 'a reset token drawn from java.util.Random', J('ResetToken'), '        String token = new Random().nextLong() + "";', '        String token = new SecureRandom().nextLong() + "";', JEND], // tier: impact=high difficulty=easy
    ['java-secret-literal', 'src/main/java/dev/lakeside/web/DbConfig.java', 'cp-java/java-hardcoded-secret', 'a database password typed into a Java field', J('DbConfig'), '        String password = "Winter2024Pw";', '        String password = System.getenv("DB_PASSWORD");', JEND], // tier: impact=critical difficulty=easy
    ['java-statement-plus', 'src/main/java/dev/lakeside/web/OrderLookup.java', 'cp-java/java-statement-concat|sql-concat', 'an order lookup with the reference joined onto the SQL', J('OrderLookup'), '        stmt.executeQuery("SELECT * FROM orders WHERE ref = \'" + value + "\'");', '        ps.setString(1, value);', JEND], // tier: impact=critical difficulty=easy
    ['java-file-from-request', 'src/main/java/dev/lakeside/web/Download.java', 'cp-java/java-file-from-request', 'a File built from the f request parameter', J('Download'), '        File f = new File(request.getParameter("f"));', '        File f = new File(EXPORT_DIR, "latest.csv");', JEND], // tier: impact=critical difficulty=easy
    ['java-spel-variable', 'src/main/java/dev/lakeside/web/RuleEval.java', 'cp-java/java-spel-variable', 'a pricing rule evaluated as a SpEL expression from input', J('RuleEval'), '        return parser.parseExpression(value).getValue();', '        return rules.get(value).apply();', '    }\n}'], // tier: impact=critical difficulty=medium
    ['java-jndi-lookup', 'src/main/java/dev/lakeside/web/Resolver.java', 'cp-java/java-jndi-lookup-variable', 'a JNDI lookup of a name from the request', J('Resolver'), '        return ctx.lookup(value);', '        return ctx.lookup("java:comp/env/jdbc/shop");', '    }\n}'], // tier: impact=critical difficulty=medium
    ['java-secretkeyspec-literal', 'src/main/java/dev/lakeside/web/KeyLiteral.java', 'cp-java/java-secret-key-literal', 'an AES key built from a string literal', J('KeyLiteral'), '        SecretKeySpec key = new SecretKeySpec("0123456789abcdef".getBytes(), "AES");', '        SecretKeySpec key = new SecretKeySpec(keyBytes, "AES");', JEND], // tier: impact=critical difficulty=easy
    ['java-cookie-secure-false', 'src/main/java/dev/lakeside/web/SessionCookie.java', 'cp-java/java-cookie-not-secure', 'the session cookie marked not secure', J('SessionCookie'), '        cookie.setSecure(false);', '        cookie.setSecure(true);', JEND], // tier: impact=medium difficulty=easy
    ['java-crossorigin-star', 'src/main/java/dev/lakeside/web/ApiController.java', 'cp-java/java-cors-any-origin', 'a controller open to every origin', 'package dev.lakeside.web;\n', '@CrossOrigin(origins = "*")', '@CrossOrigin(origins = "https://admin.lakeside.dev")', '@RestController\npublic class ApiController {}'], // tier: impact=medium difficulty=easy
    ['java-regex-from-request', 'src/main/java/dev/lakeside/web/SearchFilter.java', 'cp-java/java-regex-from-request', 'a search pattern compiled straight from the q parameter', J('SearchFilter'), '        Pattern p = Pattern.compile(request.getParameter("q"));', '        Pattern p = Pattern.compile("^[a-z0-9 ]{1,40}$");', JEND], // tier: impact=medium difficulty=easy
    ['java-xpath-concat', 'src/main/java/dev/lakeside/web/StaffLookup.java', 'cp-java/java-xpath-concat', 'an XPath query with a name joined into it', J('StaffLookup'), '        XPathExpression e = xpath.compile("//staff[@name=\'" + value + "\']");', '        XPathExpression e = xpath.compile("//staff[@name=$name]");', JEND], // tier: impact=high difficulty=medium
    ['java-ldap-filter', 'src/main/java/dev/lakeside/web/DirectorySearch.java', 'cp-java/java-ldap-filter-concat', 'an LDAP filter built with the user name joined in', J('DirectorySearch'), '        String f = "(uid=" + value + ")";', '        String f = "(uid={0})";', JEND], // tier: impact=high difficulty=medium
  ]))

  // ---- 2. PHP: a shop and a booking site ----
  parts.push(mk('php-site', ctx, [
    ['php-eval-code', 'public/calc.php', 'cp-dotnet-php-ruby/php-eval-assert', 'eval of a formula posted by the admin form', '<?php\n$code = $_POST["formula"] ?? "";', 'eval($code);', '$result = calc_formula($code);'], // tier: impact=critical difficulty=easy
    ['php-preg-replace-e', 'public/slugify.php', 'cp-dotnet-php-ruby/php-preg-replace-e-modifier', 'preg_replace with the e modifier on a title', '<?php\n$title = $_GET["t"] ?? "";\n$r = "strtolower(\'$1\')";', '$slug = preg_replace("/(x)/e", $r, $title);', '$slug = preg_replace("/(x)/", "y", $title);'], // tier: impact=critical difficulty=easy
    ['php-unserialize-cookie', 'public/cart.php', 'cp-dotnet-php-ruby/php-unserialize-variable|xxe-and-deserialize', 'the cart restored with unserialize on a cookie', '<?php', '$cart = unserialize($_COOKIE["cart"]);', '$cart = json_decode($_COOKIE["cart"] ?? "[]", true);'], // tier: impact=critical difficulty=easy
    ['php-include-page', 'public/index.php', 'cp-dotnet-php-ruby/php-include-variable', 'include of the page named in a variable', '<?php\n$page = $_GET["p"] ?? "home";', 'include $page;', 'include "pages/home.php";'], // tier: impact=critical difficulty=easy
    ['php-system-variable', 'public/ping.php', 'cp-dotnet-php-ruby/php-shell-variable', 'system with a command from a variable', '<?php\n$cmd = "ping -c 1 " . ($_GET["h"] ?? "");', 'system($cmd);', 'echo "ping disabled";'], // tier: impact=critical difficulty=easy
    ['php-mt-rand-token', 'public/token.php', 'cp-dotnet-php-ruby/php-random-token|weak-crypto-modes', 'a session token from mt_rand', '<?php', '$token = mt_rand();', '$token = bin2hex(random_bytes(16));'], // tier: impact=high difficulty=easy
    ['php-sql-dot', 'public/post.php', 'cp-dotnet-php-ruby/php-sql-concat|sql-concat', 'a post query joined with the dot operator', '<?php\n$id = $_GET["id"] ?? 0;', '$r = mysqli_query($c, "SELECT * FROM posts WHERE id=" . $id);', '$r = $c->prepare("SELECT * FROM posts WHERE id = ?");'], // tier: impact=critical difficulty=easy
    ['php-readfile-get', 'public/download.php', 'cp-dotnet-php-ruby/php-file-from-request', 'readfile on a file name from GET', '<?php', 'readfile($_GET["f"]);', 'readfile(__DIR__ . "/latest.pdf");'], // tier: impact=critical difficulty=easy
    ['php-entity-loader-on', 'public/xml_import.php', 'cp-dotnet-php-ruby/php-libxml-loader-off-false', 'the libxml entity loader switched back on', '<?php', 'libxml_disable_entity_loader(false);', 'libxml_disable_entity_loader(true);'], // tier: impact=high difficulty=medium
    ['php-curl-verify-off', 'public/gateway.php', 'cp-dotnet-php-ruby/php-curl-verify-off', 'cURL peer verification switched off for the gateway', '<?php\n$c = curl_init(getenv("GATEWAY_URL"));', 'curl_setopt($c, CURLOPT_SSL_VERIFYPEER, false);', 'curl_setopt($c, CURLOPT_SSL_VERIFYPEER, true);'], // tier: impact=high difficulty=easy
    ['php-setcookie-bare', 'public/login_cookie.php', 'cookie-flags', 'setcookie with only a name and a value', '<?php\n$sid = bin2hex(random_bytes(16));', 'setcookie("sid", $sid);', 'setcookie("sid", $sid, ["httponly" => true, "secure" => true, "samesite" => "Lax"]);'], // tier: impact=medium difficulty=easy
    ['php-header-location-get', 'public/go.php', 'open-redirect-pattern', 'a Location header built from the url parameter', '<?php', 'header("Location: " . $_GET["url"]);', 'header("Location: /home");'], // tier: impact=medium difficulty=easy
  ]))

  return {
    projects: Object.assign({}, ...parts.map((p) => p.projects)),
    expect: Object.assign({}, ...parts.map((p) => p.expect)),
  }
}
