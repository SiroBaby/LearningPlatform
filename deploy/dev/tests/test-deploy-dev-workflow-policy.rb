#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'

root = File.expand_path('../../..', __dir__)
workflow_path = File.join(root, '.github', 'workflows', 'deploy-dev.yml')
workflow = YAML.safe_load(File.read(workflow_path), [], [], true)
playbook = YAML.safe_load(File.read(File.join(root, 'infra', 'ansible', 'playbooks', 'site.yml')), [], [], true).first
jobs = workflow.fetch('jobs')
failures = []

def assert(failures, condition, message)
  failures << message unless condition
end

def step_names(job)
  job.fetch('steps', []).map { |step| step['name'] }.compact
end

def step_by_name(job, name)
  job.fetch('steps', []).find { |step| step['name'] == name }
end

def job_secret_references(job)
  job.to_s.scan(/secrets\.([A-Z0-9_]+)/).flatten
end

def eligible_jobs(target, observability_changed)
  return %w[changes backend-quality build-images deploy] if target == 'api'
  return %w[changes infra-quality deploy-observability] if target == 'observability' && observability_changed

  ['changes']
end

triggers = workflow['on'] || workflow[true]
assert(failures, triggers.dig('workflow_dispatch', 'inputs', 'target', 'options').include?('observability'),
       'workflow_dispatch must expose target=observability')

assert(failures, triggers.dig('push', 'branches') == ['develop'],
       'push must remain restricted to develop')
assert(failures, playbook.fetch('vars_files') == ['../vars/dev.yml'],
       'playbook must load canonical non-secret vars/dev.yml relative to its location')
assert(failures, eligible_jobs('api', true) == %w[changes backend-quality build-images deploy],
       'api fixture must select only the application quality/build/deploy path')
assert(failures, eligible_jobs('observability', true) == %w[changes infra-quality deploy-observability],
       'observability fixture must select only infrastructure quality and explicit observability deployment')
assert(failures, eligible_jobs('observability', false) == ['changes'],
       'unchanged observability fixture must not select a remote deployment')

changes = jobs.fetch('changes')
assert(failures, changes.dig('outputs', 'observability') == '${{ steps.classify.outputs.observability }}',
       'changes must expose observability classification')

api_jobs = %w[backend-quality build-images deploy]
assert(failures, api_jobs.all? { |job| jobs.key?(job) },
       'target=api requires the existing quality, build, and deploy jobs')
assert(failures, jobs.fetch('deploy').fetch('if').include?("needs.changes.outputs.deploy_any == 'true'"),
       'target=api deploy must remain gated by selected application changes')
assert(failures, step_names(jobs.fetch('deploy')).include?('Apply selected applications through Ansible'),
       'target=api deploy must apply applications')
assert(failures, step_by_name(jobs.fetch('deploy'), 'Apply selected applications through Ansible').fetch('run').include?('--tags applications'),
       'target=api deploy must retain applications-only Ansible tags')

observability = jobs.fetch('deploy-observability')
observability_if = observability.fetch('if')
assert(failures, observability_if.include?("github.event_name == 'workflow_dispatch'") && observability_if.include?("inputs.target == 'observability'"),
       'target=observability must only be remotely deployable by explicit dispatch')
assert(failures, observability_if.include?("needs.changes.outputs.observability == 'true'"),
       'target=observability must require observability classification')
assert(failures, observability.fetch('needs') == %w[changes infra-quality],
       'target=observability must depend only on change classification and infra quality')
assert(failures, step_names(observability).include?('Apply External Secrets and observability through Ansible'),
       'target=observability must have its dedicated Ansible apply step')
observability_apply = step_by_name(observability, 'Apply External Secrets and observability through Ansible').fetch('run')
assert(failures, observability_apply.include?('--tags external_secrets,observability'),
       'target=observability must apply only external_secrets and observability tags')
forbidden_observability = %w[build-push-action applications rollout database-migrate]
assert(failures, forbidden_observability.none? { |token| observability_apply.include?(token) || step_names(observability).join('\n').include?(token) },
       'target=observability must not build, migrate, or restart application workloads')

bootstrap = step_by_name(observability, 'Bootstrap observability AWS credential Secret')
assert(failures, !bootstrap.nil?,
       'target=observability must bootstrap its dedicated AWS credential Secret before Ansible')
if bootstrap
  bootstrap_env = bootstrap.fetch('env')
  expected_bootstrap_env = {
    'OBSERVABILITY_AWS_ACCESS_KEY_ID' => '${{ secrets.OBSERVABILITY_AWS_ACCESS_KEY_ID }}',
    'OBSERVABILITY_AWS_SECRET_ACCESS_KEY' => '${{ secrets.OBSERVABILITY_AWS_SECRET_ACCESS_KEY }}'
  }
  assert(failures, expected_bootstrap_env.all? { |name, value| bootstrap_env[name] == value },
         'bootstrap must consume exactly both dedicated GitHub Environment Secrets through step env')
  assert(failures, job_secret_references(observability).grep(/^OBSERVABILITY_AWS_/).sort == expected_bootstrap_env.keys.sort,
         'only deploy-observability may reference the two observability AWS GitHub Environment Secrets')
  assert(failures, (jobs.keys - ['deploy-observability']).none? { |name| job_secret_references(jobs.fetch(name)).any? { |secret| secret.start_with?('OBSERVABILITY_AWS_') } },
         'application, quality, and push jobs must not consume observability AWS GitHub Environment Secrets')

  bootstrap_run = bootstrap.fetch('run')
  assert(failures, !bootstrap_run.match?(/\$\{\{\s*secrets\./),
         'bootstrap run script must not interpolate GitHub Secrets directly')
  assert(failures, !bootstrap_run.match?(/(?:echo|printf).*OBSERVABILITY_AWS_/),
         'bootstrap must never print a credential environment variable')
  assert(failures, !bootstrap_run.match?(/(?:upload-artifact|actions\/cache|cache-dependency-path)/),
         'bootstrap must not upload credentials through artifacts or caches')
  assert(failures, bootstrap_run.include?('tar -C "$CREDENTIAL_DIR" -cf - access-key-id secret-access-key |') && bootstrap_run.include?('ssh -o BatchMode=yes'),
         'bootstrap must transfer the two credential files only through tar stdin to SSH')
  assert(failures, bootstrap_run.include?('trap cleanup_credentials EXIT') && bootstrap_run.include?('trap cleanup_remote_credentials EXIT'),
         'bootstrap must clean local and remote credential directories on every exit')
  assert(failures, bootstrap_run.include?('sudo k3s kubectl create namespace observability --dry-run=client -o yaml | sudo k3s kubectl apply -f -'),
         'bootstrap must idempotently create the observability namespace before the Secret')
  assert(failures, bootstrap_run.include?('sudo k3s kubectl create secret generic observability-aws-credentials --namespace observability') &&
                   bootstrap_run.include?('--from-file=access-key-id=') &&
                   bootstrap_run.include?('--from-file=secret-access-key=') &&
                   bootstrap_run.include?('--dry-run=client -o yaml | sudo k3s kubectl apply -f -'),
         'bootstrap must upsert only the exact opaque observability Secret from files')
  assert(failures, bootstrap_run.include?('type=Opaque key_count=2 keys=access-key-id,secret-access-key') && bootstrap_run.include?('LC_ALL=C sort'),
         'bootstrap must verify only opaque Secret metadata and the exact sorted keys')
  assert(failures, !bootstrap_run.match?(/set -x|--from-literal|base64 --decode/),
         'bootstrap must not trace, use literals, or decode a desired-state blob')
end

bootstrap_position = step_names(observability).index('Bootstrap observability AWS credential Secret')
ssh_position = step_names(observability).index('Configure SSH trust')
ansible_position = step_names(observability).index('Apply External Secrets and observability through Ansible')
assert(failures, !bootstrap_position.nil? && bootstrap_position == ssh_position + 1 && bootstrap_position < ansible_position,
       'bootstrap must run immediately after SSH trust and before observability Ansible')

inventory_steps = [
  step_by_name(jobs.fetch('deploy'), 'Create ephemeral Ansible inventory and deployment overrides'),
  step_by_name(observability, 'Create ephemeral Ansible inventory')
]
assert(failures, inventory_steps.all? { |step| step.fetch('run').include?('VPS_HOST and VPS_USER must be non-empty') },
       'both remote paths must reject empty host/user before SSH')
assert(failures, step_by_name(jobs.fetch('deploy'), 'Create ephemeral Ansible inventory and deployment overrides').fetch('run').include?('digest is not immutable'),
       'target=api must reject mutable selected image digests before SSH')

source = File.read(workflow_path)
assert(failures, !source.match?(/DEV_K3S_ANSIBLE_VARS_B64|ANSIBLE_VARS_B64|base64\s+--decode/),
       'workflow must not contain a desired-state base64 transport')
assert(failures, source.match?(/site\.yml --tags applications/) && source.match?(/site\.yml --tags external_secrets,observability/),
       'application and observability Ansible paths must remain distinct')
assert(failures, !source.match?(/learning-platform-dev-aws-credentials|aws_credentials_secret_name.*observability/i),
       'observability bootstrap must not reuse the application AWS Secret contract')

abort "FAIL\n#{failures.join("\n")}" unless failures.empty?
puts 'PASS workflow policy: api selects application pipeline; observability selects explicit ESO/observability pipeline only'
