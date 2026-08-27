#!/usr/bin/env bash
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly INFRA_DIR
readonly ANSIBLE_DIR="${INFRA_DIR}/ansible"
readonly WORKSPACE_DIR="$(cd "${INFRA_DIR}/.." && pwd)"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

check_application_workloads_are_stateless() {
  if grep -RInE '^kind:[[:space:]]*(StatefulSet|PersistentVolumeClaim|Prometheus|Grafana)[[:space:]]*$' \
    "${INFRA_DIR}/ansible" "${INFRA_DIR}/k8s"; then
    fail 'Application manifests must remain stateless; StatefulSet, PVC, Prometheus, and Grafana are observability-only resources.'
  fi
}

require_observability_document_pattern() {
  local resource_kind="$1"
  local manifest_document="$2"
  local pattern="$3"
  local description="$4"

  if ! grep -qE "${pattern}" <<<"${manifest_document}"; then
    fail "Observability ${resource_kind} manifest must declare ${description}."
  fi
}

read_explicit_manifest_documents() {
  local manifest_file="$1"

  awk '
    function emit_document() {
      if (kind != "") {
        printf "%s%c", document, 0
      }
    }
    /^---[[:space:]]*($|#)/ {
      emit_document()
      document = ""
      kind = ""
      next
    }
    {
      document = document $0 ORS
      if ($0 ~ /^kind:[[:space:]]*/) {
        kind = $0
        sub(/^kind:[[:space:]]*/, "", kind)
        sub(/[[:space:]#].*$/, "", kind)
      }
    }
    END {
      emit_document()
    }
  ' "${manifest_file}"
}

check_observability_workloads() {
  local observability_dir="${INFRA_DIR}/observability"
  local manifest_file
  local manifest_document
  local resource_kind

  [ -d "${observability_dir}" ] || return

  while IFS= read -r -d '' manifest_file; do
    while IFS= read -r -d '' manifest_document; do
      resource_kind="$(awk '/^kind:[[:space:]]*/ { sub(/^kind:[[:space:]]*/, ""); sub(/[[:space:]#].*$/, ""); print; exit }' <<<"${manifest_document}")"

      case "${resource_kind}" in
        Service)
          if grep -qE '^[[:space:]]*type:[[:space:]]*LoadBalancer([[:space:]#].*)?$' <<<"${manifest_document}"; then
            fail 'Observability Service manifests must remain ClusterIP; public LoadBalancer is forbidden.'
          fi
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*type:[[:space:]]*ClusterIP([[:space:]#].*)?$' 'type: ClusterIP'
          ;;
        PersistentVolumeClaim)
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*storageClassName:[[:space:]]*local-path([[:space:]#].*)?$' 'storageClassName: local-path'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*storage:[[:space:]]*[1-9][0-9]*(Ki|Mi|Gi|Ti)([[:space:]#].*)?$' 'an explicit storage size'
          ;;
        StatefulSet)
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*storageClassName:[[:space:]]*local-path([[:space:]#].*)?$' 'storageClassName: local-path'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*storage:[[:space:]]*[1-9][0-9]*(Ki|Mi|Gi|Ti)([[:space:]#].*)?$' 'an explicit storage size'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*whenDeleted:[[:space:]]*Retain([[:space:]#].*)?$' 'whenDeleted: Retain'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*whenScaled:[[:space:]]*Retain([[:space:]#].*)?$' 'whenScaled: Retain'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*resources:[[:space:]]*$' 'container resources'
          ;;
        Prometheus)
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*storageClassName:[[:space:]]*local-path([[:space:]#].*)?$' 'storageClassName: local-path'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*storage:[[:space:]]*[1-9][0-9]*(Ki|Mi|Gi|Ti)([[:space:]#].*)?$' 'an explicit storage size'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*retention:[[:space:]]*[1-9][0-9]*[smhdwy]([[:space:]#].*)?$' 'a retention duration'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*retentionSize:[[:space:]]*[1-9][0-9]*(MB|MiB|GB|GiB|TB|TiB)([[:space:]#].*)?$' 'a retention size'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*whenDeleted:[[:space:]]*Retain([[:space:]#].*)?$' 'whenDeleted: Retain'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*whenScaled:[[:space:]]*Retain([[:space:]#].*)?$' 'whenScaled: Retain'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*resources:[[:space:]]*$' 'container resources'
          ;;
        Grafana)
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*storageClassName:[[:space:]]*local-path([[:space:]#].*)?$' 'storageClassName: local-path'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*storage:[[:space:]]*[1-9][0-9]*(Ki|Mi|Gi|Ti)([[:space:]#].*)?$' 'an explicit storage size'
          require_observability_document_pattern "${resource_kind}" "${manifest_document}" '^[[:space:]]*resources:[[:space:]]*$' 'container resources'
          ;;
      esac
    done < <(read_explicit_manifest_documents "${manifest_file}")
  done < <(find "${observability_dir}" -type f \( -name '*.yml' -o -name '*.yaml' -o -name '*.j2' \) -print0)
}

check_observability_release_policy_when_present() {
  local observability_role_dir="${ANSIBLE_DIR}/roles/observability"
  local observability_tasks="${observability_role_dir}/tasks/main.yml"
  local observability_release_tasks="${observability_role_dir}/tasks/release.yml"
  local observability_recovery_tasks="${observability_role_dir}/tasks/recovery-pending-install.yml"

  [ -f "${observability_tasks}" ] && [ -f "${observability_release_tasks}" ] && [ -f "${observability_recovery_tasks}" ] || return

  if grep -RInE --include='*.yml' --include='*.yaml' \
    '(helm[[:space:]_-]*(uninstall|delete)|resource_definition:.*PersistentVolumeClaim)' \
    --exclude='recovery-pending-install.yml' \
    "${observability_role_dir}/tasks" \
    || ! awk '
      /^- name:/ {
        if (task ~ /kind:[[:space:]]*(PersistentVolume|PersistentVolumeClaim)/ && task ~ /state:[[:space:]]*absent/) {
          forbidden = 1
        }
        task = $0 ORS
        next
      }
      { task = task $0 ORS }
      END {
        if (task ~ /kind:[[:space:]]*(PersistentVolume|PersistentVolumeClaim)/ && task ~ /state:[[:space:]]*absent/) {
          forbidden = 1
        }
        exit forbidden
      }
    ' "${observability_role_dir}"/tasks/*.yml; then
    fail 'Observability Ansible role must not uninstall releases or delete PVC/PV resources outside the reviewed recovery task.'
  fi

  if [ "$(grep -Fc '/usr/local/bin/helm uninstall learning-platform-monitoring --namespace observability' "${observability_recovery_tasks}")" -ne 1 ] \
    || ! grep -Fq -- '--kubeconfig {{ observability_kubeconfig }} --wait' "${observability_recovery_tasks}" \
    || ! grep -Fq -- '--timeout {{ observability_helm_timeout }} --cascade foreground' "${observability_recovery_tasks}" \
    || ! grep -Fq 'helm list --all --namespace observability' "${observability_recovery_tasks}" \
    || ! grep -Fq 'observability_recover_pending_install | bool' "${observability_tasks}" \
    || ! grep -Fq 'observability_pending_install_recovery_completed' "${observability_release_tasks}" \
    || ! grep -Fq 'observability_pending_install_recovery_absence_verified' "${observability_release_tasks}" \
    || ! grep -Fq 'Require Helm metadata and every source-owned resource absent after recovery uninstall' "${observability_recovery_tasks}" \
    || ! grep -Fq 'app.kubernetes.io/instance=learning-platform-monitoring' "${observability_recovery_tasks}" \
    || ! grep -Fq 'ClusterRole, namespaced: false' "${observability_recovery_tasks}" \
    || ! grep -Fq 'ClusterRoleBinding, namespaced: false' "${observability_recovery_tasks}" \
    || ! grep -Fq 'Secret, namespaced: true' "${observability_recovery_tasks}" \
    || ! grep -Fq 'ServiceMonitor, namespaced: true' "${observability_recovery_tasks}" \
    || ! grep -Fq 'rescue:' "${observability_recovery_tasks}" \
    || ! grep -Fq 'Record sanitized pending-install recovery failure evidence' "${observability_recovery_tasks}" \
    || ! grep -Fq 'Require fresh human review after pending-install recovery failure' "${observability_recovery_tasks}" \
    || grep -Eq -- '--keep-history|--replace|ignore-not-found|helm rollback|retries:|until:|kubectl[[:space:]].*delete|state:[[:space:]]*absent|--filter[[:space:]]+[^[:space:]]*\*|uninstall[[:space:]]+\*' "${observability_recovery_tasks}"; then
    fail 'Pending-install recovery must remain one exact opt-in Helm uninstall with explicit kubeconfig and no dangerous variants.'
  fi

  if grep -q -- '--cleanup-on-fail' "${observability_release_tasks}" \
    || ! grep -q -- '--atomic=false' "${observability_release_tasks}"; then
    fail 'Initial persistent observability install must explicitly disable atomic and omit cleanup-on-fail.'
  fi

  if ! grep -qE "observability_release_state \| trim == 'healthy'" "${observability_release_tasks}" \
    || ! grep -q -- '--atomic' "${observability_release_tasks}" \
    || ! grep -q 'helm rollback' "${observability_release_tasks}"; then
    fail 'Observability role must retain the healthy-upgrade guard and rollback interface.'
  fi
}

check_observability_workflow_bootstrap_contract() {
  local workflow="${INFRA_DIR}/../.github/workflows/deploy-dev.yml"
  local observability_tasks="${ANSIBLE_DIR}/roles/observability/tasks/main.yml"

  [ -f "${workflow}" ] && [ -f "${observability_tasks}" ] || return

  for required_pattern in \
    'name: Bootstrap observability AWS credential Secret' \
    'OBSERVABILITY_AWS_ACCESS_KEY_ID: \$\{\{ secrets\.OBSERVABILITY_AWS_ACCESS_KEY_ID \}\}' \
    'OBSERVABILITY_AWS_SECRET_ACCESS_KEY: \$\{\{ secrets\.OBSERVABILITY_AWS_SECRET_ACCESS_KEY \}\}' \
    'create namespace observability --dry-run=client -o yaml \| sudo k3s kubectl apply -f -' \
    'create secret generic observability-aws-credentials --namespace observability' \
    '--from-file=access-key-id=' \
    '--from-file=secret-access-key=' \
    'trap cleanup_credentials EXIT' \
    'trap cleanup_remote_credentials EXIT'; do
    if ! grep -qE -- "${required_pattern}" "${workflow}"; then
      fail "Observability workflow bootstrap is missing required contract: ${required_pattern}."
    fi
  done

  if grep -qE 'Manually provision.*observability|Verify manually provisioned observability' "${observability_tasks}"; then
    fail 'Observability role must describe workflow-provisioned, not manual, AWS credentials.'
  fi
}

check_plaintext_secrets() {
  if grep -RInE '(password|secret|access[_-]?key|api[_-]?key)[[:space:]]*:[[:space:]]*[^[:space:]#][^#]*' \
    --include='*.yml' --include='*.yaml' --include='*.j2' \
    "${INFRA_DIR}/ansible" "${INFRA_DIR}/k8s" \
    | grep -vE '(secretKey:|secretKeyRef:|secretRef:|secret-access-key|access-key-id|REPLACE_WITH|remoteRef:|aws_credentials_secret_name|_secret_name|:[[:space:]]*/REPLACE/WITH/|:[[:space:]]*/[a-z0-9][a-z0-9._/-]*)'; then
    fail 'Potential plaintext secret value found.'
  fi
}

check_image_policy() {
  local image_name
  for image_name in web_image api_image worker_image; do
    if ! grep -qE "^${image_name}:[[:space:]]+ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:(REPLACE_WITH_64_HEX_DIGEST|[a-f0-9]{64})$" \
      "${ANSIBLE_DIR}/inventory/group_vars/k3s_nodes.yml.example"; then
      fail "${image_name} must use a lowercase ghcr.io immutable sha256 image reference."
    fi
  done
}

check_artifact_integrity_contract() {
  local checksum_name
  for checksum_name in k3s_installer_sha256 external_secrets_manifest_sha256 cert_manager_manifest_sha256 kube_state_metrics_manifest_sha256; do
    if ! grep -qE "^${checksum_name}:[[:space:]]+(REPLACE_WITH_OFFICIAL_64_HEX_SHA256|[a-f0-9]{64})$" \
      "${ANSIBLE_DIR}/inventory/group_vars/k3s_nodes.yml.example"; then
      fail "${checksum_name} must require an official SHA-256 value."
    fi
  done

  local url_name
  for url_name in external_secrets_manifest_url cert_manager_manifest_url kube_state_metrics_manifest_url; do
    if ! grep -qE "^${url_name}:[[:space:]]+(REPLACE_WITH_VERIFIED_HTTPS_MANIFEST_URL|https://[^[:space:]]+)$" \
      "${ANSIBLE_DIR}/inventory/group_vars/k3s_nodes.yml.example"; then
      fail "${url_name} must require an explicitly verified HTTPS artifact URL."
    fi
  done
}

check_monitoring_jobs() {
  local monitoring_scrape_template="${ANSIBLE_DIR}/roles/monitoring/templates/monitoring-scrape.yml.j2"
  local monitoring_targets_template="${ANSIBLE_DIR}/roles/monitoring/templates/monitoring-targets.json.j2"

  if ! grep -qE '^\- job_name: node-exporter$' "${monitoring_scrape_template}" \
    || ! grep -qE '^\- job_name: kube-state-metrics$' "${monitoring_scrape_template}"; then
    fail 'Monitoring scrape template must include node-exporter and kube-state-metrics jobs.'
  fi

  if ! grep -q 'node-exporter' "${monitoring_targets_template}" \
    || ! grep -q 'kube-state-metrics' "${monitoring_targets_template}"; then
    fail 'Monitoring target template must include node-exporter and kube-state-metrics targets.'
  fi
}

check_k3s_edge_contract() {
  local k3s_tasks="${ANSIBLE_DIR}/roles/k3s/tasks/main.yml"
  local k3s_template="${ANSIBLE_DIR}/roles/k3s/templates/config.yaml.j2"
  local k3s_handlers="${ANSIBLE_DIR}/roles/k3s/handlers/main.yml"
  local nginx_template="${ANSIBLE_DIR}/roles/k3s/templates/nginx-learning-platform.conf.j2"
  local k3s_vars="${ANSIBLE_DIR}/inventory/group_vars/k3s_nodes.yml.example"

  if grep -RInE -- '--disable=(traefik|servicelb)' "${ANSIBLE_DIR}"; then
    fail 'K3s packaged Traefik and ServiceLB must not be disabled.'
  fi

  if ! grep -q '/etc/rancher/k3s/config.yaml' "${k3s_tasks}" \
    || ! grep -q 'Restart K3s after configuration change' "${k3s_handlers}" \
    || ! grep -q '^write-kubeconfig-mode:' "${k3s_template}" \
    || ! grep -q 'nodeport-addresses=127.0.0.0/8' "${k3s_template}" \
    || ! grep -q '^k3s_traefik_http_node_port: 32080$' "${k3s_vars}" \
    || ! grep -q '^k3s_port_preflight_enabled: true$' "${k3s_vars}"; then
    fail 'K3s must manage declarative config, loopback NodePort, change-only restart, and edge preflight.'
  fi

  if ! grep -Fq 'server_name {{ grafana_public_host }};' "${nginx_template}" \
    || ! grep -Fq 'proxy_pass http://127.0.0.1:{{ k3s_traefik_http_node_port }};' "${nginx_template}" \
    || ! grep -Fq 'proxy_set_header Host $host;' "${nginx_template}" \
    || ! grep -Fq 'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' "${nginx_template}" \
    || ! grep -Fq 'proxy_set_header X-Forwarded-Host $host;' "${nginx_template}" \
    || ! grep -Fq 'proxy_set_header X-Forwarded-Proto https;' "${nginx_template}" \
    || ! grep -Fq 'proxy_set_header X-Forwarded-Port 443;' "${nginx_template}" \
    || ! grep -Fq 'ssl_certificate {{ nginx_tls_certificate_path }};' "${nginx_template}" \
    || ! grep -Fq 'ssl_certificate_key {{ nginx_tls_certificate_key_path }};' "${nginx_template}" \
    || ! grep -Fq "grafana_public_host == 'grafana.sirobabycloud.io.vn'" "${k3s_tasks}" \
    || ! grep -Fq 'grafana_ingress_host == grafana_public_host' "${k3s_tasks}" \
    || ! grep -Fqx 'grafana_public_host: grafana.sirobabycloud.io.vn' "${k3s_vars}" \
    || ! grep -Fqx 'grafana_ingress_host: grafana.sirobabycloud.io.vn' "${k3s_vars}"; then
    fail 'Nginx must terminate existing TLS for the Grafana public host and forward its Host over loopback Traefik.'
  fi
}

go_worker_container_block() {
  local app_template="$1"

  awk '
    $0 == "        - name: go-worker" { capture=1 }
    capture {
      if (printed && $0 ~ /^        - name: /) exit
      print
      printed=1
    }
  ' "${app_template}"
}

has_go_worker_env_literal() {
  local go_worker_block="$1"
  local name="$2"
  local value="$3"

  awk -v expected_name="${name}" -v expected_value="${value}" '
    $0 == "            - name: " expected_name {
      expect_value = 1
      next
    }
    expect_value {
      found = $0 == "              value: " expected_value
      exit
    }
    END { exit found ? 0 : 1 }
  ' <<<"${go_worker_block}"
}

has_go_worker_provider_profile() {
  local app_template="$1"
  local go_worker_block
  go_worker_block="$(go_worker_container_block "${app_template}")"

  has_go_worker_env_literal "${go_worker_block}" 'AI_LLM_PROVIDER' 'openai-compatible' \
    && has_go_worker_env_literal "${go_worker_block}" 'OPENAI_CAPABILITY_VERSION' 'chat-completions-json-v1' \
    && has_go_worker_env_literal "${go_worker_block}" 'OPENAI_STRUCTURED_OUTPUT_MODE' 'json-object' \
    && has_go_worker_env_literal "${go_worker_block}" 'OPENAI_TRANSPORT' 'chat-completions' \
    && has_go_worker_env_literal "${go_worker_block}" 'OPENAI_REQUEST_TIMEOUT_MS' '"60000"'
}

has_go_worker_migrations_directory() {
  local app_template="$1"
  local go_worker_block
  go_worker_block="$(go_worker_container_block "${app_template}")"

  awk '
    $0 == "            - name: AI_WORKER_MIGRATIONS_DIR" {
      expecting_value = 1
      next
    }
    expecting_value {
      if ($0 == "              value: /app/migrations") {
        found = 1
      }
      exit
    }
    END { exit found ? 0 : 1 }
  ' <<<"${go_worker_block}"
}

check_application_edge_contract() {
  local app_tasks="${ANSIBLE_DIR}/roles/applications/tasks/main.yml"
  local eso_template="${ANSIBLE_DIR}/roles/external_secrets/templates/external-secrets.yaml.j2"
  local app_template="${INFRA_DIR}/k8s/apps.yaml.j2"
  local swagger_external_secret_template="${INFRA_DIR}/k8s/swagger-external-secret.yaml.j2"
  local app_vars="${ANSIBLE_DIR}/inventory/group_vars/k3s_nodes.yml.example"

  for required_pattern in \
    '^  db_ssl_mode: /REPLACE/WITH/EXACT/db-ssl-mode$' \
    '^  db_ssl_ca: /REPLACE/WITH/EXACT/db-ssl-ca$' \
    '^  google_client_id: /REPLACE/WITH/EXACT/google-client-id$' \
    '^  google_client_secret: /REPLACE/WITH/EXACT/google-client-secret$' \
    '^  google_redirect_uri: /REPLACE/WITH/EXACT/google-redirect-uri$' \
    '^  auth_oauth_encryption_key: /REPLACE/WITH/EXACT/auth-oauth-encryption-key$' \
    '^  swagger_username: /REPLACE/WITH/EXACT/swagger-username$' \
    '^  swagger_password: /REPLACE/WITH/EXACT/swagger-password$' \
    '^ghcr_pull_secret_name: REPLACE_WITH_MANUALLY_PROVISIONED_GHCR_PULL_SECRET$' \
    '^web_public_host: REPLACE_WITH_WEB_PUBLIC_HOST$' \
    '^api_public_host: REPLACE_WITH_API_PUBLIC_HOST$' \
    '^phase0_api_base_url: http://api:3000/api/v1$' \
    '^phase0_dev_owner_id: REPLACE_WITH_DEV_OWNER_UUID$' \
    '^deployment_targets: \[web, api, worker\]$'; do
    if ! grep -qE "${required_pattern}" "${app_vars}"; then
      fail "Missing application contract variable matching ${required_pattern}."
    fi
  done

  if [ "$(grep -c "'DB_SSL_MODE': ssm_parameter_keys.db_ssl_mode" "${eso_template}")" -ne 2 ] \
    || [ "$(grep -c "'DB_SSL_CA': ssm_parameter_keys.db_ssl_ca" "${eso_template}")" -ne 2 ] \
    || [ "$(grep -c "'GOOGLE_CLIENT_ID': ssm_parameter_keys.google_client_id" "${eso_template}")" -ne 1 ] \
    || [ "$(grep -c "'GOOGLE_CLIENT_SECRET': ssm_parameter_keys.google_client_secret" "${eso_template}")" -ne 1 ] \
    || [ "$(grep -c "'GOOGLE_REDIRECT_URI': ssm_parameter_keys.google_redirect_uri" "${eso_template}")" -ne 1 ] \
    || [ "$(grep -c "'AUTH_OAUTH_ENCRYPTION_KEY': ssm_parameter_keys.auth_oauth_encryption_key" "${eso_template}")" -ne 1 ] \
    || [ "$(grep -c 'imagePullSecrets:' "${app_template}")" -ne 3 ] \
    || ! grep -q 'kind: Ingress' "${app_template}" \
    || ! grep -q 'ingressClassName: traefik' "${app_template}" \
    || ! grep -q 'name: api' "${app_template}" \
    || ! grep -q 'name: web' "${app_template}" \
    || grep -A 40 'kind: Ingress' "${app_template}" | grep -q 'name: worker'; then
    fail 'Ingress must route only web and API, with image pull secrets on every pod.'
  fi

  if grep -R -Eq 'AI_WORKER_(DATABASE|MIGRATION)_URL|ai_worker_(database|migration)_url' \
    "${INFRA_DIR}" "${WORKSPACE_DIR}/worker" "${WORKSPACE_DIR}/app"; then
    fail 'Go worker must reuse the existing backend database Secret without separate SSM database URLs.'
  fi

  if ! grep -Fq "{% for key in ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] %}" "${app_template}" \
    || ! grep -Fqx '                  name: learning-platform-api-runtime' "${app_template}"; then
    fail 'Go worker must source its shared PostgreSQL configuration from the backend runtime Secret.'
  fi

  for api_oauth_env in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI AUTH_OAUTH_ENCRYPTION_KEY; do
    if ! grep -Fq "'${api_oauth_env}'" "${app_template}" \
      || ! grep -Fq '                  name: learning-platform-api-runtime' "${app_template}"; then
      fail "API must source ${api_oauth_env} from the shared runtime Secret."
    fi
  done

  if ! grep -q 'kubernetes.io/dockerconfigjson' "${app_tasks}" \
    || ! grep -q 'deployment_targets' "${app_tasks}" \
    || ! grep -q 'Require complete target selection for the first application deployment' "${app_tasks}" \
    || ! grep -Fq "| intersect(['web', 'api', 'worker'])" "${app_tasks}" \
    || ! grep -Fq 'when: applications_existing_workload_names | length == 0' "${app_tasks}"; then
    fail 'Applications role must validate GHCR auth and preserve selective rollout targets.'
  fi

  for required_assertion in \
    "\"'web' not in deployment_targets or web_image is match('^ghcr\\\\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$')\"" \
    "\"'api' not in deployment_targets or api_image is match('^ghcr\\\\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$')\"" \
    "\"'worker' not in deployment_targets or worker_image is match('^ghcr\\\\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$')\"" \
    "ghcr_pull_secret_name is not search('REPLACE_WITH')" \
    'web_public_host is string' \
    'api_public_host is string' \
    "phase0_api_base_url == 'http://api:3000/api/v1'" \
    'ingress_tls_secret_name is string'; do
    if ! grep -Fqx "      - ${required_assertion}" "${app_tasks}"; then
      fail "Application assertion must use the exact list indentation: ${required_assertion}."
    fi
  done

  if grep -Fqx "      - web_image is match('^ghcr\\\\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$')" "${app_tasks}" \
    || grep -Fqx "      - api_image is match('^ghcr\\\\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$')" "${app_tasks}" \
    || grep -Fqx "      - worker_image is match('^ghcr\\\\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$')" "${app_tasks}"; then
    fail 'Unselected workload images must not block selective application deployment.'
  fi

  if [ "$(grep -Fxc '          env:' "${app_template}")" -ne 4 ] \
    || grep -Fqx '           env:' "${app_template}"; then
    fail 'Each workload container env block must use exactly 10 leading spaces; one-extra-space env indentation is forbidden.'
  fi

  if ! has_go_worker_migrations_directory "${app_template}"; then
    fail 'Go worker must set AI_WORKER_MIGRATIONS_DIR to /app/migrations before readiness.'
  fi

  if ! grep -A 50 'name: worker' "${app_template}" \
    | grep -A 1 'name: WORKER_QUIZ_GENERATION_CONCURRENCY' \
    | grep -Fq "value: '8'"; then
    fail 'Worker quiz generation concurrency must be an explicit bounded manifest literal.'
  fi

  if ! grep -A 50 'name: worker' "${app_template}" \
    | grep -A 1 'name: WORKER_EXECUTION_MODE' \
    | grep -Fqx '              value: relay-only'; then
    fail 'Node worker must set WORKER_EXECUTION_MODE to the relay-only manifest literal.'
  fi

  if ! has_go_worker_provider_profile "${app_template}"; then
    fail 'Go worker container must include the explicit coherent provider profile and bounded request timeout literals.'
  fi

  for forbidden_secret_contract in \
    'AI_LLM_PROVIDER' \
    'OPENAI_CAPABILITY_VERSION' \
    'OPENAI_STRUCTURED_OUTPUT_MODE' \
    'OPENAI_TRANSPORT' \
    'WORKER_EXECUTION_MODE'; do
    local forbidden_secret_contract_lower
    forbidden_secret_contract_lower="$(printf '%s' "${forbidden_secret_contract}" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
    if grep -Fq "'${forbidden_secret_contract}':" "${eso_template}" \
      || grep -Fq "  ${forbidden_secret_contract_lower}:" "${app_vars}"; then
      fail "Non-secret worker runtime config must not be sourced from ExternalSecret or SSM contract: ${forbidden_secret_contract}."
    fi
  done

  if [ "$(grep -Fc 'name: learning-platform-swagger-runtime' "${swagger_external_secret_template}")" -ne 2 ] \
    || ! grep -Fqx '    name: aws-parameter-store' "${swagger_external_secret_template}" \
    || [ "$(grep -Fc '    - secretKey:' "${swagger_external_secret_template}")" -ne 2 ] \
    || ! grep -Fqx '    - secretKey: SWAGGER_USERNAME' "${swagger_external_secret_template}" \
    || ! grep -Fqx '        key: {{ ssm_parameter_keys.swagger_username }}' "${swagger_external_secret_template}" \
    || ! grep -Fqx '    - secretKey: SWAGGER_PASSWORD' "${swagger_external_secret_template}" \
    || ! grep -Fqx '        key: {{ ssm_parameter_keys.swagger_password }}' "${swagger_external_secret_template}"; then
    fail 'Swagger runtime ExternalSecret must map exactly the two API-only Swagger SSM keys through aws-parameter-store.'
  fi

  if grep -Fq 'learning-platform-swagger-runtime' "${eso_template}"; then
    fail 'Swagger runtime ExternalSecret must not be duplicated in the baseline ESO template.'
  fi

  local api_block
  api_block="$(awk '/{% if '\''api'\'' in deployment_targets %}/{capture=1} capture {print} /{% endif %}/{if (capture) exit}' "${app_template}")"
  if [ "$(grep -Fc '            - name: SWAGGER_ENABLED' "${app_template}")" -ne 1 ] \
    || ! grep -Fqx "              value: 'true'" "${app_template}" \
    || [ "$(grep -Fc '            - name: SWAGGER_USERNAME' "${app_template}")" -ne 1 ] \
    || [ "$(grep -Fc '            - name: SWAGGER_PASSWORD' "${app_template}")" -ne 1 ] \
    || [ "$(grep -Fc '                  name: learning-platform-swagger-runtime' "${app_template}")" -ne 2 ] \
    || [ "$(grep -Fc '                  key: SWAGGER_USERNAME' "${app_template}")" -ne 1 ] \
    || [ "$(grep -Fc '                  key: SWAGGER_PASSWORD' "${app_template}")" -ne 1 ] \
    || ! grep -Fq '            - name: SWAGGER_ENABLED' <<<"${api_block}" \
    || ! grep -Fq "              value: 'true'" <<<"${api_block}" \
    || ! grep -Fq '            - name: SWAGGER_USERNAME' <<<"${api_block}" \
    || ! grep -Fq '            - name: SWAGGER_PASSWORD' <<<"${api_block}" \
    || [ "$(grep -Fc '                  name: learning-platform-swagger-runtime' <<<"${api_block}")" -ne 2 ]; then
    fail 'Swagger must be enabled only for API with both dedicated Secret references.'
  fi

  local worker_block
  worker_block="$(awk '/{% if '\''worker'\'' in deployment_targets %}/{capture=1} capture {print} /{% endif %}/{if (capture) exit}' "${app_template}")"
  if grep -Fq 'SWAGGER_' <<<"${worker_block}"; then
    fail 'Worker workload must not receive Swagger configuration or credentials.'
  fi

  for required_task in \
    'Apply API-only Swagger runtime ExternalSecret' \
    'Wait for API-only Swagger runtime ExternalSecret readiness'; do
    if ! grep -Fq -- "- name: ${required_task}" "${app_tasks}"; then
      fail "Applications role is missing Swagger reconciliation task: ${required_task}."
    fi
  done

  if [ "$(grep -Fc "when: \"'api' in deployment_targets\"" "${app_tasks}")" -lt 2 ] \
    || ! grep -Fq "swagger-external-secret.yaml.j2') | from_yaml" "${app_tasks}" \
    || ! grep -Fq 'name: learning-platform-swagger-runtime' "${app_tasks}"; then
    fail 'Applications role must apply and wait for the API-only Swagger ExternalSecret.'
  fi

  local swagger_apply_line swagger_wait_line workload_apply_line
  swagger_apply_line="$(grep -nF -- '- name: Apply API-only Swagger runtime ExternalSecret' "${app_tasks}" | cut -d: -f1)"
  swagger_wait_line="$(grep -nF -- '- name: Wait for API-only Swagger runtime ExternalSecret readiness' "${app_tasks}" | cut -d: -f1)"
  workload_apply_line="$(grep -nF -- '- name: Apply selected stateless Learning Platform workloads' "${app_tasks}" | cut -d: -f1)"
  if [ -z "${swagger_apply_line}" ] || [ -z "${swagger_wait_line}" ] || [ -z "${workload_apply_line}" ] \
    || [ "${swagger_apply_line}" -ge "${swagger_wait_line}" ] || [ "${swagger_wait_line}" -ge "${workload_apply_line}" ]; then
    fail 'Swagger ExternalSecret apply and readiness wait must precede workload application.'
  fi

  if [ -e "${INFRA_DIR}/k8s/migration-job.yaml.j2" ] \
    || [ -e "${ANSIBLE_DIR}/roles/applications/tests/migration-job-correlation.yml" ] \
    || grep -qE 'database-migrate|applications_database_migration|migration_image|applications_backend_selected' "${app_tasks}"; then
    fail 'Database migration ownership belongs to backend startup; external Kubernetes Job orchestration is forbidden.'
  fi

  local api_runtime_wait_line worker_runtime_wait_line workload_apply_line
  api_runtime_wait_line="$(grep -nF -- '- name: Wait for API runtime ExternalSecret readiness' "${app_tasks}" | cut -d: -f1)"
  worker_runtime_wait_line="$(grep -nF -- '- name: Wait for worker runtime ExternalSecret readiness' "${app_tasks}" | cut -d: -f1)"
  workload_apply_line="$(grep -nF -- '- name: Apply selected stateless Learning Platform workloads' "${app_tasks}" | cut -d: -f1)"
  if [ -z "${api_runtime_wait_line}" ] || [ -z "${worker_runtime_wait_line}" ] || [ -z "${workload_apply_line}" ] \
    || [ "${api_runtime_wait_line}" -ge "${workload_apply_line}" ] || [ "${worker_runtime_wait_line}" -ge "${workload_apply_line}" ] \
    || ! grep -Fq "when: \"'api' in deployment_targets or 'worker' in deployment_targets\"" "${app_tasks}" \
    || ! grep -Fq "when: \"'worker' in deployment_targets\"" "${app_tasks}"; then
    fail 'API and worker runtime ExternalSecret readiness must precede selected workload application.'
  fi
}

check_yaml_when_supported() {
  if command -v yamllint >/dev/null 2>&1; then
    yamllint -d '{extends: default, rules: {line-length: disable, truthy: disable}}' \
      "${ANSIBLE_DIR}" "${INFRA_DIR}/k8s"
    return
  fi

  if python3 -c 'import yaml' >/dev/null 2>&1; then
    while IFS= read -r -d '' yaml_file; do
      python3 -c 'import pathlib, sys, yaml; list(yaml.safe_load_all(pathlib.Path(sys.argv[1]).read_text()))' \
        "${yaml_file}"
    done < <(find "${ANSIBLE_DIR}" "${INFRA_DIR}/k8s" -type f \( -name '*.yml' -o -name '*.yaml' \) ! -name '*.j2' -print0)
    return
  fi

  printf 'SKIP: YAML parser not installed (yamllint or python3 with PyYAML).\n'
}

check_ansible_when_installed() {
  if command -v ansible-playbook >/dev/null 2>&1; then
    ANSIBLE_CONFIG="${ANSIBLE_DIR}/ansible.cfg" ansible-playbook \
      -i "${ANSIBLE_DIR}/inventory/hosts.example.yml" \
      "${ANSIBLE_DIR}/playbooks/site.yml" --syntax-check
    ANSIBLE_CONFIG="${ANSIBLE_DIR}/ansible.cfg" ansible-playbook \
      "${ANSIBLE_DIR}/roles/observability/tests/state-machine.yml"
    ANSIBLE_CONFIG="${ANSIBLE_DIR}/ansible.cfg" ansible-playbook \
      "${ANSIBLE_DIR}/roles/observability/tests/capacity-gate.yml"
    ANSIBLE_CONFIG="${ANSIBLE_DIR}/ansible.cfg" ansible-playbook \
"${ANSIBLE_DIR}/roles/observability/tests/controller-template-preflight.yml" --check
    ANSIBLE_CONFIG="${ANSIBLE_DIR}/ansible.cfg" ansible-playbook \
      "${ANSIBLE_DIR}/roles/observability/tests/values-staging.yml"
    ANSIBLE_CONFIG="${ANSIBLE_DIR}/ansible.cfg" ansible-playbook \
      "${ANSIBLE_DIR}/roles/cert_manager/tests/internal-pki-contract.yml"
    ANSIBLE_CONFIG="${ANSIBLE_DIR}/ansible.cfg" ansible-playbook \
      "${ANSIBLE_DIR}/roles/applications/tests/api-rollout-strategy.yml"
    return
  fi

  printf 'SKIP: ansible-playbook is not installed.\n'
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

check_application_workloads_are_stateless
check_observability_workloads
ruby "${INFRA_DIR}/scripts/tests/test-alloy-log-level-normalization.rb"
ruby "${ANSIBLE_DIR}/roles/k3s/tests/test-nginx-grafana-route.rb"
check_observability_release_policy_when_present
check_observability_workflow_bootstrap_contract
check_plaintext_secrets
check_image_policy
check_artifact_integrity_contract
check_monitoring_jobs
check_k3s_edge_contract
check_application_edge_contract
bash "${INFRA_DIR}/scripts/tests/test-go-worker-provider-profile-contract.sh"
check_yaml_when_supported
check_ansible_when_installed
printf 'Infrastructure static validation passed.\n'
