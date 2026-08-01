#!/usr/bin/env ruby
# frozen_string_literal: true

require 'open3'
require 'optparse'
require 'tmpdir'

options = {}
OptionParser.new do |parser|
  parser.on('--render-dir DIRECTORY', 'Directory containing monitoring.yml, loki.yml, and alloy.yml') { |directory| options[:render_dir] = directory }
end.parse!

abort 'ERROR: --render-dir is required.' unless options[:render_dir]

root = File.expand_path('..', __dir__)
validator = File.join(root, 'validate-rendered-observability.rb')
render_dir = options[:render_dir]
inputs = %w[monitoring.yml loki.yml alloy.yml].map { |file| File.join(render_dir, file) }
abort 'ERROR: rendered files are missing.' unless inputs.all? { |path| File.file?(path) }

monitoring = File.read(inputs.first)
ingress = <<~YAML
  ---
  apiVersion: networking.k8s.io/v1
  kind: Ingress
  metadata: {name: second-grafana, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-monitoring, app.kubernetes.io/name: grafana}}
  spec: {rules: [{host: grafana.observability.internal, http: {paths: [{path: /, pathType: Prefix, backend: {service: {name: learning-platform-monitoring-grafana, port: {number: 80}}}}]}}]}
YAML
pvc = <<~YAML
  ---
  apiVersion: v1
  kind: PersistentVolumeClaim
  metadata: {name: duplicate, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-loki}}
  spec: {storageClassName: local-path, resources: {requests: {storage: 2Gi}}}
YAML
mutations = {
  'second ingress' => monitoring + ingress,
  'wrong ingress port' => monitoring.sub('number: 80', 'number: 443'),
  'ingress TLS' => monitoring.sub("rules:\n", "tls: [{hosts: [grafana.observability.internal]}]\n  rules:\n"),
  'reloader drift' => monitoring.sub('--config-reloader-cpu-request=25m', '--config-reloader-cpu-request=24m'),
  'duplicate PVC' => monitoring + pvc,
  'unexpected container' => monitoring.sub('containers:', "containers:\n        - name: unexpected\n          resources: {requests: {cpu: 1m, memory: 1Mi}, limits: {cpu: 1m, memory: 1Mi}}")
}.freeze

failures = []
Dir.mktmpdir('rendered-observability-real-policy') do |directory|
  mutations.each do |label, mutated_monitoring|
    monitoring_path = File.join(directory, "#{label.gsub(/[^a-z]+/i, '-')}.yml")
    File.write(monitoring_path, mutated_monitoring)
    _output, status = Open3.capture2e('ruby', validator, '--input', monitoring_path, '--input', inputs[1], '--input', inputs[2])
    failures << "real render mutation unexpectedly passed: #{label}" if status.success?
  end
end

abort "FAIL\n#{failures.join("\n")}" unless failures.empty?
puts "PASS #{mutations.length} real-rendered-observability-policy mutations"
