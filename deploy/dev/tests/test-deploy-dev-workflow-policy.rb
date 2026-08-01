#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'

def safe_yaml_load(text)
  YAML.safe_load(
    text,
    permitted_classes: [],
    permitted_symbols: [],
    aliases: true
  )
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

def eligible_jobs(target, observability_changed)
  return %w[changes backend-quality build-images deploy] if target == 'api'
  return %w[changes infra-quality deploy-observability] if target == 'observability' && observability_changed

  ['changes']
end

safe_load_parameters = YAML.method(:safe_load).parameters
assert(
  failures,
  safe_load_parameters.any? { |kind, name| [:key, :keyrest].include?(kind) && name == :permitted_classes } ||
    safe_load_parameters.any? { |kind, name| [:opt, :rest].include?(kind) && name != :kwargs },
  'YAML.safe_load must expose either keyword arguments or legacy positional arguments for compatibility helper'
)

triggers = workflow['on'] || workflow[true]
assert(failures, !triggers.nil?, "workflow must preserve the GitHub Actions 'on' trigger even when YAML 1.1 parses it as boolean true")
target_options = triggers.dig('workflow_dispatch', 'inputs', 'target', 'options')
assert(failures, target_options == %w[web api worker all],
       'workflow_dispatch must expose exactly web, api, worker, and all targets')

assert(failures, triggers.dig('push', 'branches') == ['develop'],
       'push must remain restricted to develop')
expected_roles = %w[k3s external_secrets applications monitoring]
assert(failures, playbook.fetch('roles').map { |role| role.fetch('role') } == expected_roles,
       'playbook must retain the canonical K3s, external secrets, applications, and monitoring role order')

changes = jobs.fetch('changes')
assert(failures, changes.fetch('outputs') == {
         'web' => '${{ steps.classify.outputs.web }}',
         'api' => '${{ steps.classify.outputs.api }}',
         'worker' => '${{ steps.classify.outputs.worker }}',
         'backend' => '${{ steps.classify.outputs.backend }}',
         'deploy_any' => '${{ steps.classify.outputs.deploy_any }}'
       }, 'changes must expose the canonical web/api/worker/backend/deploy_any classification outputs')

expected_jobs = %w[changes backend-quality frontend-quality build-images deploy]
assert(failures, jobs.keys == expected_jobs,
       'workflow must retain the canonical changes, quality, build-images, and deploy jobs only')
assert(failures, eligible_jobs('api', true) == %w[changes backend-quality build-images deploy],
       'api fixture must select only the application quality/build/deploy path')
assert(failures, jobs.fetch('deploy').fetch('if').include?("needs.changes.outputs.deploy_any == 'true'"),
       'target=api deploy must remain gated by selected application changes')
assert(failures, jobs.fetch('build-images').fetch('if').include?("needs.backend-quality.result == 'success' || needs.backend-quality.result == 'skipped'"),
       'build-images must tolerate skipped backend-quality when backend is not selected')
assert(failures, jobs.fetch('build-images').fetch('if').include?("needs.frontend-quality.result == 'success' || needs.frontend-quality.result == 'skipped'"),
       'build-images must tolerate skipped frontend-quality when web is not selected')
assert(failures, step_names(jobs.fetch('deploy')).include?('Apply selected applications through Ansible'),
       'target=api deploy must apply applications')
assert(failures, step_by_name(jobs.fetch('deploy'), 'Apply selected applications through Ansible').fetch('run').include?('--tags applications'),
       'target=api deploy must retain applications-only Ansible tags')
inventory_steps = [
  step_by_name(jobs.fetch('deploy'), 'Create ephemeral Ansible inventory and deployment overrides')
]
assert(failures, inventory_steps.all? { |step| step.fetch('run').include?('VPS_HOST and VPS_USER must be non-empty') },
       'deploy path must reject empty host/user before SSH')
assert(failures, step_by_name(jobs.fetch('deploy'), 'Create ephemeral Ansible inventory and deployment overrides').fetch('run').include?('digest is not immutable'),
       'target=api must reject mutable selected image digests before SSH')

source = File.read(workflow_path)
assert(failures, source.match?(/DEV_K3S_ANSIBLE_VARS_B64/) && source.match?(/base64\s+--decode/),
       'workflow must decode the non-runtime Ansible host configuration bundle from the environment secret')
assert(failures, !source.match?(/deploy-observability|external_secrets,observability|OBSERVABILITY_AWS_/),
       'workflow must not retain stale observability-only deployment paths or secrets in the current application rollout pipeline')

abort "FAIL\n#{failures.join("\n")}" unless failures.empty?
puts 'PASS workflow policy: portable YAML loading and current application deployment pipeline contract verified'
