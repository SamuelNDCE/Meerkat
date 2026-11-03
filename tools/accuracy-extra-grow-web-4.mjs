// Grown planted defects, part 4: Ruby on Rails controllers and models for a shop and a booking site. One defect per file, five blank lines after it.
// The project has a "-clean" twin with the safe line. Keys are prefixed `grow-web-`.
// Case: [key, file, check id, description, lines before, planted line, safe line, lines after (optional)]  // tier: ...

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

const CTRL = (name) => `class ${name}Controller < ApplicationController\n  def show`
const CEND = '  end\nend'

export function projects(ctx) {
  const parts = []

  parts.push(mk('rb-rails', ctx, [
    ['rb-eval-params', 'app/controllers/formulas_controller.rb', 'cp-dotnet-php-ruby/rb-eval-params', 'eval of the code parameter on a pricing page', CTRL('Formulas'), '    result = eval(params[:code])', '    result = Formula.find(params[:id]).value', CEND], // tier: impact=critical difficulty=easy
    ['rb-send-params', 'app/controllers/reports_controller.rb', 'cp-dotnet-php-ruby/rb-send-params', 'a method called by name from a request parameter', CTRL('Reports'), '    data = Order.send(params[:scope])', '    data = Order.public_send(:recent)', CEND], // tier: impact=critical difficulty=easy
    ['rb-marshal-load-cookie', 'app/controllers/carts_controller.rb', 'cp-dotnet-php-ruby/rb-marshal-load|xxe-and-deserialize', 'the cart restored with Marshal.load on a cookie', CTRL('Carts'), '    cart = Marshal.load(Base64.decode64(cookies[:cart]))', '    cart = JSON.parse(Base64.decode64(cookies[:cart]))', CEND], // tier: impact=critical difficulty=easy
    ['rb-md5-digest', 'app/models/api_key.rb', 'cp-dotnet-php-ruby/rb-weak-digest', 'API keys digested with MD5', 'class ApiKey < ApplicationRecord\n  def self.digest(text)', '    Digest::MD5.hexdigest(text)', '    Digest::SHA256.hexdigest(text)', CEND], // tier: impact=medium difficulty=easy
    ['rb-yaml-unsafe-load', 'app/services/import_settings.rb', 'cp-dotnet-php-ruby/rb-yaml-unsafe', 'an uploaded settings file read with YAML.unsafe_load', 'class ImportSettings\n  def call(file)', '    YAML.unsafe_load(file.read)', '    YAML.safe_load(file.read)', CEND], // tier: impact=critical difficulty=easy
    ['rb-system-interpolation', 'app/jobs/thumbnail_job.rb', 'cp-dotnet-php-ruby/rb-system-interpolation', 'a convert command with the file name interpolated', 'class ThumbnailJob\n  def perform(dir)', '    system("convert #{dir}/a.png #{dir}/thumb.png")', '    system("convert", "#{dir}/a.png", "#{dir}/thumb.png")', CEND], // tier: impact=critical difficulty=easy
    ['rb-permit-all', 'app/controllers/accounts_controller.rb', 'cp-dotnet-php-ruby/rb-permit-all', 'every parameter permitted for an account update', CTRL('Accounts'), '    @account.update(params.permit!)', '    @account.update(params.require(:account).permit(:name, :email))', CEND], // tier: impact=high difficulty=easy
    ['rb-html-safe-comment', 'app/helpers/comments_helper.rb', 'cp-dotnet-php-ruby/rb-html-safe', 'a blog comment marked html_safe', 'module CommentsHelper\n  def comment_body(comment)', '    comment.body.html_safe', '    h(comment.body)', CEND], // tier: impact=high difficulty=easy
    ['rb-csrf-skipped', 'app/controllers/webhooks_controller.rb', 'cp-dotnet-php-ruby/rb-csrf-skipped', 'CSRF token verification skipped on the booking form controller', 'class WebhooksController < ApplicationController', '  skip_before_action :verify_authenticity_token', '  before_action :verify_signature', '  def create\n    head :ok\n  end\nend'], // tier: impact=high difficulty=easy
    ['rb-open-params', 'app/controllers/downloads_controller.rb', 'cp-dotnet-php-ruby/rb-open-params', 'Kernel open on a path from the request', CTRL('Downloads'), '    body = open(params[:f]).read', '    body = File.read(Rails.root.join("exports", "latest.csv"))', CEND], // tier: impact=critical difficulty=easy
    ['rb-render-params', 'app/controllers/pages_controller.rb', 'cp-dotnet-php-ruby/rb-render-params', 'render of a template named in the request', CTRL('Pages'), '    render params[:page]', '    render "home"', CEND], // tier: impact=high difficulty=easy
    ['rb-where-interpolated', 'app/controllers/orders_controller.rb', 'sql-concat', 'a where clause with the status parameter interpolated', CTRL('Orders'), '    @orders = Order.where("status = \'#{params[:status]}\'")', '    @orders = Order.where(status: params[:status])', CEND], // tier: impact=critical difficulty=easy
  ]))

  return {
    projects: Object.assign({}, ...parts.map((p) => p.projects)),
    expect: Object.assign({}, ...parts.map((p) => p.expect)),
  }
}
