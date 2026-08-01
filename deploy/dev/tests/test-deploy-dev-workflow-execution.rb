#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'open3'
require 'tmpdir'
require 'yaml'

def safe_yaml_load(text)
  YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: true)
rescue ArgumentError
  YAML.safe_load(text, [], [], true)
end

def assert(condition, message)
  abort "FAIL #{message}" unless condition
end

root = File.expand_path('../../..', __dir__)
workflow = safe_yaml_load(File.read(File.join(root, '.github', 'workflows', 'deploy-dev.yml')))
jobs = workflow.fetch('jobs')

def run_step(script, environment)
  Open3.capture3(environment, 'bash', '-ceu', script)
end

app_inventory = jobs.fetch('deploy').fetch('steps').find { |step| step['name'] == 'Create ephemeral Ansible inventory and deployment overrides' }.fetch('run')
observability_inventory = jobs.fetch('deploy-observability').fetch('steps').find { |step| step['name'] == 'Create ephemeral Ansible inventory' }.fetch('run')
ssh_trust = jobs.fetch('deploy-observability').fetch('steps').find { |step| step['name'] == 'Configure SSH trust' }.fetch('run')
bootstrap = jobs.fetch('deploy-observability').fetch('steps').find { |step| step['name'] == 'Bootstrap observability AWS credential Secret' }.fetch('run')
diagnose = jobs.fetch('deploy').fetch('steps').find { |step| step['name'] == 'Diagnose failed database migration gate' }.fetch('run')

Dir.mktmpdir('deploy-dev-workflow-execution') do |directory|
  runner_temp = File.join(directory, 'runner-temp')
  home = File.join(directory, 'home')
  Dir.mkdir(runner_temp)
  Dir.mkdir(home)
  digest = "sha256:#{'a' * 64}"
  environment = {
    'RUNNER_TEMP' => runner_temp,
    'HOME' => home,
    'VPS_HOST' => 'dev.example.test',
    'VPS_USER' => 'deploy_user',
    'SELECT_WEB' => 'true',
    'SELECT_API' => 'true',
    'SELECT_WORKER' => 'false',
    'WEB_DIGEST' => digest,
    'BACKEND_DIGEST' => digest
  }
  _stdout, stderr, status = run_step(app_inventory, environment)
  assert(status.success?, "app inventory script failed: #{stderr}")
  deployment_dir = File.read(File.join(runner_temp, 'dev-k3s-deploy-path')).strip
  assert(JSON.parse(File.read(File.join(deployment_dir, 'hosts.yml'))) == { 'k3s_nodes' => { 'hosts' => { 'dev' => { 'ansible_host' => 'dev.example.test', 'ansible_user' => 'deploy_user' } } } }, 'app inventory JSON differs')
  assert(JSON.parse(File.read(File.join(deployment_dir, 'overrides.yml'))) == { 'deployment_targets' => %w[web api], 'web_image' => "ghcr.io/sirobaby/learningplatform-web@#{digest}", 'api_image' => "ghcr.io/sirobaby/learningplatform-api@#{digest}" }, 'app overrides JSON differs')
  assert((File.stat(File.join(deployment_dir, 'hosts.yml')).mode & 0o777) == 0o600, 'app hosts mode must be 0600')
  assert((File.stat(File.join(deployment_dir, 'overrides.yml')).mode & 0o777) == 0o600, 'app overrides mode must be 0600')

  _stdout, stderr, status = run_step(observability_inventory, environment)
  assert(status.success?, "observability inventory script failed: #{stderr}")
  observability_dir = File.read(File.join(runner_temp, 'dev-k3s-observability-path')).strip
  assert(JSON.parse(File.read(File.join(observability_dir, 'hosts.yml'))) == { 'k3s_nodes' => { 'hosts' => { 'dev' => { 'ansible_host' => 'dev.example.test', 'ansible_user' => 'deploy_user' } } } }, 'observability inventory JSON differs')
  assert((File.stat(File.join(observability_dir, 'hosts.yml')).mode & 0o777) == 0o600, 'observability hosts mode must be 0600')

  [ssh_trust, diagnose].each do |script|
    _stdout, stderr, status = Open3.capture3('bash', '-n', '-c', script)
    assert(status.success?, "workflow shell syntax failed: #{stderr}")
  end

  mock_bin = File.join(directory, 'bin')
  Dir.mkdir(mock_bin)
  File.write(File.join(mock_bin, 'ssh'), "#!/usr/bin/env bash\ncat >/dev/null\n")
  File.chmod(0o700, File.join(mock_bin, 'ssh'))
  bootstrap_environment = environment.merge(
    'PATH' => "#{mock_bin}:#{ENV.fetch('PATH')}",
    'OBSERVABILITY_AWS_ACCESS_KEY_ID' => 'fixture-access-key',
    'OBSERVABILITY_AWS_SECRET_ACCESS_KEY' => 'fixture-secret-key'
  )
  _stdout, stderr, status = run_step(bootstrap, bootstrap_environment)
  assert(status.success?, "bootstrap SSH fixture failed: #{stderr}")

  broken = app_inventory.sub("\nhost, user", "\n host, user")
  broken_runner_temp = File.join(directory, 'broken-runner-temp')
  Dir.mkdir(broken_runner_temp)
  _stdout, stderr, status = run_step(broken, environment.merge('RUNNER_TEMP' => broken_runner_temp))
  assert(!status.success? && stderr.include?('IndentationError'), 'pre-fix indentation fixture must raise IndentationError')
end

puts 'PASS deploy workflow embedded inventory and SSH scripts execute safely with fixtures'
