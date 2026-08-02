#!/usr/bin/env ruby
# frozen_string_literal: true

require 'fileutils'
require 'open3'
require 'tmpdir'

root = File.expand_path('..', __dir__)
validator = File.join(root, 'validate-rendered-observability.rb')
fixture = File.join(__dir__, 'fixtures', 'rendered-observability-valid.yml')

cases = {
  'public LoadBalancer/NodePort' => ['type: ClusterIP', 'type: LoadBalancer'],
  'public NodePort' => ['type: ClusterIP', 'type: NodePort'],
  'missing Grafana Ingress root backend' => ['name: learning-platform-monitoring-grafana, port: {number: 80}', 'name: wrong-backend, port: {number: 80}'],
  'wrong Grafana root URL' => ['https://157.66.101.219/', 'https://wrong.example/'],
  'second Grafana Ingress' => ["---\napiVersion: networking.k8s.io/v1", "---\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: {name: second-grafana, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-monitoring, app.kubernetes.io/name: grafana}}\nspec: {rules: [{host: grafana.observability.internal, http: {paths: [{path: /, pathType: Prefix, backend: {service: {name: learning-platform-monitoring-grafana, port: {number: 80}}}}]}}]}\n---\napiVersion: networking.k8s.io/v1"],
  'wrong Grafana Ingress port' => ['port: {number: 80}', 'port: {number: 443}'],
  'Grafana Ingress TLS' => ["spec:\n  rules:", "spec:\n  tls: [{hosts: [grafana.observability.internal]}]\n  rules:"],
  'resources missing' => ['requests: {cpu: 50m, memory: 64Mi}', 'requests: {}'],
  'missing Prometheus reloader accounting' => ['--config-reloader-memory-limit=64Mi', '--config-reloader-memory-limit=32Mi'],
  'resource overflow' => ['cpu: 250m, memory: 256Mi', 'cpu: "3", memory: 256Mi'],
  'wrong PVC' => ['storage: 2Gi', 'storage: 9Gi'],
  'duplicate allowed size PVC' => ["---\napiVersion: apps/v1", "---\napiVersion: v1\nkind: PersistentVolumeClaim\nmetadata: {name: duplicate, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-loki}}\nspec: {storageClassName: local-path, resources: {requests: {storage: 2Gi}}}\n---\napiVersion: apps/v1"],
  'Delete PVC policy' => ['whenDeleted: Retain', 'whenDeleted: Delete'],
  'missing PVC policy' => ['whenScaled: Retain', 'whenScaled:'],
  'Alertmanager rendered' => ['learning-platform-monitoring-operator', 'learning-platform-alertmanager'],
  'MinIO rendered' => ["---\napiVersion: apps/v1", "---\napiVersion: v1\nkind: Service\nmetadata: {name: learning-platform-minio, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-loki}}\nspec: {type: ClusterIP}\n---\napiVersion: apps/v1"],
  'duplicate KSM' => ['learning-platform-monitoring-kube-state-metrics', 'learning-platform-monitoring-kube-state-metrics\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata: {name: duplicate-kube-state-metrics, namespace: observability}\nspec: {template: {spec: {containers: [{name: ksm, resources: {requests: {cpu: 1m, memory: 1Mi}, limits: {cpu: 1m, memory: 1Mi}}}]}}}\n#'],
  'high-cardinality Alloy labels' => ['stage.label_keep', '__meta_kubernetes_pod_uid\n    stage.label_keep'],
  'forbidden RBAC' => ['resources: [pods, pods/log]', 'resources: [secrets]'],
  'privileged Alloy' => ['privileged: false', 'privileged: true'],
  'hostPath Alloy' => ['hostPID: false', 'hostPID: false\n      volumes: [{name: host, hostPath: {path: /}}]'],
  'unexpected long-running container' => ['- name: grafana', "- name: unexpected\n          resources: {requests: {cpu: 0m, memory: 0Mi}, limits: {cpu: 0m, memory: 0Mi}}\n        - name: grafana"],
  'operator admission TLS secret volume' => ['      volumes: []', "      volumes:\n        - name: tls-secret\n          secret: {secretName: learning-platform-monitori-admission}"],
  'operator TLS certificate mount' => ['          volumeMounts: []', "          volumeMounts:\n            - name: tls-secret\n              mountPath: /cert\n              readOnly: true"],
  'plaintext rendered Secret' => ["---\napiVersion: monitoring.coreos.com/v1", "---\napiVersion: v1\nkind: Secret\nmetadata: {name: plaintext, namespace: observability}\nstringData: {password: plaintext}\n---\napiVersion: monitoring.coreos.com/v1"]
}.freeze

failures = []
Dir.mktmpdir('rendered-observability-policy') do |directory|
  output, status = Open3.capture2e('ruby', validator, '--input', fixture, '--junit', File.join(directory, 'valid.xml'))
  failures << "valid fixture: #{output}" unless status.success?
  cases.each do |label, (from, to)|
    content = File.read(fixture).sub(from, to)
    path = File.join(directory, "#{label.gsub(/[^a-z]+/i, '-')}.yml")
    File.write(path, content)
    _output, failed = Open3.capture2e('ruby', validator, '--input', path, '--junit', "#{path}.xml")
    failures << "negative fixture unexpectedly passed: #{label}" if failed.success?
  end
  ruby_tag_path = File.join(directory, 'ruby-tag.yml')
  File.write(ruby_tag_path, "--- !ruby/object:OpenStruct\nvalue: fixture\n")
  ruby_tag_output, ruby_tag_status = Open3.capture2e('ruby', validator, '--input', ruby_tag_path)
  failures << 'Ruby object tag must be rejected before YAML loading' if ruby_tag_status.success? || !ruby_tag_output.include?('must not use Ruby object tags')

  alias_path = File.join(directory, 'alias.yml')
  File.write(alias_path, <<~YAML)
    ---
    apiVersion: v1
    kind: ConfigMap
    metadata: {name: alias-a, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-monitoring}}
    data: {source: &source fixture, copy: *source}
  YAML
  alias_output, alias_status = Open3.capture2e('ruby', validator, '--input', alias_path)
  failures << "YAML aliases must parse as trusted pre-render input: #{alias_output}" if alias_status.success? || alias_output.include?('cannot parse rendered YAML')
end

abort "FAIL\n#{failures.join("\n")}" unless failures.empty?
puts "PASS #{cases.length + 1} rendered-observability-policy fixtures"
