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
  local app_vars="${ANSIBLE_DIR}/inventory/group_vars/k3s_nodes.yml.example"

  for required_pattern in \
    '^  db_ssl_mode: /REPLACE/WITH/EXACT/db-ssl-mode$' \
    '^  db_ssl_ca: /REPLACE/WITH/EXACT/db-ssl-ca$' \
    '^ghcr_pull_secret_name: REPLACE_WITH_MANUALLY_PROVISIONED_GHCR_PULL_SECRET$' \
    '^web_public_host: REPLACE_WITH_WEB_PUBLIC_HOST$' \
    '^api_public_host: REPLACE_WITH_API_PUBLIC_HOST$' \
    '^phase0_api_base_url: http://api:3000$' \
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
