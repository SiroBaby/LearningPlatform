#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'open3'
require 'tmpdir'
require 'yaml'
require_relative 'workflow-expression-evaluator'

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

def workflow_context(outputs:, results:, event_name: 'push', ref: 'refs/heads/develop', target: 'auto')
  {
    'github' => { 'event_name' => event_name, 'ref' => ref },
    'inputs' => { 'target' => target },
    'needs' => results.transform_values { |result| { 'result' => result } }.merge(
      'changes' => { 'result' => 'success', 'outputs' => outputs }
    )
  }
end

matrix = {
  'app-only infra skipped' => [
    { 'deploy_any' => 'true', 'backend' => 'true', 'web' => 'false', 'observability' => 'false' },
    { 'backend-quality' => 'success', 'frontend-quality' => 'skipped', 'infra-quality' => 'skipped', 'build-images' => 'success' },
    true, true
  ],
  'mixed app and infra success' => [
    { 'deploy_any' => 'true', 'backend' => 'true', 'web' => 'true', 'observability' => 'true' },
    { 'backend-quality' => 'success', 'frontend-quality' => 'success', 'infra-quality' => 'success', 'build-images' => 'success' },
    true, true
  ],
  'infra failure blocks application flow' => [
    { 'deploy_any' => 'true', 'backend' => 'true', 'web' => 'false', 'observability' => 'true' },
    { 'backend-quality' => 'success', 'frontend-quality' => 'skipped', 'infra-quality' => 'failure', 'build-images' => 'skipped' },
    false, false
  ],
  'infra cancelled blocks application flow' => [
    { 'deploy_any' => 'true', 'backend' => 'true', 'web' => 'false', 'observability' => 'true' },
    { 'backend-quality' => 'success', 'frontend-quality' => 'skipped', 'infra-quality' => 'cancelled', 'build-images' => 'skipped' },
    false, false
  ],
  'backend skipped frontend succeeds' => [
    { 'deploy_any' => 'true', 'backend' => 'false', 'web' => 'true', 'observability' => 'false' },
    { 'backend-quality' => 'skipped', 'frontend-quality' => 'success', 'infra-quality' => 'skipped', 'build-images' => 'success' },
    true, true
  ],
  'frontend skipped backend succeeds' => [
    { 'deploy_any' => 'true', 'backend' => 'true', 'web' => 'false', 'observability' => 'false' },
    { 'backend-quality' => 'success', 'frontend-quality' => 'skipped', 'infra-quality' => 'skipped', 'build-images' => 'success' },
    true, true
  ]
}

%w[build-images deploy].each do |job_name|
  assert(jobs.fetch(job_name).fetch('if').include?('always()'), "#{job_name} must retain always() so skipped quality needs are evaluated")
end

matrix.each do |name, (outputs, results, build_expected, deploy_expected)|
  context = workflow_context(outputs: outputs, results: results)
  assert(workflow_job_runs?(jobs, 'build-images', context) == build_expected, "#{name}: build-images must evaluate its YAML if expression")
  assert(workflow_job_runs?(jobs, 'deploy', context) == deploy_expected, "#{name}: deploy must evaluate its YAML if expression")
end

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
  remote_tmp = File.join(directory, 'remote-tmp')
  brittle_bash_env = File.join(directory, 'brittle-bash-env')
  Dir.mkdir(mock_bin)
  Dir.mkdir(remote_tmp)
  File.write(brittle_bash_env, "PS1=\"${PS1}:fixture\"\n")
  File.write(File.join(mock_bin, 'ssh'), <<~'BASH')
    #!/usr/bin/env bash
    set -Eeuo pipefail
    remote_command="${!#}"
    payload="$(mktemp)"
    trap 'rm -f -- "$payload"' EXIT
    cat > "$payload"
    env BASH_ENV="$MOCK_BASH_ENV" bash -c "$remote_command" < "$payload"
  BASH
  File.write(File.join(mock_bin, 'sudo'), <<~'BASH')
    #!/usr/bin/env bash
    set -Eeuo pipefail
    exec "$@"
  BASH
  File.write(File.join(mock_bin, 'k3s'), <<~'BASH')
    #!/usr/bin/env bash
    set -Eeuo pipefail
    [ "$1" = kubectl ]
    shift
    case "$1" in
      create)
        printf '%s\n' 'apiVersion: v1'
        ;;
      apply)
        [ "$2" = -f ] && [ "$3" = - ]
        cat >/dev/null
        ;;
      get)
        case "$*" in
          *'{.type}'*) printf '%s' 'Opaque' ;;
          *'.data'*) printf '%s\n' 'access-key-id' 'secret-access-key' ;;
          *) exit 1 ;;
        esac
        ;;
      *)
        exit 1
        ;;
    esac
  BASH
  %w[ssh sudo k3s].each { |name| File.chmod(0o700, File.join(mock_bin, name)) }
  bootstrap_environment = environment.merge(
    'PATH' => "#{mock_bin}:#{ENV.fetch('PATH')}",
    'MOCK_BASH_ENV' => brittle_bash_env,
    'TMPDIR' => remote_tmp,
    'OBSERVABILITY_AWS_ACCESS_KEY_ID' => 'fixture-access-key',
    'OBSERVABILITY_AWS_SECRET_ACCESS_KEY' => 'fixture-secret-key'
  )
  stdout, stderr, status = run_step(bootstrap, bootstrap_environment)
  output = "#{stdout}#{stderr}"
  assert(status.success?, "bootstrap SSH fixture failed: #{stderr}")
  assert(!output.include?('fixture-access-key') && !output.include?('fixture-secret-key'), 'bootstrap fixture must not expose credentials')
  assert(Dir.children(remote_tmp).empty?, 'remote credential directory must be cleaned up')
  assert(Dir.children(runner_temp).none? { |name| name.start_with?('observability-aws-credentials.') }, 'local credential directory must be cleaned up')

  broken = app_inventory.sub("\nhost, user", "\n host, user")
  broken_runner_temp = File.join(directory, 'broken-runner-temp')
  Dir.mkdir(broken_runner_temp)
  _stdout, stderr, status = run_step(broken, environment.merge('RUNNER_TEMP' => broken_runner_temp))
  assert(!status.success? && stderr.include?('IndentationError'), 'pre-fix indentation fixture must raise IndentationError')
end

puts 'PASS deploy workflow embedded inventory and SSH scripts execute safely with fixtures'
