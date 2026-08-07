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
  'wrong Grafana root URL' => ['https://grafana.sirobabycloud.io.vn/', 'https://wrong.example/'],
  'wrong Grafana domain' => ['domain = grafana.sirobabycloud.io.vn', 'domain = wrong.example'],
  'enabled Kubernetes Logs Drilldown' => ['kubernetesLogsDrilldown = false', 'kubernetesLogsDrilldown = true'],
  'wrong Grafana memory request' => ['requests: {cpu: 100m, memory: 256Mi}', 'requests: {cpu: 100m, memory: 128Mi}'],
  'wrong Grafana memory limit' => ['limits: {cpu: 500m, memory: 512Mi}', 'limits: {cpu: 500m, memory: 256Mi}'],
  'Grafana anonymous access enabled' => ["[auth.anonymous]\n    enabled = false", "[auth.anonymous]\n    enabled = true"],
  'Grafana insecure session cookie' => ['cookie_secure = true', 'cookie_secure = false'],
  'missing Grafana datasource provisioning' => ['  datasources.yaml: |', '  datasources-missing.yaml: |'],
  'wrong Grafana datasource URL' => ['http://prometheus-operated.observability.svc.cluster.local:9090', 'http://wrong-prometheus'],
  'missing Grafana datasource' => ['      - name: Loki', '      - name: Missing'],
  'wrong Grafana Alertmanager datasource URL' => ['http://learning-platform-monitori-alertmanager.observability.svc.cluster.local:9093', 'http://wrong-alertmanager'],
  'missing Grafana Alertmanager jsonData' => ["        jsonData:\n          implementation: prometheus\n          handleGrafanaManagedAlerts: false\n", ''],
  'wrong Grafana Alertmanager implementation' => ['implementation: prometheus', 'implementation: mimir'],
  'enabled Grafana managed alerts' => ['handleGrafanaManagedAlerts: false', 'handleGrafanaManagedAlerts: true'],
  'duplicate Grafana Alertmanager datasource' => ["        editable: false\n  dashboardproviders.yaml:", "        editable: false\n      - name: Alertmanager\n        type: alertmanager\n        access: proxy\n        url: http://learning-platform-monitori-alertmanager.observability.svc.cluster.local:9093\n        editable: false\n  dashboardproviders.yaml:"],
  'Grafana Alertmanager basic auth' => ["        editable: false\n  dashboardproviders.yaml:", "        editable: false\n        basicAuth: true\n  dashboardproviders.yaml:"],
  'Grafana Alertmanager credential' => ["        editable: false\n  dashboardproviders.yaml:", "        editable: false\n        secureJsonData: {password: forbidden}\n  dashboardproviders.yaml:"],
  'wrong Grafana dashboard provider path' => ['/var/lib/grafana/dashboards/nodes', '/var/lib/grafana/dashboards/wrong'],
  'wrong Grafana dashboard ConfigMap' => ['name: learning-platform-monitori-nodes', 'name: wrong-dashboard-config-map'],
  'wrong Grafana dashboard volume name' => ['name: dashboards-nodes', 'name: wrong-dashboard-volume'],
  'wrong Grafana dashboard mount' => ['mountPath: /var/lib/grafana/dashboards/nodes', 'mountPath: /var/lib/grafana/dashboards/wrong'],
  'second Grafana Ingress' => ["---\napiVersion: networking.k8s.io/v1", "---\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: {name: second-grafana, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-monitoring, app.kubernetes.io/name: grafana}}\nspec: {rules: [{host: grafana.sirobabycloud.io.vn, http: {paths: [{path: /, pathType: Prefix, backend: {service: {name: learning-platform-monitoring-grafana, port: {number: 80}}}}]}}]}\n---\napiVersion: networking.k8s.io/v1"],
  'wrong Grafana Ingress port' => ['port: {number: 80}', 'port: {number: 443}'],
  'Grafana Ingress TLS' => ["spec:\n  rules:", "spec:\n  tls: [{hosts: [grafana.sirobabycloud.io.vn]}]\n  rules:"],
  'resources missing' => ['requests: {cpu: 50m, memory: 64Mi}', 'requests: {}'],
  'missing Prometheus reloader accounting' => ['--config-reloader-memory-limit=64Mi', '--config-reloader-memory-limit=32Mi'],
  'resource overflow' => ['cpu: 250m, memory: 256Mi', 'cpu: "3", memory: 256Mi'],
  'wrong PVC' => ['storage: 2Gi', 'storage: 9Gi'],
  'duplicate allowed size PVC' => ["---\napiVersion: apps/v1", "---\napiVersion: v1\nkind: PersistentVolumeClaim\nmetadata: {name: duplicate, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-loki}}\nspec: {storageClassName: local-path, resources: {requests: {storage: 2Gi}}}\n---\napiVersion: apps/v1"],
  'Delete PVC policy' => ['whenDeleted: Retain', 'whenDeleted: Delete'],
  'missing PVC policy' => ['whenScaled: Retain', 'whenScaled:'],
  'Alertmanager replica count' => ['replicas: 1', 'replicas: 2'],
  'Alertmanager configuration Secret' => ['configSecret: alertmanager-telegram-config', 'configSecret: literal-alertmanager-config'],
  'Alertmanager memory request' => ['requests: {cpu: 50m, memory: 64Mi}', 'requests: {cpu: 50m, memory: 32Mi}'],
  'Prometheus Alertmanager target' => ['name: learning-platform-monitori-alertmanager', 'name: wrong-alertmanager'],
  'MinIO rendered' => ["---\napiVersion: apps/v1", "---\napiVersion: v1\nkind: Service\nmetadata: {name: learning-platform-minio, namespace: observability, labels: {app.kubernetes.io/instance: learning-platform-loki}}\nspec: {type: ClusterIP}\n---\napiVersion: apps/v1"],
  'duplicate KSM' => ['learning-platform-monitoring-kube-state-metrics', 'learning-platform-monitoring-kube-state-metrics\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata: {name: duplicate-kube-state-metrics, namespace: observability}\nspec: {template: {spec: {containers: [{name: ksm, resources: {requests: {cpu: 1m, memory: 1Mi}, limits: {cpu: 1m, memory: 1Mi}}}]}}}\n#'],
  'high-cardinality Alloy labels' => ['stage.label_keep', '__meta_kubernetes_pod_uid\n    stage.label_keep'],
  'forbidden RBAC' => ['resources: [pods, pods/log]', 'resources: [secrets]'],
  'privileged Alloy' => ['privileged: false', 'privileged: true'],
  'hostPath Alloy' => ['hostPID: false', 'hostPID: false\n      volumes: [{name: host, hostPath: {path: /}}]'],
  'missing Alloy storage volume' => ["      volumes:\n        - name: alloy-storage\n          emptyDir:\n            sizeLimit: 128Mi\n", "      volumes: []\n"],
  'unbounded Alloy storage volume' => ["            sizeLimit: 128Mi\n", ''],
  'wrong Alloy storage mount' => ['mountPath: /tmp/alloy', 'mountPath: /tmp/wrong'],
  'Alloy storage volume mounted by reloader' => ["        - name: config-reloader\n          securityContext:", "        - name: config-reloader\n          volumeMounts: [{name: alloy-storage, mountPath: /tmp/alloy}]\n          securityContext:"],
  'missing Alloy storage path argument' => ['--storage.path=/tmp/alloy', '--storage.path=/tmp/wrong'],
  'wrong Alloy UID' => ['runAsUser: 473', 'runAsUser: 1000'],
  'missing config-reloader UID' => ['runAsUser: 65534, runAsGroup: 65534', 'runAsGroup: 65534'],
  'wrong config-reloader GID' => ['runAsUser: 65534, runAsGroup: 65534', 'runAsUser: 65534, runAsGroup: 1000'],
  'unexpected long-running container' => ['- name: grafana', "- name: unexpected\n          resources: {requests: {cpu: 0m, memory: 0Mi}, limits: {cpu: 0m, memory: 0Mi}}\n        - name: grafana"],
  'operator admission TLS secret volume' => ['      volumes: []', "      volumes:\n        - name: tls-secret\n          secret: {secretName: learning-platform-monitori-admission}"],
  'operator TLS certificate mount' => ['          volumeMounts: []', "          volumeMounts:\n            - name: tls-secret\n              mountPath: /cert\n              readOnly: true"],
  'plaintext rendered Secret' => ["---\napiVersion: monitoring.coreos.com/v1", "---\napiVersion: v1\nkind: Secret\nmetadata: {name: plaintext, namespace: observability}\nstringData: {password: plaintext}\n---\napiVersion: monitoring.coreos.com/v1"],
  'Loki auth enabled' => ['auth_enabled: false', 'auth_enabled: true'],
  'Loki auth missing' => ["    auth_enabled: false\n", ''],
  'Loki auth non-boolean' => ['auth_enabled: false', "auth_enabled: 'false'"],
  'Loki config malformed' => ['auth_enabled: false', 'auth_enabled: [']
}.freeze

failures = []
Dir.mktmpdir('rendered-observability-policy') do |directory|
  output, status = Open3.capture2e('ruby', validator, '--input', fixture, '--junit', File.join(directory, 'valid.xml'))
  failures << "valid fixture: #{output}" unless status.success?
  cases.each do |label, (from, to)|
    content = File.read(fixture).sub(from, to)
    abort "ERROR: fixture mutation did not change raw document: #{label}" if content == File.read(fixture)
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
