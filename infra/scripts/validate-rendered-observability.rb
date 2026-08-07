#!/usr/bin/env ruby
# frozen_string_literal: true

# Offline semantic policy validator for already-rendered observability manifests.
# Ruby's bundled Psych YAML parser is required; this script never downloads or installs anything.
begin
  require 'yaml'
  require 'rexml/document'
rescue LoadError => error
  warn "ERROR: required Ruby parser is unavailable: #{error.message}"
  exit 2
end

require 'optparse'

EXPECTED_NAMESPACE = 'observability'
EXPECTED_REQUESTS = { 'cpu' => 835, 'memory' => 1458 }.freeze
EXPECTED_LIMITS = { 'cpu' => 3050, 'memory' => 2880 }.freeze
LONG_RUNNING_KINDS = %w[DaemonSet Deployment StatefulSet].freeze
CLUSTER_SCOPED_KINDS = %w[ClusterRole ClusterRoleBinding CustomResourceDefinition].freeze
EXPECTED_WORKLOAD_CONTAINERS = {
  'kube-prometheus-stack-prometheus-operator' => %w[kube-prometheus-stack],
  'kube-state-metrics' => %w[kube-state-metrics],
  'prometheus-node-exporter' => %w[node-exporter],
  'grafana' => %w[grafana],
  'loki' => %w[loki],
  'alloy' => %w[alloy config-reloader]
}.freeze
RELOADER_ARGS = {
  '--config-reloader-cpu-request=' => '25m',
  '--config-reloader-memory-request=' => '32Mi',
  '--config-reloader-cpu-limit=' => '100m',
  '--config-reloader-memory-limit=' => '64Mi'
}.freeze
FORBIDDEN_OPERATOR_ADMISSION_SECRET = 'learning-platform-monitori-admission'
FORBIDDEN_OPERATOR_TLS_MOUNT_PATHS = %w[/cert /tls].freeze
ALLOY_STORAGE_VOLUME = 'alloy-storage'
ALLOY_STORAGE_PATH = '/tmp/alloy'
ALLOY_STORAGE_SIZE_LIMIT = '128Mi'
ALLOY_USER_ID = 473
RELOADER_USER_ID = 65_534
GRAFANA_CONFIG_MAP = 'learning-platform-monitoring-grafana'
GRAFANA_PUBLIC_HOST = 'grafana.sirobabycloud.io.vn'
GRAFANA_PUBLIC_URL = "https://#{GRAFANA_PUBLIC_HOST}/"
GRAFANA_RESOURCES = {
  'requests' => { 'cpu' => '100m', 'memory' => '256Mi' },
  'limits' => { 'cpu' => '500m', 'memory' => '512Mi' }
}.freeze
GRAFANA_DISABLED_FEATURE = 'kubernetesLogsDrilldown'
GRAFANA_STATIC_FILES = %w[grafana.ini datasources.yaml dashboardproviders.yaml].freeze
GRAFANA_DASHBOARDS = {
  'k8s-resources-cluster' => 'learning-platform-monitori-k8s-resources-cluster',
  'k8s-resources-node' => 'learning-platform-monitori-k8s-resources-node',
  'k8s-resources-namespace' => 'learning-platform-monitori-k8s-resources-namespace',
  'nodes' => 'learning-platform-monitori-nodes'
}.freeze
GRAFANA_DASHBOARD_VOLUMES = GRAFANA_DASHBOARDS.each_with_object({}) do |(provider, config_map), result|
  result["dashboards-#{provider}"] = config_map
end.freeze
GRAFANA_DATASOURCES = {
  'Prometheus' => {
    'type' => 'prometheus',
    'url' => 'http://prometheus-operated.observability.svc.cluster.local:9090',
    'isDefault' => true
  },
  'Loki' => {
    'type' => 'loki',
    'url' => 'http://learning-platform-loki.observability.svc.cluster.local:3100'
  },
  'Alertmanager' => {
    'type' => 'alertmanager',
    'url' => 'http://learning-platform-monitori-alertmanager.observability.svc.cluster.local:9093',
    'jsonData' => {
      'implementation' => 'prometheus',
      'handleGrafanaManagedAlerts' => false
    }
  }
}.freeze
ALERTMANAGER_FORBIDDEN_DATASOURCE_FIELDS = %w[
  accessToken
  authType
  basicAuth
  basicAuthPassword
  basicAuthUser
  password
  secureJsonData
  secret
  tlsAuth
  tlsAuthWithCACert
  tlsCACert
  tlsClientCert
  tlsClientKey
  token
  user
  username
  withCredentials
].freeze
ALERTMANAGER_NAME = 'learning-platform-monitori-alertmanager'
ALERTMANAGER_CONFIG_SECRET = 'alertmanager-telegram-config'
ALERTMANAGER_RESOURCES = {
  'requests' => { 'cpu' => '50m', 'memory' => '64Mi' },
  'limits' => { 'cpu' => '100m', 'memory' => '128Mi' }
}.freeze

options = { inputs: [], junit: nil }
OptionParser.new do |parser|
  parser.banner = 'Usage: validate-rendered-observability.rb --input RENDERED.yml [--input ...] [--junit RESULT.xml]'
  parser.on('--input PATH', 'Pre-rendered YAML; repeat for each release') { |path| options[:inputs] << path }
  parser.on('--junit PATH', 'Write deterministic JUnit XML evidence') { |path| options[:junit] = path }
end.parse!

abort 'ERROR: at least one --input rendered YAML file is required.' if options[:inputs].empty?

class Policy
  attr_reader :failures

  def initialize
    @failures = []
    @documents = []
    @resource_totals = { requests: Hash.new(0), limits: Hash.new(0) }
    @claims = []
  end

  def load(paths)
    paths.each do |path|
      abort "ERROR: rendered YAML does not exist: #{path}" unless File.file?(path)
      content = File.read(path)
      abort "ERROR: rendered YAML must not use Ruby object tags: #{path}" if content.match?(/!ruby\/(object|class|module)/)
      YAML.load_stream(content).compact.each do |document|
        fail_check('YAML document must be a mapping') unless document.is_a?(Hash)
        @documents << document if document.is_a?(Hash)
      end
    rescue Psych::Exception => error
      abort "ERROR: cannot parse rendered YAML #{path}: #{error.message}"
    end
  end

  def validate
    fail_check('render must contain Kubernetes resources') if @documents.empty?
    @documents.each { |document| validate_document(document) }
    validate_required_resources
    validate_metadata
    validate_aggregate_resources
    self
  end

  private

  def fail_check(message)
    @failures << message
  end

  def value(object, *keys)
    keys.reduce(object) { |current, key| current.is_a?(Hash) ? current[key] : nil }
  end

  def metadata(document)
    value(document, 'metadata') || {}
  end

  def name(document)
    metadata(document)['name'].to_s
  end

  def kind(document)
    document['kind'].to_s
  end

  def namespace(document)
    metadata(document)['namespace']
  end

  def label(document, key)
    value(document, 'metadata', 'labels', key)
  end

  def validate_document(document)
    fail_check("#{kind(document)}/#{name(document)} has no apiVersion") if document['apiVersion'].to_s.empty?
    validate_namespace(document)
    validate_service(document) if kind(document) == 'Service'
    validate_ingress(document) if kind(document) == 'Ingress'
    validate_secret(document) if kind(document) == 'Secret'
    validate_persistence(document)
    validate_alertmanager(document)
    validate_long_running_resources(document)
    validate_disabled_components(document)
    validate_alloy(document)
    validate_grafana_root_url(document)
  end

  def validate_grafana_root_url(document)
    return unless kind(document) == 'ConfigMap' && name(document) == GRAFANA_CONFIG_MAP
    content = (document['data'] || {}).values.join("\n")
    unless content.include?("root_url = #{GRAFANA_PUBLIC_URL}") &&
           content.include?("domain = #{GRAFANA_PUBLIC_HOST}") &&
           content.include?('enforce_domain = true') &&
           content.include?('[auth.anonymous]') &&
           content.include?('enabled = false') &&
           content.include?('[feature_toggles]') &&
           content.include?("#{GRAFANA_DISABLED_FEATURE} = false") &&
           content.include?('[security]') &&
           content.include?('cookie_secure = true') &&
           content.include?('cookie_samesite = lax')
      fail_check("Grafana ConfigMap/#{name(document)} must enforce #{GRAFANA_PUBLIC_URL}")
    end
  end

  def validate_grafana_provisioning
    config_maps = @documents.select { |document| kind(document) == 'ConfigMap' && name(document) == GRAFANA_CONFIG_MAP }
    unless config_maps.length == 1
      fail_check("render must contain exactly one Grafana ConfigMap/#{GRAFANA_CONFIG_MAP}, got #{config_maps.length}")
      return
    end

    data = config_maps.first['data'] || {}
    missing = GRAFANA_STATIC_FILES - data.keys
    fail_check("Grafana ConfigMap/#{GRAFANA_CONFIG_MAP} must contain static #{GRAFANA_STATIC_FILES.join(', ')}") unless missing.empty?
    return unless missing.empty?

    datasources = YAML.safe_load(data['datasources.yaml'], permitted_classes: [], permitted_symbols: [], aliases: false)
    configured_datasources = (datasources || {}).fetch('datasources', [])
    actual_datasources = configured_datasources.each_with_object({}) { |datasource, result| result[datasource['name']] = datasource }
    alertmanager_datasources = configured_datasources.select { |datasource| datasource.is_a?(Hash) && datasource['name'] == 'Alertmanager' }
    unless alertmanager_datasources.length == 1
      fail_check("Grafana datasources.yaml must define exactly one Alertmanager datasource, got #{alertmanager_datasources.length}")
    end

    if alertmanager_datasources.length == 1
      alertmanager_datasource = alertmanager_datasources.first
      forbidden_fields = alertmanager_datasource.keys & ALERTMANAGER_FORBIDDEN_DATASOURCE_FIELDS
      unless forbidden_fields.empty?
        fail_check("Grafana Alertmanager datasource must not define credential or auth fields: #{forbidden_fields.sort.join(', ')}")
      end
      unless alertmanager_datasource['jsonData'] == GRAFANA_DATASOURCES['Alertmanager']['jsonData']
        fail_check('Grafana Alertmanager datasource jsonData must set implementation=prometheus and handleGrafanaManagedAlerts=false exactly')
      end
    end

    valid_datasources = actual_datasources.length == GRAFANA_DATASOURCES.length && actual_datasources.keys.sort == GRAFANA_DATASOURCES.keys.sort && GRAFANA_DATASOURCES.all? do |name, expected|
      datasource = actual_datasources[name] || {}
      expected.all? { |key, value| datasource[key] == value } && datasource['access'] == 'proxy' && datasource['editable'] == false
    end
    fail_check('Grafana datasources.yaml must define exactly Prometheus, Loki, and Alertmanager with their static proxy contracts') unless valid_datasources

    providers = YAML.safe_load(data['dashboardproviders.yaml'], permitted_classes: [], permitted_symbols: [], aliases: false)
    actual = (providers || {}).fetch('providers', []).each_with_object({}) { |provider, result| result[provider['name']] = value(provider, 'options', 'path') }
    expected = GRAFANA_DASHBOARDS.transform_keys(&:to_s).transform_values { |name| "/var/lib/grafana/dashboards/#{name.sub('learning-platform-monitori-', '')}" }
    fail_check('Grafana dashboardproviders.yaml must define exactly the four static provider paths') unless actual == expected
  rescue Psych::Exception, KeyError, NoMethodError
    fail_check('Grafana ConfigMap static provisioning files must be valid YAML')
  end

  def validate_grafana_dashboard_mounts
    statefulsets = @documents.select { |document| kind(document) == 'StatefulSet' && name(document) == GRAFANA_CONFIG_MAP }
    unless statefulsets.length == 1
      fail_check("render must contain exactly one Grafana StatefulSet/#{GRAFANA_CONFIG_MAP}, got #{statefulsets.length}")
      return
    end

    pod_spec = pod_spec_for(statefulsets.first)
    volumes = (pod_spec['volumes'] || []).each_with_object({}) { |volume, result| result[volume['name']] = value(volume, 'configMap', 'name') }
    expected_volumes = GRAFANA_DASHBOARD_VOLUMES
    dashboard_volumes = volumes.slice(*expected_volumes.keys)
    fail_check('Grafana StatefulSet must define exactly four dashboard ConfigMap volumes') unless dashboard_volumes == expected_volumes

    grafana = containers_for(statefulsets.first).find { |container| container['name'] == 'grafana' } || {}
    fail_check('Grafana StatefulSet must use the approved CPU and memory resources') unless grafana['resources'] == GRAFANA_RESOURCES
    mounts = (grafana['volumeMounts'] || []).each_with_object({}) { |mount, result| result[mount['name']] = mount['mountPath'] }
    expected_mounts = GRAFANA_DASHBOARDS.each_with_object({}) { |(provider, _config_map), result| result["dashboards-#{provider}"] = "/var/lib/grafana/dashboards/#{provider}" }
    dashboard_mounts = mounts.slice(*expected_mounts.keys)
    fail_check('Grafana StatefulSet must mount exactly the four dashboard ConfigMaps at their provider paths') unless dashboard_mounts == expected_mounts
  end

  def validate_loki_auth
    loki_config_maps = @documents.select do |document|
      kind(document) == 'ConfigMap' &&
        name(document) == 'loki' &&
        label(document, 'app.kubernetes.io/instance') == 'learning-platform-loki'
    end
    unless loki_config_maps.length == 1
      fail_check("render must contain exactly one Loki ConfigMap/loki for release learning-platform-loki, got #{loki_config_maps.length}")
      return
    end

    config_yaml = value(loki_config_maps.first, 'data', 'config.yaml')
    unless config_yaml.is_a?(String)
      fail_check('Loki ConfigMap/loki must contain data.config.yaml')
      return
    end

    config = YAML.safe_load(config_yaml, permitted_classes: [], permitted_symbols: [], aliases: false)
    unless config.is_a?(Hash)
      fail_check('Loki ConfigMap/loki data.config.yaml must be a YAML mapping')
      return
    end
    fail_check('Loki ConfigMap/loki data.config.yaml must set top-level auth_enabled to boolean false') unless config['auth_enabled'] == false
  rescue Psych::Exception => error
    fail_check("Loki ConfigMap/loki data.config.yaml must be valid YAML: #{error.message}")
  end

  def validate_namespace(document)
    return if CLUSTER_SCOPED_KINDS.include?(kind(document))
    return if %w[Service ServiceMonitor].include?(kind(document)) && namespace(document) == 'kube-system' && label(document, 'app.kubernetes.io/instance') == 'learning-platform-monitoring'
    fail_check("#{kind(document)}/#{name(document)} must use namespace #{EXPECTED_NAMESPACE}") unless namespace(document) == EXPECTED_NAMESPACE
  end

  def validate_service(document)
    service_type = value(document, 'spec', 'type') || 'ClusterIP'
    fail_check("Service/#{name(document)} must be ClusterIP, got #{service_type}") unless service_type == 'ClusterIP'
  end

  def validate_ingress(document)
    rules = value(document, 'spec', 'rules') || []
    grafana_rule = rules.first || {}
    paths = value(grafana_rule, 'http', 'paths') || []
    root = paths.first || {}
    backend = value(root || {}, 'backend', 'service', 'name').to_s
    port = value(root, 'backend', 'service', 'port', 'number')
    exact = name(document) == 'learning-platform-monitoring-grafana' && rules.length == 1 && grafana_rule['host'] == GRAFANA_PUBLIC_HOST && paths.length == 1 && root['path'] == '/' && root['pathType'] == 'Prefix' && backend == 'learning-platform-monitoring-grafana' && port == 80 && (value(document, 'spec', 'tls') || []).empty? && (value(document, 'spec', 'ingressClassName').nil? || value(document, 'spec', 'ingressClassName') == 'traefik')
    fail_check('Grafana Ingress must be the exact public Traefik root route without TLS') unless exact
  end

  def validate_secret(document)
    return if (document['data'] || {}).empty? && (document['stringData'] || {}).empty?
    fail_check("Secret/#{name(document)} contains plaintext or materialized secret data")
  end

  def retention_policy(spec, label)
    policy = spec['persistentVolumeClaimRetentionPolicy'] || {}
    fail_check("#{label} must retain PVCs when deleted") unless policy['whenDeleted'] == 'Retain'
    fail_check("#{label} must retain PVCs when scaled") unless policy['whenScaled'] == 'Retain'
  end

  def validate_persistence(document)
    spec = document['spec'] || {}
    if kind(document) == 'PersistentVolumeClaim'
      validate_claim(spec, "PVC/#{name(document)}")
    elsif kind(document) == 'StatefulSet'
      retention_policy(spec, "StatefulSet/#{name(document)}")
      (spec['volumeClaimTemplates'] || []).each { |claim| validate_claim(claim['spec'] || {}, "StatefulSet/#{name(document)} claim") }
    elsif kind(document) == 'Prometheus'
      retention_policy(spec, "Prometheus/#{name(document)}")
      storage = value(spec, 'storage', 'volumeClaimTemplate', 'spec') || {}
      validate_claim(storage, "Prometheus/#{name(document)}")
      fail_check("Prometheus/#{name(document)} retention must be 7d") unless spec['retention'] == '7d'
      fail_check("Prometheus/#{name(document)} retentionSize must be 2500MB") unless spec['retentionSize'] == '2500MB'
      alertmanagers = value(spec, 'alerting', 'alertmanagers')
      expected_alertmanager = [{
        'namespace' => EXPECTED_NAMESPACE,
        'name' => ALERTMANAGER_NAME,
        'port' => 'http-web',
        'pathPrefix' => '/',
        'apiVersion' => 'v2'
      }]
      fail_check("Prometheus/#{name(document)} must target the enabled Alertmanager") unless alertmanagers == expected_alertmanager
    end
  end

  def validate_alertmanager(document)
    return unless kind(document) == 'Alertmanager'
    spec = document['spec'] || {}
    fail_check("Alertmanager/#{name(document)} must be the single configured instance") unless name(document) == ALERTMANAGER_NAME
    fail_check("Alertmanager/#{name(document)} must run one replica") unless spec['replicas'] == 1
    fail_check("Alertmanager/#{name(document)} must use Secret/#{ALERTMANAGER_CONFIG_SECRET}") unless spec['configSecret'] == ALERTMANAGER_CONFIG_SECRET
    fail_check("Alertmanager/#{name(document)} must use approved CPU and memory resources") unless spec['resources'] == ALERTMANAGER_RESOURCES
    fail_check("Alertmanager/#{name(document)} must not create persistent storage") unless (spec['storage'] || {}).empty?
    add_resources(spec['resources']['requests'], :requests, "Alertmanager/#{name(document)}")
    add_resources(spec['resources']['limits'], :limits, "Alertmanager/#{name(document)}")
  end

  def validate_claim(spec, label)
    fail_check("#{label} must use local-path") unless spec['storageClassName'] == 'local-path'
    size = value(spec, 'resources', 'requests', 'storage')
    fail_check("#{label} must declare a 1Gi, 2Gi, or 3Gi storage request") unless %w[1Gi 2Gi 3Gi].include?(size)
    @claims << [label_for_claim(label), size] if %w[1Gi 2Gi 3Gi].include?(size)
  end

  def label_for_claim(text)
    return 'prometheus' if text.start_with?('Prometheus/')
    return 'grafana' if text.include?('grafana')
    return 'loki' if text.include?('loki')
    text
  end

  def containers_for(document)
    spec = document['spec'] || {}
    return [] unless LONG_RUNNING_KINDS.include?(kind(document))
    value(spec, 'template', 'spec', 'containers') || []
  end

  def pod_spec_for(document)
    return {} unless LONG_RUNNING_KINDS.include?(kind(document))
    value(document, 'spec', 'template', 'spec') || {}
  end

  def validate_long_running_resources(document)
    if kind(document) == 'Prometheus'
      resources = document['spec']['resources'] || {}
      add_resources(resources['requests'] || {}, :requests, "Prometheus/#{name(document)}")
      add_resources(resources['limits'] || {}, :limits, "Prometheus/#{name(document)}")
      return
    end
    workload_component = label(document, 'app.kubernetes.io/name')
    return unless LONG_RUNNING_KINDS.include?(kind(document))
    expected_containers = EXPECTED_WORKLOAD_CONTAINERS[workload_component]
    fail_check("unexpected long-running workload #{kind(document)}/#{name(document)}") unless expected_containers
    actual_names = containers_for(document).map { |container| container['name'] }
    fail_check("#{kind(document)}/#{name(document)} has unexpected containers") unless expected_containers && actual_names.sort == expected_containers.sort
    containers_for(document).each do |container|
      resources = container['resources'] || {}
      request = resources['requests'] || {}
      limit = resources['limits'] || {}
      label = "#{kind(document)}/#{name(document)} container/#{container['name']}"
      fail_check("#{label} must declare cpu and memory requests") unless request['cpu'] && request['memory']
      fail_check("#{label} must declare cpu and memory limits") unless limit['cpu'] && limit['memory']
      add_resources(request, :requests, label) if request['cpu'] && request['memory']
      add_resources(limit, :limits, label) if limit['cpu'] && limit['memory']
    end

  end

  def cpu_millicores(raw)
    return raw.to_i if raw.to_s.end_with?('m')
    (Float(raw) * 1000).to_i
  rescue ArgumentError
    nil
  end

  def memory_mebibytes(raw)
    match = /\A([0-9]+)(Ki|Mi|Gi)\z/.match(raw.to_s)
    return nil unless match
    amount = match[1].to_i
    { 'Ki' => amount / 1024, 'Mi' => amount, 'Gi' => amount * 1024 }[match[2]]
  end

  def add_resources(resources, category, label)
    cpu = cpu_millicores(resources['cpu'])
    memory = memory_mebibytes(resources['memory'])
    fail_check("#{label} has unsupported resource quantity") and return unless cpu && memory
    @resource_totals[category]['cpu'] += cpu
    @resource_totals[category]['memory'] += memory
  end

  def validate_disabled_components(document)
    return unless %w[Deployment StatefulSet DaemonSet Service PersistentVolumeClaim].include?(kind(document))
    fail_check("disabled component workload rendered: #{kind(document)}/#{name(document)}") if name(document).match?(/minio/i)
  end

  def validate_alloy(document)
    return unless name(document).include?('alloy')
    pod_spec = value(document, 'spec', 'template', 'spec') || {}
    fail_check("Alloy/#{name(document)} must not use hostNetwork or hostPID") if pod_spec['hostNetwork'] || pod_spec['hostPID']
    fail_check("Alloy/#{name(document)} must not mount hostPath") if (pod_spec['volumes'] || []).any? { |volume| volume.key?('hostPath') }
    containers_for(document).each do |container|
      context = container['securityContext'] || {}
      fail_check("Alloy/#{name(document)} container/#{container['name']} must be non-privileged") if context['privileged'] || context['allowPrivilegeEscalation'] != false
    end
    validate_alloy_runtime(document) if kind(document) == 'DaemonSet'
    if kind(document) == 'ClusterRole'
      (value(document, 'rules') || []).each do |rule|
        resources = rule['resources'] || []
        verbs = rule['verbs'] || []
        unless (resources - %w[pods pods/log]).empty? && (verbs - %w[get list watch]).empty?
          fail_check("Alloy ClusterRole/#{name(document)} exceeds pods and pods/log read-only RBAC")
        end
      end
    end
    return unless kind(document) == 'ConfigMap'
    content = (document['data'] || {}).values.join("\n")
    if content.include?('__meta_kubernetes_pod_uid') || content.include?('__meta_kubernetes_pod_name') || content.include?('__meta_kubernetes_pod_label_') && !content.include?('stage.label_keep')
      fail_check("Alloy ConfigMap/#{name(document)} permits high-cardinality labels")
    end
    required_labels = '"cluster", "namespace", "app", "container", "stream"'
    fail_check("Alloy ConfigMap/#{name(document)} must keep only canonical labels") unless content.include?(required_labels)
  end

  def validate_alloy_runtime(document)
    pod_spec = pod_spec_for(document)
    containers = containers_for(document)
    alloy = containers.find { |container| container['name'] == 'alloy' } || {}
    reloader = containers.find { |container| container['name'] == 'config-reloader' } || {}
    validate_alloy_storage(document, pod_spec, alloy, containers)
    validate_alloy_security_context(document, alloy, reloader)
  end

  def validate_alloy_storage(document, pod_spec, alloy, containers)
    storage_args = (alloy['args'] || []).select { |argument| argument == "--storage.path=#{ALLOY_STORAGE_PATH}" }
    fail_check("Alloy/#{name(document)} must contain exactly --storage.path=#{ALLOY_STORAGE_PATH}") unless storage_args.length == 1

    volumes = pod_spec['volumes'] || []
    storage_volumes = volumes.select { |volume| volume['name'] == ALLOY_STORAGE_VOLUME }
    expected_volume = { 'sizeLimit' => ALLOY_STORAGE_SIZE_LIMIT }
    fail_check("Alloy/#{name(document)} must define one bounded emptyDir #{ALLOY_STORAGE_VOLUME}") unless storage_volumes.length == 1 && storage_volumes.first['emptyDir'] == expected_volume

    containers.each do |container|
      mounts = (container['volumeMounts'] || []).select { |mount| mount['name'] == ALLOY_STORAGE_VOLUME }
      if container['name'] == 'alloy'
        expected_mount = mounts.length == 1 && mounts.first['mountPath'] == ALLOY_STORAGE_PATH && mounts.first['readOnly'] != true
        fail_check("Alloy/#{name(document)} must mount writable #{ALLOY_STORAGE_VOLUME} only at #{ALLOY_STORAGE_PATH}") unless expected_mount
      elsif mounts.any?
        fail_check("Alloy/#{name(document)} #{ALLOY_STORAGE_VOLUME} must only mount in the alloy container")
      end
    end
  end

  def validate_alloy_security_context(document, alloy, reloader)
    alloy_context = alloy['securityContext'] || {}
    unless alloy_context['readOnlyRootFilesystem'] == true && alloy_context['runAsNonRoot'] == true && alloy_context['runAsUser'] == ALLOY_USER_ID
      fail_check("Alloy/#{name(document)} container/alloy must keep readOnlyRootFilesystem, runAsNonRoot, and runAsUser #{ALLOY_USER_ID}")
    end

    reloader_context = reloader['securityContext'] || {}
    unless reloader_context['readOnlyRootFilesystem'] == true && reloader_context['runAsNonRoot'] == true && reloader_context['runAsUser'] == RELOADER_USER_ID && reloader_context['runAsGroup'] == RELOADER_USER_ID
      fail_check("Alloy/#{name(document)} container/config-reloader must keep readOnlyRootFilesystem, runAsNonRoot, runAsUser, and runAsGroup #{RELOADER_USER_ID}")
    end
  end

  def validate_required_resources
    required = { 'Prometheus' => 1, 'Alertmanager' => 1, 'Ingress' => 1 }
    required.each do |resource_kind, count|
      actual = @documents.count { |document| kind(document) == resource_kind }
      fail_check("render must contain exactly #{count} #{resource_kind} resource(s), got #{actual}") unless actual == count
    end
    kube_state_metrics = @documents.count { |document| name(document).include?('kube-state-metrics') && LONG_RUNNING_KINDS.include?(kind(document)) }
    fail_check("render must contain exactly one kube-state-metrics workload, got #{kube_state_metrics}") unless kube_state_metrics == 1
    fail_check("persistent storage owners/sizes must be prometheus=3Gi, grafana=1Gi, loki=2Gi; got #{@claims.sort.inspect}") unless @claims.sort == [['grafana', '1Gi'], ['loki', '2Gi'], ['prometheus', '3Gi']]
    validate_operator_reloader
    validate_loki_auth
    validate_grafana_provisioning
    validate_grafana_dashboard_mounts
  end

  def validate_operator_reloader
    operators = @documents.select { |document| kind(document) == 'Deployment' && label(document, 'app.kubernetes.io/name') == 'kube-prometheus-stack-prometheus-operator' }
    fail_check("render must contain exactly one Prometheus Operator Deployment, got #{operators.length}") unless operators.length == 1
    return unless operators.length == 1
    operator = operators.first
    container = containers_for(operator).first || {}
    args = container['args'] || []
    RELOADER_ARGS.each do |prefix, expected|
      matches = args.select { |argument| argument.start_with?(prefix) }
      fail_check("Prometheus Operator must contain exactly #{prefix}#{expected}") unless matches == ["#{prefix}#{expected}"]
    end
    pod_spec = pod_spec_for(operator)
    secret_volumes = (pod_spec['volumes'] || []).select do |volume|
      value(volume, 'secret', 'secretName') == FORBIDDEN_OPERATOR_ADMISSION_SECRET
    end
    fail_check("Prometheus Operator must not depend on Secret/#{FORBIDDEN_OPERATOR_ADMISSION_SECRET} when admission webhooks are disabled") unless secret_volumes.empty?

    volume_mounts = container['volumeMounts'] || []
    forbidden_mounts = volume_mounts.select do |mount|
      FORBIDDEN_OPERATOR_TLS_MOUNT_PATHS.include?(mount['mountPath']) || mount['name'].to_s.match?(/tls|cert/i)
    end
    fail_check('Prometheus Operator must not mount TLS certificate volumes when admission webhooks are disabled') unless forbidden_mounts.empty?

    tls_args = args.select { |argument| argument.include?('/cert/') || argument.include?('/tls/') }
    fail_check('Prometheus Operator must not reference TLS certificate paths when admission webhooks are disabled') unless tls_args.empty?
    add_resources({ 'cpu' => '25m', 'memory' => '32Mi' }, :requests, 'Prometheus config reloader')
    add_resources({ 'cpu' => '100m', 'memory' => '64Mi' }, :limits, 'Prometheus config reloader')
  end

  def validate_metadata
    expected_releases = %w[learning-platform-monitoring learning-platform-loki learning-platform-alloy]
    actual_releases = @documents.map { |document| label(document, 'app.kubernetes.io/instance') }.compact.uniq
    fail_check("render releases must be exactly #{expected_releases.join(', ')}") unless actual_releases.sort == expected_releases.sort
    observed_versions = @documents.map { |document| value(document, 'metadata', 'labels', 'app.kubernetes.io/version') }.compact
    fail_check('render lacks Loki app metadata version 3.7.4') unless observed_versions.include?('3.7.4')
    fail_check('render lacks Alloy app metadata version v1.18.0') unless observed_versions.include?('v1.18.0')
  end

  def validate_aggregate_resources
    EXPECTED_REQUESTS.each do |resource, expected|
      actual = @resource_totals[:requests][resource]
      fail_check("aggregate #{resource} requests must equal #{expected}, got #{actual}") unless actual == expected
    end
    EXPECTED_LIMITS.each do |resource, expected|
      actual = @resource_totals[:limits][resource]
      fail_check("aggregate #{resource} limits must equal #{expected}, got #{actual}") unless actual == expected
    end
  end
end

policy = Policy.new
policy.load(options[:inputs])
policy.validate

if options[:junit]
  escaped = policy.failures.map { |failure| REXML::Text.normalize(failure) }
  cases = escaped.empty? ? '<testcase name="rendered-observability-policy"/>' : escaped.map { |failure| "<testcase name=\"rendered-observability-policy\"><failure message=\"#{failure}\"/></testcase>" }.join
  File.write(options[:junit], "<?xml version=\"1.0\"?><testsuite name=\"rendered-observability-policy\" tests=\"#{[escaped.length, 1].max}\" failures=\"#{escaped.length}\">#{cases}</testsuite>\n")
end

if policy.failures.empty?
  puts 'PASS rendered-observability-policy'
  exit 0
end

policy.failures.each { |failure| warn "FAIL #{failure}" }
exit 1
