#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
source "${ROOT_DIR}/infra/scripts/validate.sh"

app_template="${ROOT_DIR}/infra/k8s/apps.yaml.j2"
eso_template="${ROOT_DIR}/infra/ansible/roles/external_secrets/templates/external-secrets.yaml.j2"
dev_vars="${ROOT_DIR}/infra/ansible/vars/dev.yml"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "${work_dir}"' EXIT HUP INT TERM

if ! (check_document_purge_contract "${app_template}" "${eso_template}" "${dev_vars}") >/dev/null 2>&1; then
  printf '%s\n' 'FAIL production document purge contract was rejected' >&2
  exit 1
fi

# Each case applies one Ruby substitution to one file; the contract must reject it.
expect_rejected() {
  local label="$1"
  local target="$2"
  local ruby_expression="$3"
  local mutated_app="${work_dir}/apps.yaml.j2"
  local mutated_eso="${work_dir}/external-secrets.yaml.j2"
  local mutated_vars="${work_dir}/dev.yml"

  cp "${app_template}" "${mutated_app}"
  cp "${eso_template}" "${mutated_eso}"
  cp "${dev_vars}" "${mutated_vars}"
  local mutated_file="${work_dir}/${target}"
  ruby -e "path = ARGV.fetch(0); text = File.read(path); mutated = (${ruby_expression}); abort('mutation did not apply') if mutated == text; File.write(path, mutated)" "${mutated_file}"

  if (check_document_purge_contract "${mutated_app}" "${mutated_eso}" "${mutated_vars}") >/dev/null 2>&1; then
    printf 'FAIL document purge contract accepted: %s\n' "${label}" >&2
    exit 1
  fi
}

expect_rejected 'OpenAI key in the purge Deployment' apps.yaml.j2 \
  "text.sub(\"'OBJECT_STORAGE_PURGE_SECRET_KEY'] %}\", \"'OBJECT_STORAGE_PURGE_SECRET_KEY', 'OPENAI_API_KEY'] %}\")"
expect_rejected 'media probe key in the purge Secret' external-secrets.yaml.j2 \
  "text.sub(\"  'OBJECT_STORAGE_PURGE_SECRET_KEY': ssm_parameter_keys.object_storage_media_purge_secret_key\n\", \"  'OBJECT_STORAGE_PURGE_SECRET_KEY': ssm_parameter_keys.object_storage_media_purge_secret_key,\n  'OBJECT_STORAGE_MEDIA_PROBE_ACCESS_KEY': ssm_parameter_keys.object_storage_media_probe_access_key\n\")"
expect_rejected 'API document credential in the purge Deployment' apps.yaml.j2 \
  "text.sub(\"'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_MEDIA_BUCKET', 'OBJECT_STORAGE_PURGE\", \"'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_MEDIA_BUCKET', 'OBJECT_STORAGE_PURGE\")"
expect_rejected 'writable root filesystem' apps.yaml.j2 \
  "text.sub(/(name: document-purge-worker\n.*?)readOnlyRootFilesystem: true/m) { \"#{\$1}readOnlyRootFilesystem: false\" }"
expect_rejected 'ServiceAccount token automount' apps.yaml.j2 \
  "text.sub(\"  name: document-purge-worker\n  namespace: {{ learning_platform_namespace }}\nautomountServiceAccountToken: false\", \"  name: document-purge-worker\n  namespace: {{ learning_platform_namespace }}\nautomountServiceAccountToken: true\")"
expect_rejected 'missing seccomp profile' apps.yaml.j2 \
  "text.sub(/(serviceAccountName: document-purge-worker\n.*?)        seccompProfile:\n          type: RuntimeDefault\n/m) { \$1 }"
expect_rejected 'retained capabilities' apps.yaml.j2 \
  "text.sub(/(name: document-purge-worker\n.*?)drop: \\[ALL\\]/m) { \"#{\$1}drop: [NET_RAW]\" }"
expect_rejected 'relay-only execution mode' apps.yaml.j2 \
  "text.sub('              value: document-purge', '              value: relay-only')"
expect_rejected 'open egress port rule' apps.yaml.j2 \
  "text.sub(/(name: document-purge-worker-egress\n.*?)  egress:\n/m) { \"#{\$1}  egress:\n    - ports:\n        - protocol: TCP\n          port: 443\n\" }"
expect_rejected 'private range allowed for the database rule' apps.yaml.j2 \
  "text.sub(/(name: document-purge-worker-egress\n.*?)              - 10\\.0\\.0\\.0\\/8\n/m) { \$1 }"
expect_rejected 'Deployment before its ServiceAccount' apps.yaml.j2 \
  "text.sub(\"{% if 'worker' in deployment_targets and document_purge_enabled | default(false) | bool %}\n---\napiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: document-purge-worker\n  namespace: {{ learning_platform_namespace }}\nautomountServiceAccountToken: false\n\", \"{% if 'worker' in deployment_targets and document_purge_enabled | default(false) | bool %}\n\").sub(\"          emptyDir:\n            sizeLimit: 16Mi\n{% endif %}\", \"          emptyDir:\n            sizeLimit: 16Mi\n---\napiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: document-purge-worker\n  namespace: {{ learning_platform_namespace }}\nautomountServiceAccountToken: false\n{% endif %}\")"
expect_rejected 'lowercase OpenAI SSM key in the purge Secret' external-secrets.yaml.j2 \
  "text.sub(\"  'OBJECT_STORAGE_PURGE_SECRET_KEY': ssm_parameter_keys.object_storage_media_purge_secret_key\n\", \"  'OBJECT_STORAGE_PURGE_SECRET_KEY': ssm_parameter_keys.object_storage_media_purge_secret_key,\n  'LLM_TOKEN': ssm_parameter_keys.openai_api_key\n\")"
expect_rejected 'extra port on the database egress rule' apps.yaml.j2 \
  "text.sub(\"          port: {{ media_probe_database_upstream_port | int }}\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: document-purge-worker\n\", \"          port: {{ media_probe_database_upstream_port | int }}\n        - protocol: TCP\n          port: 443\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: document-purge-worker\n\")"
expect_rejected 'purge Deployment before the proxy ingress client rule' apps.yaml.j2 \
  "block = text[/^\\{% if 'worker' in deployment_targets and document_purge_enabled.*?\\n\\{% endif %\\}\\n/m]; text.sub(block, '').sub(\"{% endif %}\n{% if media_egress_proxy_enabled\", \"#{block}{% endif %}\n{% if media_egress_proxy_enabled\")"
expect_rejected 'purge workload outside the flag gate' apps.yaml.j2 \
  "text.sub(\"{% if 'worker' in deployment_targets and document_purge_enabled | default(false) | bool %}\", \"{% if 'worker' in deployment_targets %}\")"
expect_rejected 'purge tuning sourced from SSM' dev.yml \
  "text.sub(\"  object_storage_media_purge_secret_key: /learning-platform/dev/object-storage-media-purge-secret-key\n\", \"  object_storage_media_purge_secret_key: /learning-platform/dev/object-storage-media-purge-secret-key\n  document_purge_batch_size: /learning-platform/dev/document-purge-batch-size\n\")"
expect_rejected 'quoted flag value' dev.yml \
  "text.sub('document_purge_enabled: false', \"document_purge_enabled: 'false'\")"

printf '%s\n' 'PASS document purge workload contract'
