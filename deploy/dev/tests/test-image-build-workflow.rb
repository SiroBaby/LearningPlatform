#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'
require 'open3'
require_relative 'workflow-expression-evaluator'

root = File.expand_path('../../..', __dir__)
workflow = YAML.safe_load(File.read(File.join(root, '.github/workflows/deploy-dev.yml')), aliases: true)
reusable = YAML.safe_load(File.read(File.join(root, '.github/workflows/build-image.yml')), aliases: true)
jobs = workflow.fetch('jobs')

def assert(condition, message)
  abort "FAIL #{message}" unless condition
end

builds = { 'build-api' => ['api', 'backend'], 'build-web' => ['web', 'web'], 'build-go-worker' => ['go-worker', 'go_worker'] }
builds.each do |name, (runtime, output)|
  job = jobs.fetch(name)
  assert(job.fetch('needs') == %w[changes image-quality-gate], "#{name}: retain quality gate without serial image dependencies")
  assert(job.fetch('if') == "needs.changes.outputs.#{output} == 'true'", "#{name}: build only selected runtime")
  assert(job.fetch('uses') == './.github/workflows/build-image.yml' && job.fetch('with') == { 'runtime' => runtime }, "#{name}: use canonical image builder")
  assert(job.fetch('permissions') == { 'contents' => 'read', 'packages' => 'write' }, "#{name}: scoped registry permissions")
end

expected_outputs = {
  'api_digest' => '${{ needs.build-api.outputs.digest }}',
  'web_digest' => '${{ needs.build-web.outputs.digest }}',
  'go_worker_digest' => '${{ needs.build-go-worker.outputs.digest }}'
}
assert(jobs.fetch('build-images').fetch('outputs') == expected_outputs, 'retain exact deployment digest output names')
assert(jobs.fetch('build-images').fetch('needs') == %w[changes image-quality-gate build-api build-web build-go-worker], 'collect only after all selected builds finish')
assert(jobs.fetch('build-images').fetch('permissions') == { 'contents' => 'read' }, 'collector must have no registry write permission')
assert(jobs.fetch('deploy').fetch('needs') == %w[changes infra-quality build-images], 'deployment dependencies remain unchanged')

steps = reusable.fetch('jobs').fetch('image').fetch('steps')
build = steps.find { |step| step['name'] == 'Build and cache without registry publication' }.fetch('with')
assert(build['push'] == false && build['platforms'] == 'linux/amd64', 'build must finish before publication with existing runner architecture')
assert(build['provenance'] == 'mode=min,inline-only=true', 'retain minimal provenance on immutable manifest')
assert(build['cache-from'] == 'type=gha,version=2,scope=dev-${{ inputs.runtime }}-v1', 'isolate cache import by runtime and policy version')
assert(build['cache-to'] == 'type=gha,version=2,scope=dev-${{ inputs.runtime }}-v1,mode=max', 'retain intermediate layers with same isolated cache scope')
assert(steps.last.fetch('run') == 'bash deploy/dev/publish-image.sh', 'publish must use source-managed retry implementation')
assert(reusable.dig('jobs', 'image', 'outputs', 'digest') == '${{ steps.publish.outputs.digest }}', 'only verified publication may emit digest')
triggers = reusable['on'] || reusable[true]
assert(triggers.dig('workflow_call', 'outputs', 'digest', 'value') == '${{ jobs.image.outputs.digest }}', 'reusable output must propagate verified digest')
assert(steps.all? { |step| !step.key?('uses') || step['uses'].match?(/@[a-f0-9]{40}\z/) }, 'image actions must be pinned to immutable SHAs')

# Evaluate all quality failure/cancellation cases against the production YAML.
quality_names = %w[backend-quality frontend-quality infra-quality worker-quality]
base = { 'changes' => { 'result' => 'success', 'outputs' => { 'deploy_any' => 'true', 'backend' => 'true', 'web' => 'true', 'go_worker' => 'true' } } }
quality_names.each do |name|
  %w[failure cancelled].each do |state|
    context = { 'needs' => base.merge(quality_names.to_h { |quality| [quality, { 'result' => quality == name ? state : 'success' }] }) }
    assert(!workflow_job_runs?(jobs, 'image-quality-gate', context), "#{name}=#{state} must block every image")
  end
end

%w[success skipped failure cancelled].repeated_permutation(3) do |states|
  needs = base.merge('image-quality-gate' => { 'result' => 'success' })
  builds.keys.zip(states).each { |name, state| needs[name] = { 'result' => state } }
  expected = states.all? { |state| %w[success skipped].include?(state) }
  assert(workflow_job_runs?(jobs, 'build-images', { 'needs' => needs }) == expected, "collector result matrix: #{states}")
end

builds.each do |name, (_runtime, output)|
  %w[success failure skipped cancelled].each do |gate|
    [true, false].each do |selected|
      needs = { 'changes' => { 'result' => 'success', 'outputs' => { output => selected.to_s } }, 'image-quality-gate' => { 'result' => gate } }
      assert(workflow_job_runs?(jobs, name, { 'needs' => needs }) == (gate == 'success' && selected), "#{name}: #{gate}/#{selected}")
    end
  end
end

collector = jobs.fetch('build-images').fetch('steps').first.fetch('run')
digest = "sha256:#{'a' * 64}"
environment = { 'SELECT_BACKEND' => 'true', 'SELECT_WEB' => 'true', 'SELECT_GO_WORKER' => 'true',
                'BACKEND_DIGEST' => digest, 'WEB_DIGEST' => digest, 'GO_WORKER_DIGEST' => digest }
_out, err, status = Open3.capture3(environment, 'bash', '-ceu', collector)
assert(status.success?, "collector rejects valid digests: #{err}")
%w[BACKEND WEB GO_WORKER].each do |runtime|
  ['', 'latest', 'sha256:short'].each do |invalid|
    _out, _err, status = Open3.capture3(environment.merge("#{runtime}_DIGEST" => invalid), 'bash', '-ceu', collector)
    assert(!status.success?, "collector must block selected #{runtime} missing/malformed digest")
  end
  _out, err, status = Open3.capture3(environment.merge("SELECT_#{runtime}" => 'false', "#{runtime}_DIGEST" => ''), 'bash', '-ceu', collector)
  assert(status.success?, "collector must accept unselected #{runtime}: #{err}")
end

puts 'PASS image workflow: parallel selected runtimes, quality failures, cache scopes and immutable digest propagation'
