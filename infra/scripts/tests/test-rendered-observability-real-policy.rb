#!/usr/bin/env ruby
# frozen_string_literal: true

require 'open3'
require 'optparse'
require 'tmpdir'
require 'yaml'

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

def mutate_document(raw, label, predicate)
  documents = raw.split(/(?=^---\s*$)/)
  index = documents.index do |document|
    parsed = YAML.safe_load(document, permitted_classes: [], permitted_symbols: [], aliases: false)
    predicate.call(parsed)
  rescue Psych::SyntaxError
    false
  end
  abort "ERROR: #{label} document not found in rendered manifest." unless index

  mutated = yield(documents[index])
  abort "ERROR: #{label} mutation did not change raw document." if mutated == documents[index]

  documents[index] = mutated
  documents.join
end

def mutate_operator_document(monitoring)
  predicate = lambda do |document|
    document.is_a?(Hash) &&
      document['kind'] == 'Deployment' &&
      document.dig('metadata', 'labels', 'app.kubernetes.io/instance') == 'learning-platform-monitoring' &&
      document.dig('metadata', 'labels', 'app.kubernetes.io/name') == 'kube-prometheus-stack-prometheus-operator'
  end
  mutate_document(monitoring, 'Prometheus Operator Deployment', predicate) { |document| yield(document) }
end

def mutate_alloy_document(alloy)
  predicate = lambda do |document|
    document.is_a?(Hash) &&
      document['kind'] == 'DaemonSet' &&
      document.dig('metadata', 'name') == 'learning-platform-alloy' &&
      document.dig('metadata', 'labels', 'app.kubernetes.io/instance') == 'learning-platform-alloy' &&
      document.dig('metadata', 'labels', 'app.kubernetes.io/name') == 'alloy'
  end
  mutate_document(alloy, 'Alloy DaemonSet', predicate) { |document| yield(document) }
end

def mutate_loki_config_map(loki)
  predicate = lambda do |document|
    document.is_a?(Hash) &&
      document['kind'] == 'ConfigMap' &&
      document.dig('metadata', 'name') == 'loki' &&
      document.dig('metadata', 'labels', 'app.kubernetes.io/instance') == 'learning-platform-loki'
  end
  mutate_document(loki, 'Loki ConfigMap', predicate) { |document| yield(document) }
end

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
  'reloader drift' => mutate_operator_document(monitoring) { |operator| operator.sub('--config-reloader-cpu-request=25m', '--config-reloader-cpu-request=24m') },
  'duplicate PVC' => monitoring + pvc,
  'unexpected container' => mutate_operator_document(monitoring) do |operator|
    operator.sub("      containers:\n", "      containers:\n        - name: unexpected\n          resources: {requests: {cpu: 1m, memory: 1Mi}, limits: {cpu: 1m, memory: 1Mi}}\n")
  end,
  'operator admission TLS secret volume' => mutate_operator_document(monitoring) do |operator|
    operator.sub("      volumes:\n", "      volumes:\n        - name: tls-secret\n          secret:\n            secretName: learning-platform-monitori-admission\n")
  end,
  'operator TLS certificate mount' => mutate_operator_document(monitoring) do |operator|
    operator.sub("          volumeMounts:\n", "          volumeMounts:\n            - name: tls-secret\n              mountPath: /cert\n              readOnly: true\n")
  end,
  'missing Alloy storage volume' => mutate_alloy_document(File.read(inputs[2])) do |alloy|
    alloy.sub(/\n        - emptyDir:\n            sizeLimit: 128Mi\n          name: alloy-storage/, '')
  end,
  'wrong Alloy storage mount' => mutate_alloy_document(File.read(inputs[2])) do |alloy|
    alloy.sub('mountPath: /tmp/alloy', 'mountPath: /tmp/wrong')
  end,
  'wrong config-reloader UID' => mutate_alloy_document(File.read(inputs[2])) do |alloy|
    alloy.sub('runAsUser: 65534', 'runAsUser: 1000')
  end,
  'missing config-reloader UID' => mutate_alloy_document(File.read(inputs[2])) do |alloy|
    alloy.sub("\n            runAsUser: 65534", '')
  end,
  'Loki auth enabled' => mutate_loki_config_map(File.read(inputs[1])) do |loki|
    loki.sub('auth_enabled: false', 'auth_enabled: true')
  end,
  'Loki auth missing' => mutate_loki_config_map(File.read(inputs[1])) do |loki|
    loki.sub("    auth_enabled: false\n", '')
  end
}.freeze

failures = []
Dir.mktmpdir('rendered-observability-real-policy') do |directory|
  mutations.each do |label, mutation|
    monitoring_path = File.join(directory, "#{label.gsub(/[^a-z]+/i, '-')}-monitoring.yml")
    loki_path = File.join(directory, "#{label.gsub(/[^a-z]+/i, '-')}-loki.yml")
    alloy_path = File.join(directory, "#{label.gsub(/[^a-z]+/i, '-')}-alloy.yml")
    mutated_monitoring = label.include?('Alloy') || label.include?('reloader UID') || label.start_with?('Loki') ? monitoring : mutation
    mutated_loki = label.start_with?('Loki') ? mutation : File.read(inputs[1])
    mutated_alloy = label.include?('Alloy') || label.include?('reloader UID') ? mutation : File.read(inputs[2])
    File.write(monitoring_path, mutated_monitoring)
    File.write(loki_path, mutated_loki)
    File.write(alloy_path, mutated_alloy)
    _output, status = Open3.capture2e('ruby', validator, '--input', monitoring_path, '--input', loki_path, '--input', alloy_path)
    failures << "real render mutation unexpectedly passed: #{label}" if status.success?
  end
end

abort "FAIL\n#{failures.join("\n")}" unless failures.empty?
puts "PASS #{mutations.length} real-rendered-observability-policy mutations"
