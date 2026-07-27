#!/usr/bin/env bash
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly INFRA_DIR
readonly ANSIBLE_DIR="${INFRA_DIR}/ansible"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

check_forbidden_workloads() {
  if grep -RInE '^kind:[[:space:]]*(StatefulSet|PersistentVolumeClaim|Prometheus|Grafana)[[:space:]]*$' \
    "${INFRA_DIR}/ansible" "${INFRA_DIR}/k8s"; then
    fail 'Forbidden StatefulSet, PVC, Prometheus, or Grafana workload found.'
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
  for checksum_name in k3s_installer_sha256 external_secrets_manifest_sha256 kube_state_metrics_manifest_sha256; do
    if ! grep -qE "^${checksum_name}:[[:space:]]+(REPLACE_WITH_OFFICIAL_64_HEX_SHA256|[a-f0-9]{64})$" \
      "${ANSIBLE_DIR}/inventory/group_vars/k3s_nodes.yml.example"; then
      fail "${checksum_name} must require an official SHA-256 value."
    fi
  done

  local url_name
  for url_name in external_secrets_manifest_url kube_state_metrics_manifest_url; do
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
}

check_application_edge_contract() {
  local app_tasks="${ANSIBLE_DIR}/roles/applications/tasks/main.yml"
  local eso_template="${ANSIBLE_DIR}/roles/external_secrets/templates/external-secrets.yaml.j2"
  local app_template="${INFRA_DIR}/k8s/apps.yaml.j2"
  local migration_template="${INFRA_DIR}/k8s/migration-job.yaml.j2"
  local swagger_external_secret_template="${INFRA_DIR}/k8s/swagger-external-secret.yaml.j2"
  local app_vars="${ANSIBLE_DIR}/inventory/group_vars/k3s_nodes.yml.example"

  for required_pattern in \
    '^  db_ssl_mode: /REPLACE/WITH/EXACT/db-ssl-mode$' \
    '^  db_ssl_ca: /REPLACE/WITH/EXACT/db-ssl-ca$' \
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
    || [ "$(grep -c 'imagePullSecrets:' "${app_template}")" -ne 3 ] \
    || ! grep -q 'kind: Ingress' "${app_template}" \
    || ! grep -q 'ingressClassName: traefik' "${app_template}" \
    || ! grep -q 'name: api' "${app_template}" \
    || ! grep -q 'name: web' "${app_template}" \
    || grep -A 40 'kind: Ingress' "${app_template}" | grep -q 'name: worker'; then
    fail 'Ingress must route only web and API, with image pull secrets on every pod.'
  fi

  if ! grep -q 'kubernetes.io/dockerconfigjson' "${app_tasks}" \
    || ! grep -q 'deployment_targets' "${app_tasks}" \
    || ! grep -q 'Require complete target selection for the first application deployment' "${app_tasks}"; then
    fail 'Applications role must validate GHCR auth and selective rollout targets.'
  fi

  for required_assertion in \
    "ghcr_pull_secret_name is not search('REPLACE_WITH')" \
    'web_public_host is string' \
    'api_public_host is string' \
    "phase0_api_base_url == 'http://api:3000/api/v1'" \
    'ingress_tls_secret_name is string'; do
    if ! grep -Fqx "      - ${required_assertion}" "${app_tasks}"; then
      fail "Application assertion must use the exact list indentation: ${required_assertion}."
    fi
  done

  if [ "$(grep -Fxc '          env:' "${app_template}")" -ne 3 ] \
    || grep -Fqx '           env:' "${app_template}"; then
    fail 'Each workload env block must use exactly 10 leading spaces; one-extra-space env indentation is forbidden.'
  fi

  for required_worker_literal in \
    '            - name: AI_LLM_PROVIDER' \
    '              value: openai' \
    '            - name: OPENAI_CAPABILITY_VERSION' \
    '              value: responses-json-v1' \
    '            - name: OPENAI_STRUCTURED_OUTPUT_MODE' \
    '              value: json-schema-strict' \
    '            - name: OPENAI_TRANSPORT' \
    '              value: responses'; do
    if ! grep -Fqx "${required_worker_literal}" "${app_template}"; then
      fail "Worker manifest must include explicit runtime literal: ${required_worker_literal}."
    fi
  done

  for forbidden_secret_contract in \
    'AI_LLM_PROVIDER' \
    'OPENAI_CAPABILITY_VERSION' \
    'OPENAI_STRUCTURED_OUTPUT_MODE' \
    'OPENAI_TRANSPORT'; do
    if grep -Fq "'${forbidden_secret_contract}':" "${eso_template}" \
      || grep -Fq "  ${forbidden_secret_contract,,}:" "${app_vars}"; then
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
    || [ "$(grep -Fc '                  name: learning-platform-swagger-runtime' <<<"${api_block}")" -ne 2 ] \
    || grep -Fq 'SWAGGER_' "${migration_template}"; then
    fail 'Swagger must be enabled only for API with both dedicated Secret references, never for migration.'
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

  if ! grep -qE '^api_resources:$' "${app_vars}" \
    || ! grep -Fqx '      - api_resources is mapping' "${app_tasks}" \
    || grep -Fq 'migration_resources' "${migration_template}" "${app_tasks}" "${app_vars}" \
    || ! grep -Fqx '  name: database-migrate' "${migration_template}" \
    || ! grep -Fqx 'kind: Job' "${migration_template}" \
    || ! grep -Fqx '  backoffLimit: 2' "${migration_template}" \
    || ! grep -Fqx '  activeDeadlineSeconds: 600' "${migration_template}" \
    || ! grep -Fqx '  ttlSecondsAfterFinished: 3600' "${migration_template}" \
    || ! grep -Fqx '  parallelism: 1' "${migration_template}" \
    || ! grep -Fqx '  completions: 1' "${migration_template}" \
    || ! grep -Fqx '      restartPolicy: Never' "${migration_template}" \
    || ! grep -Fqx "          command: ['node', 'dist/database/migrate.js', 'up']" "${migration_template}" \
    || ! grep -Fqx '          image: {{ migration_image }}' "${migration_template}" \
    || ! grep -Fqx '          resources: {{ api_resources | to_json }}' "${migration_template}"; then
    fail 'Database migration Job must be bounded, use the selected immutable backend image, and reuse API resources.'
  fi

  if [ "$(grep -c 'name: learning-platform-api-runtime' "${migration_template}")" -ne 1 ] \
    || [ "$(grep -c 'secretKeyRef:' "${migration_template}")" -ne 1 ] \
    || [ "$(grep -c "\['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_SSL_MODE', 'DB_SSL_CA'\]" "${migration_template}")" -ne 1 ] \
    || grep -qE 'ports:|[Pp]robe:|kind: (Service|Ingress)' "${migration_template}"; then
    fail 'Database migration Job must expose only the seven API runtime database keys and no network workload resources.'
  fi

  for required_task in \
    'Derive whether a selected backend requires database migration' \
    'Require identical API and worker images for a shared migration rollout' \
    'Inspect existing database migration Job' \
    'Refuse to replace a non-terminal database migration Job' \
    'Delete a terminal database migration Job before rerunning it' \
    'Wait for terminal database migration Job deletion' \
    'Apply database migration Job for the selected backend image' \
    'Wait for database migration Job to reach a terminal state' \
    'Require database migration Job completion before workload rollout'; do
    if ! grep -Fq -- "- name: ${required_task}" "${app_tasks}"; then
      fail "Applications role is missing migration gate task: ${required_task}."
    fi
  done

  if ! grep -Fq 'when: applications_backend_selected | bool' "${app_tasks}" \
    || ! grep -Fq "when: \"'api' in deployment_targets and 'worker' in deployment_targets\"" "${app_tasks}" \
    || ! grep -Fq "migration_image: \"{{ api_image if 'api' in deployment_targets else worker_image }}\"" "${app_tasks}" \
    || ! grep -Fq 'api_image == worker_image' "${app_tasks}"; then
    fail 'Applications role must select migration only for backend targets and require a shared backend image.'
  fi

  if grep -Fq 'status.active' "${app_tasks}" \
    || ! grep -Fq 'Complete=True or' "${app_tasks}" \
    || ! grep -Fq 'Failed=True' "${app_tasks}" \
    || [ "$(grep -Fc 'status.conditions | default([])' "${app_tasks}")" -lt 4 ] \
    || ! grep -Fq 'Delete a terminal database migration Job before rerunning it' "${app_tasks}"; then
    fail 'Database migration replacement must delete only terminal Complete=True or Failed=True Jobs.'
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
    return
  fi

  printf 'SKIP: ansible-playbook is not installed.\n'
}

check_forbidden_workloads
check_plaintext_secrets
check_image_policy
check_artifact_integrity_contract
check_monitoring_jobs
check_k3s_edge_contract
check_application_edge_contract
check_yaml_when_supported
check_ansible_when_installed
printf 'Infrastructure static validation passed.\n'
