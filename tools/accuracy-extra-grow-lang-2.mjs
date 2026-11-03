// Grown planted defects, part 2: PHP (a booking site), Ruby (a Rails admin), and three Python projects (a data pipeline, a web shop, an ML job).
// Same layout as part 1: one distinct line per case in its own file, five blank lines after it, a "-clean" twin with the safe line.
// Case: [key, file, expected check(s), description, text before, bad line, good line, text after]. Tier comments on each key's line feed
// tools/accuracy-tier-fragments/grow-lang.txt.

const fix = (s) => (s ?? '').replaceAll('§', '`').replaceAll('@{', '${')

const mk = (name, ctx, cases) => {
  const { d, tidy } = ctx
  const expect = {}
  const bad = { ...tidy(`grow-lang-${name}`) }
  const good = { ...tidy(`grow-lang-${name}-clean`) }
  for (const [k, file, exp, desc, pre, badText, goodText, post = ''] of cases) {
    if (exp) expect[k] = exp
    const tail = post ? [fix(post)] : []
    bad[file] = [fix(pre), d(k, desc, fix(badText)), ...tail, '', '', '', '', '']
    good[file] = [fix(pre), fix(goodText), ...tail, '']
  }
  return { projects: { [`grow-lang-${name}`]: { files: bad }, [`grow-lang-${name}-clean`]: { files: good } }, expect }
}

const merge = (parts) => ({ projects: Object.assign({}, ...parts.map((p) => p.projects)), expect: Object.assign({}, ...parts.map((p) => p.expect)) })

export function projects(ctx) {
  const parts = []

  // ---- PHP: a booking site -------------------------------------------------------------------------------------------------------
  const P = '<?php\n'
  parts.push(mk('php-booking', ctx, [
    ['grow-lang-php-assert-expression', 'src/price.php', 'cp-dotnet-php-ruby', 'a price rule run through assert() on posted text', P, 'assert($_POST[\'rule\']);', '$result = (new ExpressionLanguage())->evaluate($rule, $vars);'], // tier: impact=critical difficulty=easy
    ['grow-lang-php-preg-replace-e', 'src/template.php', 'cp-dotnet-php-ruby', 'a confirmation template filled with the /e modifier', P, '$out = preg_replace("/\\{(\\w+)\\}/e", \'$vars["$1"]\', $tpl);', '$out = preg_replace_callback("/\\{(\\w+)\\}/", fn($m) => $vars[$m[1]], $tpl);'], // tier: impact=critical difficulty=easy
    ['grow-lang-php-display-errors-on', 'src/boot.php', 'cp-dotnet-php-ruby', 'error details shown to visitors', P, "ini_set('display_errors', '1');", "ini_set('display_errors', '0');"], // tier: impact=medium difficulty=easy
    ['grow-lang-php-mysql-legacy-query', 'src/legacy.php', 'cp-dotnet-php-ruby', 'the removed mysql_query function in a booking lookup', P, '$res = mysql_query($sql);', '$stmt = $pdo->prepare($sql);'], // tier: impact=high difficulty=easy
    ['grow-lang-php-libxml-entity-loader', 'src/feed.php', 'cp-dotnet-php-ruby', 'the XML entity loader switched back on for a partner feed', P, 'libxml_disable_entity_loader(false);', 'libxml_disable_entity_loader(true);'], // tier: impact=high difficulty=easy
    ['grow-lang-php-curl-verifyhost-off', 'src/gateway.php', 'cp-dotnet-php-ruby', 'host name checking turned off for the payment gateway call', P + '$ch = curl_init($url);', 'curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);', 'curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);'], // tier: impact=high difficulty=easy
    ['grow-lang-php-uniqid-secret', 'src/invite.php', 'cp-dotnet-php-ruby|weak-crypto-modes', 'an invite code made from uniqid()', P, "$secretCode = uniqid('', true);", '$secretCode = bin2hex(random_bytes(16));'], // tier: impact=high difficulty=medium
    ['grow-lang-php-include-theme', 'src/page.php', 'cp-dotnet-php-ruby', 'a theme folder taken from a variable and included', P, "include $theme . '/header.php';", "include __DIR__ . '/header.php';"], // tier: impact=critical difficulty=medium
    ['grow-lang-php-sql-concat-client', 'src/invoices.php', 'cp-dotnet-php-ruby|sql-concat', 'an invoice lookup that joins the client name into the SQL', P, '$r = mysqli_query($c, "SELECT * FROM invoices WHERE client = \'" . $client . "\'");', '$stmt = $c->prepare("SELECT * FROM invoices WHERE client = ?");'], // tier: impact=critical difficulty=easy
    ['grow-lang-php-exec-zip-dir', 'src/backup.php', 'cp-dotnet-php-ruby', 'a backup that shells out to zip with the folder in the string', P, 'exec("zip -r backup.zip $dir");', '$zip = new ZipArchive();\n$zip->open(\'backup.zip\', ZipArchive::CREATE);'], // tier: impact=critical difficulty=easy
    ['grow-lang-php-unserialize-cart', 'src/cart.php', 'cp-dotnet-php-ruby|xxe-and-deserialize', 'a cart restored with unserialize on posted data', P, "$cart = unserialize(base64_decode($_POST['cart']));", "$cart = json_decode(base64_decode($_POST['cart']), true);"], // tier: impact=critical difficulty=easy
    ['grow-lang-php-readfile-invoice', 'src/download.php', 'cp-dotnet-php-ruby|path-traversal-pattern', 'a download script that reads the file named in the query', P, "echo file_get_contents($_GET['invoice']);", "echo file_get_contents($invoiceDir . '/' . basename($_GET['invoice']));"], // tier: impact=critical difficulty=medium
    ['grow-lang-php-extract-post', 'src/signup.php', 'cp-dotnet-php-ruby', 'extract() on posted form data', P, 'extract($_POST);', '$email = $_POST[\'email\'] ?? \'\';'], // tier: impact=high difficulty=easy
  ]))

  // ---- Ruby: a Rails admin -------------------------------------------------------------------------------------------------------
  parts.push(mk('ruby-admin', ctx, [
    ['grow-lang-rb-instance-eval-formula', 'app/models/formula.rb', 'cp-dotnet-php-ruby', 'a report formula run with instance_eval on a parameter', 'class Formula\n  def run(params)', '    instance_eval(params[:formula])', '    Calculator.parse(params[:formula])', '  end\nend'], // tier: impact=critical difficulty=easy
    ['grow-lang-rb-permit-bang', 'app/controllers/users_controller.rb', 'cp-dotnet-php-ruby', 'strong parameters bypassed with permit!', 'class UsersController < ApplicationController\n  def update', '    @user.update(params.permit!)', '    @user.update(params.require(:user).permit(:name, :email))', '  end\nend'], // tier: impact=high difficulty=easy
    ['grow-lang-rb-skip-csrf', 'app/controllers/orders_controller.rb', 'cp-dotnet-php-ruby', 'the CSRF check skipped on the orders controller', 'class OrdersController < ApplicationController', '  skip_before_action :verify_authenticity_token', '  protect_from_forgery with: :exception', 'end'], // tier: impact=high difficulty=easy
    ['grow-lang-rb-render-params-template', 'app/controllers/pages_controller.rb', 'cp-dotnet-php-ruby', 'a page controller that renders a template named in the request', 'class PagesController < ApplicationController\n  def show', '    render params[:template]', '    render :show', '  end\nend'], // tier: impact=critical difficulty=easy
    ['grow-lang-rb-yaml-unsafe-load', 'lib/importer.rb', 'cp-dotnet-php-ruby|xxe-and-deserialize', 'a config import that uses YAML.unsafe_load', 'class Importer\n  def read(path)', '    YAML.unsafe_load(File.read(path))', '    YAML.safe_load(File.read(path))', '  end\nend'], // tier: impact=critical difficulty=easy
    ['grow-lang-rb-system-pdftk', 'lib/pdf_merge.rb', 'cp-dotnet-php-ruby', 'a PDF merge that interpolates file names into a system call', 'class PdfMerge\n  def call(input, out)', '    system("pdftk #{input} output #{out}")', "    system('pdftk', input, 'output', out)", '  end\nend'], // tier: impact=critical difficulty=easy
    ['grow-lang-rb-kernel-open-url', 'lib/feed_fetch.rb', 'cp-dotnet-php-ruby', 'a feed fetched with Kernel.open', 'class FeedFetch\n  def get(url)', '    Kernel.open(url).read', '    Net::HTTP.get(URI(url))', '  end\nend'], // tier: impact=high difficulty=easy
    ['grow-lang-rb-openssl-md5', 'lib/etag.rb', 'cp-dotnet-php-ruby|weak-crypto-modes', 'an etag built with OpenSSL MD5', 'class Etag\n  def for(body)', '    OpenSSL::Digest::MD5.new.hexdigest(body)', '    OpenSSL::Digest::SHA256.new.hexdigest(body)', '  end\nend'], // tier: impact=low difficulty=easy
    ['grow-lang-rb-send-field', 'app/models/record_editor.rb', 'cp-dotnet-php-ruby', 'a record updated through send with a field name from the request', 'class RecordEditor\n  def set(record, params, value)', '    record.send(params[:field], value)', '    record.public_send(ALLOWED_FIELDS.fetch(params[:field]), value)', '  end\nend'], // tier: impact=high difficulty=medium
    ['grow-lang-rb-html-safe-comment', 'app/helpers/comments_helper.rb', 'cp-dotnet-php-ruby', 'a comment body marked html_safe', 'module CommentsHelper\n  def body_html(comment)', '    comment.body.html_safe', '    sanitize(comment.body)', '  end\nend'], // tier: impact=high difficulty=easy
    ['grow-lang-rb-marshal-cache', 'lib/cache_store.rb', 'cp-dotnet-php-ruby', 'a cache file read back with Marshal.load', 'class CacheStore\n  def read(cache_path)', '    Marshal.load(File.binread(cache_path))', '    JSON.parse(File.read(cache_path))', '  end\nend'], // tier: impact=high difficulty=easy
  ]))

  // ---- Python: a data pipeline ---------------------------------------------------------------------------------------------------
  parts.push(mk('py-pipeline', ctx, [
    ['grow-lang-py-marshal-loads-blob', 'etl/decode.py', 'cp-python', 'a queue message decoded with marshal', 'import marshal\nimport json\n\n\ndef decode(blob):', '    rows = marshal.loads(blob)', '    rows = json.loads(blob)', '    return rows'], // tier: impact=high difficulty=easy
    ['grow-lang-py-shelve-open-cache', 'etl/cache.py', 'cp-python', 'a lookup cache kept in a shelve file', 'import shelve\nimport dbm\n\n\ndef open_cache(cache_path):', '    cache = shelve.open(cache_path)', "    cache = dbm.open(cache_path, 'c')", '    return cache'], // tier: impact=medium difficulty=easy
    ['grow-lang-py-compile-exec-rule', 'etl/rules.py', 'cp-python', 'a transform rule compiled in exec mode', 'def build(source):', "    code = compile(source, '<rule>', 'exec')", "    code = compile(source, '<rule>', 'eval')", '    return code'], // tier: impact=critical difficulty=easy
    ['grow-lang-py-password-default', 'etl/warehouse.py', 'cp-python|secrets-plus', 'a warehouse connect function with a password default', '', '\ndef connect(host, password="Sup3rSecret!"):', '\ndef connect(host, password=None):', '    return (host, password)'], // tier: impact=critical difficulty=easy
    ['grow-lang-py-ftp-plain', 'etl/fetch_ftp.py', 'cp-python', 'a nightly file pull over plain FTP', 'import ftplib\n\n\ndef pull(host):', '    ftp = ftplib.FTP(host)', '    ftp = ftplib.FTP_TLS(host)', '    return ftp'], // tier: impact=high difficulty=easy
    ['grow-lang-py-http-stock-api', 'etl/stock.py', 'cp-python', 'the stock API read over http', 'import requests\n\n\ndef levels():', '    return requests.get("http://inventory.acme-corp.io/api/stock", timeout=10).json()', '    return requests.get("https://inventory.acme-corp.io/api/stock", timeout=10).json()'], // tier: impact=medium difficulty=easy
    ['grow-lang-py-minidom-parse-feed', 'etl/xmlfeed.py', 'cp-python', 'a supplier feed parsed with minidom', 'from xml.dom import minidom\nimport defusedxml.minidom\n\n\ndef parse(payload):', '    return minidom.parseString(payload)', '    return defusedxml.minidom.parseString(payload)'], // tier: impact=high difficulty=medium
    ['grow-lang-py-tar-extractall-upload', 'etl/unpack.py', 'cp-python', 'an uploaded archive unpacked with no filter', 'import tarfile\n\n\ndef unpack(path, dest):\n    with tarfile.open(path) as archive:', '        archive.extractall(dest)', '        archive.extractall(dest, filter="data")'], // tier: impact=high difficulty=easy
    ['grow-lang-py-hardcoded-db-ip', 'etl/settings.py', 'hardcoded-ip', 'the warehouse host written as a public IP', 'import os\n', 'DB_HOST = "52.14.201.77"', 'DB_HOST = os.environ["DB_HOST"]'], // tier: impact=low difficulty=easy
    ['grow-lang-py-url-with-password', 'etl/engine.py', 'credentials-in-urls|cp-python', 'the database URL carries its password', 'from sqlalchemy import create_engine\nimport os\n', 'engine = create_engine("postgresql://app:Tr0ub4dor3x@db.internal.example.com/shop")', 'engine = create_engine(os.environ["DATABASE_URL"])'], // tier: impact=critical difficulty=easy
    ['grow-lang-py-regex-nested-name', 'etl/validate.py', 'regex-dos', 'a name check with a nested quantifier', 'import re\n', 'NAME = re.compile(r"^(\\w+\\s?)+$")', 'NAME = re.compile(r"^[\\w\\s]{1,64}$")'], // tier: impact=medium difficulty=medium
    ['grow-lang-py-chmod-666-output', 'etl/export.py', 'cp-python', 'the export file made writable for everyone', 'import os\n\n\ndef export(path):', '    os.chmod(path, 0o666)', '    os.chmod(path, 0o600)'], // tier: impact=medium difficulty=easy
  ]))

  // ---- Python: a web shop --------------------------------------------------------------------------------------------------------
  parts.push(mk('py-webshop', ctx, [
    ['grow-lang-py-jinja-autoescape-off', 'shop/templating.py', 'cp-python', 'order e-mails rendered with autoescape off', 'from jinja2 import Environment\n', 'env = Environment(autoescape=False)', 'env = Environment(autoescape=True)'], // tier: impact=high difficulty=easy
    ['grow-lang-py-mark-safe-name', 'shop/filters.py', 'cp-python', 'a customer name wrapped in mark_safe', 'from django.utils.safestring import mark_safe\nfrom django.utils.html import format_html\n\n\ndef label(name):', '    return mark_safe(f"<b>{name}</b>")', '    return format_html("<b>{}</b>", name)'], // tier: impact=high difficulty=easy
    ['grow-lang-py-allowed-hosts-star', 'shop/hosts.py', 'cp-python', 'every host name accepted', '', 'ALLOWED_HOSTS = ["*"]', 'ALLOWED_HOSTS = ["shop.example.com"]'], // tier: impact=medium difficulty=easy
    ['grow-lang-py-csrf-exempt-checkout', 'shop/checkout.py', 'cp-python', 'the checkout view exempt from CSRF', 'from django.views.decorators.csrf import csrf_exempt\n', '@csrf_exempt', '# CSRF stays on for checkout', 'def checkout(request):\n    return None'], // tier: impact=high difficulty=easy
    ['grow-lang-py-settings-debug-true', 'shop/settings.py', 'debug-enabled', 'DEBUG left on in the settings file', '', 'DEBUG = True', 'DEBUG = False'], // tier: impact=high difficulty=easy
    ['grow-lang-py-orm-raw-fstring', 'shop/reports.py', 'cp-python|sql-concat', 'an orders report built with an f-string in .raw()', 'from shop.models import Order\n\n\ndef big_orders(minimum):', '    return Order.objects.raw(f"SELECT * FROM orders WHERE total > {minimum}")', '    return Order.objects.raw("SELECT * FROM orders WHERE total > %s", [minimum])'], // tier: impact=critical difficulty=easy
    ['grow-lang-py-send-file-request', 'shop/exports.py', 'path-traversal-pattern', 'an export route that sends the file named in the query', 'from flask import request, send_file, send_from_directory\nfrom werkzeug.utils import secure_filename\n\n\ndef export():', '    return send_file(request.args["file"])', '    return send_from_directory(EXPORT_DIR, secure_filename(request.args["file"]))'], // tier: impact=critical difficulty=medium
    ['grow-lang-py-log-card-number', 'shop/payments.py', 'pii-in-logs', 'the card number written to the checkout log', 'import logging\nlogger = logging.getLogger(__name__)\n\n\ndef charge(order_id, user_email, credit_card_number):', '    logger.info("charge for %s card %s", user_email, credit_card_number)', '    logger.info("charge for order %s", order_id)'], // tier: impact=critical difficulty=easy
    ['grow-lang-py-bind-all-worker', 'shop/worker.py', 'cp-python', 'the worker socket bound on every interface', 'import socket\n\n\ndef listen():\n    server = socket.socket()', "    server.bind(('0.0.0.0', 9000))", "    server.bind(('127.0.0.1', 9000))"], // tier: impact=medium difficulty=easy
    ['grow-lang-py-aes-ecb-card', 'shop/vault.py', 'weak-crypto-modes', 'stored card data encrypted in ECB mode', 'from Crypto.Cipher import AES\n\n\ndef seal(key):', '    return AES.new(key, AES.MODE_ECB)', '    return AES.new(key, AES.MODE_GCM)'], // tier: impact=high difficulty=easy
    ['grow-lang-py-static-iv', 'shop/crypto.py', 'cp-python|weak-crypto-modes', 'the vault IV written as a literal', 'import os\n', 'iv = b"1234567890abcdef"', 'iv = os.urandom(16)'], // tier: impact=high difficulty=easy
  ]))

  // ---- Python: an ML job ---------------------------------------------------------------------------------------------------------
  parts.push(mk('py-mljob', ctx, [
    ['grow-lang-py-torch-load-path', 'train/resume.py', 'cp-python|pickle-load', 'a checkpoint loaded with torch.load and no weights_only', 'import torch\n\n\ndef resume(path):', '    model = torch.load(path)', '    model = torch.load(path, weights_only=True)', '    return model'], // tier: impact=high difficulty=easy
    ['grow-lang-py-trust-remote-code', 'train/hub.py', 'cp-python', 'a hub model loaded with trust_remote_code', 'from transformers import AutoModel\n\n\ndef load(name):', '    return AutoModel.from_pretrained(name, trust_remote_code=True)', '    return AutoModel.from_pretrained(name)'], // tier: impact=critical difficulty=easy
    ['grow-lang-py-pickle-load-args', 'train/score.py', 'pickle-load|cp-python', 'a scoring script that unpickles the file named on the command line', 'import pickle\n\n\ndef load(args):', '    return pickle.load(open(args.model, "rb"))', '    return load_model_file(args.model)'], // tier: impact=critical difficulty=medium
    ['grow-lang-py-ssl-tlsv1-client', 'train/upload.py', 'cp-python', 'the results upload asks for TLS 1.0', 'import ssl\n\n\ndef context():', '    return ssl.SSLContext(ssl.PROTOCOL_TLSv1)', '    return ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)'], // tier: impact=high difficulty=easy
    ['grow-lang-py-paramiko-autoadd', 'train/remote.py', 'cp-python', 'the GPU box connection trusts any host key', 'import paramiko\n\n\ndef connect():\n    client = paramiko.SSHClient()', '    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())', '    client.set_missing_host_key_policy(paramiko.RejectPolicy())', '    return client'], // tier: impact=high difficulty=easy
    ['grow-lang-py-snmp-public', 'train/monitor.py', 'cp-python', 'the rack monitor reads SNMP with the community public', 'from pysnmp.hlapi import CommunityData, UsmUserData\n\n\ndef auth(user, key):', "    return CommunityData('public')", '    return UsmUserData(user, key)'], // tier: impact=medium difficulty=easy
    ['grow-lang-py-unpinned-requirements', 'requirements.txt', 'requirements-pinned-ml', 'numpy left on a loose range in the ML requirements', 'pandas==2.2.2', 'numpy>=1.20', 'numpy==1.26.4'], // tier: impact=low difficulty=easy
  ]))

  return merge(parts)
}
