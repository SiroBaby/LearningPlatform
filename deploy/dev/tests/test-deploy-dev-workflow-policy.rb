#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'
require_relative 'workflow-expression-evaluator'

def safe_yaml_load(text)
  YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: true)
rescue ArgumentError
  YAML.safe_load(text, [], [], true)
end

root = File.expand_path('../../..', __dir__)
workflow_path = File.join(root, '.github', 'workflows', 'deploy-dev.yml')
workflow = safe_yaml_load(File.read(workflow_path))
playbook = safe_yaml_load(File.read(File.join(root, 'infra', 'ansible', 'playbooks', 'site.yml'))).first
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

def workflow_context(outputs:, results:, event_name:, ref:, target:, confirmation: '')
  {
    'github' => { 'event_name' => event_name, 'ref' => ref },
    'inputs' => { 'target' => target, 'observability_recovery_confirmation' => confirmation },
    'needs' => results.transform_values { |result| { 'result' => result } }.merge(
      'changes' => { 'result' => 'success', 'outputs' => outputs }
    )
  }
end

triggers = workflow['on'] || workflow[true]
assert(failures, triggers.dig('workflow_dispatch', 'inputs', 'target', 'options').include?('observability'),
       'workflow_dispatch must expose target=observability')
assert(failures, triggers.dig('workflow_dispatch', 'inputs', 'target', 'options').include?('observability-recovery'),
       'workflow_dispatch must expose target=observability-recovery')
assert(failures, triggers.dig('workflow_dispatch', 'inputs', 'target', 'options').include?('observability-health'),
       'workflow_dispatch must expose target=observability-health')
assert(failures, triggers.dig('workflow_dispatch', 'inputs', 'observability_recovery_confirmation', 'required') == true,
       'workflow_dispatch must require an observability recovery confirmation')

assert(failures, triggers.dig('push', 'branches') == ['develop'],
       'push must remain restricted to develop')
assert(failures, playbook.fetch('vars_files') == ['../vars/dev.yml'],
       'playbook must load canonical non-secret vars/dev.yml relative to its location')
observability_outputs = { 'deploy_any' => 'false', 'backend' => 'false', 'web' => 'false', 'observability' => 'true' }
observability_results = { 'infra-quality' => 'success' }
recovery_confirmation = 'RECOVER_MONITORING_PENDING_INSTALL_REVISION_1'
assert(failures, workflow_job_runs?(jobs, 'deploy-observability', workflow_context(outputs: observability_outputs, results: observability_results, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability')),
       'observability dispatch on develop must evaluate the YAML deployment expression to true')
assert(failures, !workflow_job_runs?(jobs, 'deploy-observability', workflow_context(outputs: observability_outputs, results: observability_results, event_name: 'workflow_dispatch', ref: 'refs/heads/feature/test', target: 'observability')),
       'observability dispatch on feature refs must evaluate the YAML deployment expression to false')
assert(failures, !workflow_job_runs?(jobs, 'deploy-observability', workflow_context(outputs: observability_outputs, results: { 'infra-quality' => 'skipped' }, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability')),
       'observability dispatch with skipped infra quality must evaluate the YAML deployment expression to false')
assert(failures, !workflow_job_runs?(jobs, 'deploy-observability', workflow_context(outputs: observability_outputs.merge('observability' => 'false'), results: observability_results, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability')),
       'unchanged observability dispatch must evaluate the YAML deployment expression to false')
assert(failures, workflow_job_runs?(jobs, 'recover-observability-pending-install', workflow_context(outputs: observability_outputs, results: observability_results, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability-recovery', confirmation: recovery_confirmation)),
       'confirmed recovery dispatch on develop must evaluate the YAML deployment expression to true')
assert(failures, !workflow_job_runs?(jobs, 'recover-observability-pending-install', workflow_context(outputs: observability_outputs, results: observability_results, event_name: 'push', ref: 'refs/heads/develop', target: 'observability-recovery', confirmation: recovery_confirmation)),
       'push events must never run recovery')
assert(failures, !workflow_job_runs?(jobs, 'recover-observability-pending-install', workflow_context(outputs: observability_outputs, results: observability_results, event_name: 'workflow_dispatch', ref: 'refs/heads/feature/test', target: 'observability-recovery', confirmation: recovery_confirmation)),
       'feature refs must never run recovery')
assert(failures, !workflow_job_runs?(jobs, 'recover-observability-pending-install', workflow_context(outputs: observability_outputs, results: observability_results, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability-recovery', confirmation: 'wrong')),
       'wrong recovery confirmation must never run recovery')
assert(failures, !workflow_job_runs?(jobs, 'recover-observability-pending-install', workflow_context(outputs: observability_outputs, results: { 'infra-quality' => 'failure' }, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability-recovery', confirmation: recovery_confirmation)),
       'failed infra quality must never run recovery')
assert(failures, !workflow_job_runs?(jobs, 'recover-observability-pending-install', workflow_context(outputs: observability_outputs, results: { 'infra-quality' => 'skipped' }, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability-recovery', confirmation: recovery_confirmation)),
       'skipped infra quality must never run recovery')
assert(failures, !workflow_job_runs?(jobs, 'recover-observability-pending-install', workflow_context(outputs: observability_outputs, results: observability_results, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability', confirmation: recovery_confirmation)),
       'ordinary observability target must never run recovery')
health_context = workflow_context(outputs: observability_outputs, results: {}, event_name: 'workflow_dispatch', ref: 'refs/heads/develop', target: 'observability-health')
assert(failures, workflow_job_runs?(jobs, 'observability-health', health_context),
       'observability health dispatch on develop must evaluate the YAML expression to true')
assert(failures, !workflow_job_runs?(jobs, 'observability-health', workflow_context(outputs: observability_outputs, results: {}, event_name: 'push', ref: 'refs/heads/develop', target: 'observability-health')),
       'push events must never run observability health')
assert(failures, !workflow_job_runs?(jobs, 'observability-health', workflow_context(outputs: observability_outputs, results: {}, event_name: 'workflow_dispatch', ref: 'refs/heads/feature/test', target: 'observability-health')),
       'feature refs must never run observability health')

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
build_images = jobs.fetch('build-images')
deploy = jobs.fetch('deploy')
assert(failures, build_images.fetch('needs') == %w[changes backend-quality frontend-quality infra-quality],
       'application image build must wait for infra-quality')
assert(failures, build_images.fetch('if').include?("needs.infra-quality.result == 'success' || needs.infra-quality.result == 'skipped'"),
       'application image build must block failed infra-quality but allow skipped infra-quality')
assert(failures, deploy.fetch('needs') == %w[changes infra-quality build-images],
       'application deploy must wait for infra-quality and image build')
assert(failures, deploy.fetch('if').include?("needs.infra-quality.result == 'success' || needs.infra-quality.result == 'skipped'"),
       'application deploy must block failed infra-quality but allow skipped infra-quality')

observability = jobs.fetch('deploy-observability')
observability_if = observability.fetch('if')
assert(failures, observability_if.include?("github.event_name == 'workflow_dispatch'") && observability_if.include?("inputs.target == 'observability'"),
        'target=observability must only be remotely deployable by explicit dispatch')
assert(failures, observability_if.include?("github.ref == 'refs/heads/develop'"),
       'target=observability must only be remotely deployable from refs/heads/develop')
assert(failures, observability_if.include?("needs.changes.outputs.observability == 'true'"),
        'target=observability must require observability classification')
assert(failures, observability_if.include?("needs.infra-quality.result == 'success'"),
       'target=observability must require infra-quality success')
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

recovery = jobs.fetch('recover-observability-pending-install')
recovery_if = recovery.fetch('if')
assert(failures, recovery.fetch('needs') == %w[changes infra-quality] && recovery.fetch('environment') == 'dev',
       'recovery must depend on classification and infra quality in the dev environment')
%w[workflow_dispatch refs/heads/develop observability-recovery RECOVER_MONITORING_PENDING_INSTALL_REVISION_1 needs.changes.outputs.observability needs.infra-quality.result].each do |required_guard|
  assert(failures, recovery_if.include?(required_guard), "recovery must require #{required_guard}")
end

health = jobs.fetch('observability-health')
health_if = health.fetch('if')
assert(failures, health.fetch('environment') == 'dev' && health.fetch('permissions') == { 'contents' => 'read' },
       'observability health must run in dev with read-only repository permission')
%w[workflow_dispatch refs/heads/develop observability-health].each do |required_guard|
  assert(failures, health_if.include?(required_guard), "observability health must require #{required_guard}")
end
assert(failures, health.fetch('needs', []).empty?,
       'observability health must not depend on classification, deployment, or recovery jobs')
health_steps = step_names(health)
assert(failures, health_steps.include?('Capture read-only observability health evidence') && health_steps.include?('Upload sanitized observability health evidence') && health_steps.include?('Fail health target from sanitized evidence'),
       'observability health must capture, upload, and terminally gate sanitized evidence')
health_source = health.fetch('steps').map { |step| [step['name'], step['run'], step['uses']].compact.join("\n") }.join("\n")
forbidden_health = %w[ansible helm docker nginx apply delete patch edit label annotate exec rollout recovery]
assert(failures, forbidden_health.none? { |token| health_source.match?(/#{Regexp.escape(token)}/i) },
       'observability health job must not invoke deployment, recovery, or mutation tools')
sampler_source = File.read(File.join(root, 'deploy', 'dev', 'observability-health.sh'))
assert(failures, step_by_name(health, 'Capture read-only observability health evidence').fetch('run').include?('observability-health.sh') &&
                   sampler_source.include?('StrictHostKeyChecking=yes'),
       'observability health must reuse source-managed sampler and strict SSH trust')
upload = step_by_name(health, 'Upload sanitized observability health evidence')
assert(failures, upload.fetch('if') == 'always()' && upload.fetch('uses') == 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
       'health evidence upload must run on failure and use the verified immutable artifact action SHA')
terminal_gate = step_by_name(health, 'Fail health target from sanitized evidence')
assert(failures, terminal_gate.fetch('if') == 'always()' && terminal_gate.fetch('run').include?("evidence.get('status') != 'PASS'"),
       'health terminal gate must fail non-PASS sanitized evidence after artifact upload')
apps_source = File.read(File.join(root, 'infra', 'k8s', 'apps.yaml.j2'))
assert(failures, apps_source.include?("name: api") && apps_source.include?("port: 3000") && sampler_source.include?('service/api 13001 3000'),
       'health sampler must use the source-defined API Service name and port')
recovery_apply = step_by_name(recovery, 'Recover observability pending-install revision through Ansible').fetch('run')
assert(failures, recovery_apply.include?('--tags external_secrets,observability -e observability_recover_pending_install=true'),
       'recovery must invoke only the fixed Ansible recovery opt-in beyond fixed paths')
assert(failures, !recovery_apply.match?(/inputs\.|\$\{\{|release|namespace|pvc|pv|helm/i),
       'recovery Ansible invocation must not interpolate user-controlled release, namespace, PVC, PV, Helm, or shell input')
recovery_forbidden = %w[build-push-action applications rollout database-migrate kubectl helm]
assert(failures, recovery_forbidden.none? { |token| recovery_apply.include?(token) || step_names(recovery).join('\n').include?(token) },
       'recovery must not build images, deploy applications, run rollout commands, or invoke kubectl/Helm directly')
recovery_bootstrap = step_by_name(recovery, 'Bootstrap observability AWS credential Secret')
assert(failures, !recovery_bootstrap.nil?,
       'recovery must reuse the guarded observability credential bootstrap')
if recovery_bootstrap
  recovery_bootstrap_run = recovery_bootstrap.fetch('run')
  assert(failures, !recovery_bootstrap_run.match?(/\$\{\{\s*(?:inputs|secrets)\.|(?:echo|printf).*OBSERVABILITY_AWS_/),
         'recovery credential bootstrap must not interpolate user inputs or print secrets')
  assert(failures, recovery_bootstrap_run.include?('tar -C "$CREDENTIAL_DIR" -cf - access-key-id secret-access-key |') && recovery_bootstrap_run.include?('ssh -o BatchMode=yes'),
         'recovery credential bootstrap must preserve stdin-only credential transport')
end

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
  observability_secret_jobs = %w[deploy-observability recover-observability-pending-install]
  assert(failures, observability_secret_jobs.all? { |name| job_secret_references(jobs.fetch(name)).grep(/^OBSERVABILITY_AWS_/).sort == expected_bootstrap_env.keys.sort },
          'only the observability deploy and recovery jobs may reference the two observability AWS GitHub Environment Secrets')
  assert(failures, (jobs.keys - observability_secret_jobs).none? { |name| job_secret_references(jobs.fetch(name)).any? { |secret| secret.start_with?('OBSERVABILITY_AWS_') } },
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
  assert(failures, bootstrap_run.include?("-o go-template='{{range $key, $_ := .data}}{{$key}}{{\"\\n\"}}{{end}}'") &&
                   !bootstrap_run.include?("jsonpath='{range $key := .data}"),
         'bootstrap must enumerate only Secret key names with the K3s-supported Go template, not the unsupported JSONPath range')
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
  step_by_name(observability, 'Create ephemeral Ansible inventory'),
  step_by_name(recovery, 'Create ephemeral Ansible inventory')
]
assert(failures, inventory_steps.all? { |step| step.fetch('run').include?('VPS_HOST and VPS_USER must be non-empty') },
        'all remote paths must reject empty host/user before SSH')
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
puts 'PASS workflow policy: observability recovery stays separately manual, confirmed, classified, infra-approved, and develop-only'
