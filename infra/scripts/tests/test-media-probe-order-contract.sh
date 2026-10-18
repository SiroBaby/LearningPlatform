#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
source "${ROOT_DIR}/infra/scripts/validate.sh"

app_template="${ROOT_DIR}/infra/k8s/apps.yaml.j2"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "${work_dir}"' EXIT HUP INT TERM

if ! (check_media_probe_apply_order "${app_template}") >/dev/null 2>&1; then
  printf '%s\n' 'FAIL production media probe apply order was rejected' >&2
  exit 1
fi

# Each case applies one Ruby substitution to a copy of the template; the order
# contract must reject the result.
expect_rejected() {
  local label="$1"
  local ruby_expression="$2"
  local mutated_app="${work_dir}/apps.yaml.j2"

  cp "${app_template}" "${mutated_app}"
  ruby -e "path = ARGV.fetch(0); text = File.read(path); mutated = (${ruby_expression}); abort('mutation did not apply') if mutated == text; File.write(path, mutated)" "${mutated_app}"

  if (check_media_probe_apply_order "${mutated_app}") >/dev/null 2>&1; then
    printf 'FAIL media probe apply order accepted: %s\n' "${label}" >&2
    exit 1
  fi
}

probe_gate="{% if 'worker' in deployment_targets and media_probe_worker_enabled | default(false) | bool %}\n"
probe_deployment_document="---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: media-probe-worker\n"
probe_service_account_document="---\napiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: media-probe-worker\n"

expect_rejected 'Deployment before its ServiceAccount and NetworkPolicies' \
  "deployment = text[/^#{Regexp.escape(\"${probe_deployment_document}\")}.*?(?=\\{% endif %\\}\\n\\{% if 'worker' in deployment_targets and document_purge)/m]; text.sub(deployment, '').sub(\"${probe_gate}\", \"${probe_gate}#{deployment}\")"
expect_rejected 'ServiceAccount before the forwarder policies' \
  "account = text[/^#{Regexp.escape(\"${probe_service_account_document}\")}.*?(?=---\\napiVersion: networking.k8s.io\\/v1\\nkind: NetworkPolicy\\nmetadata:\\n  name: media-probe-worker-ingress)/m]; text.sub(account, '').sub(\"${probe_gate}\", \"${probe_gate}#{account}\")"
expect_rejected 'egress policy after the Deployment' \
  "text.sub(/(---\\napiVersion: networking.k8s.io\\/v1\\nkind: NetworkPolicy\\nmetadata:\\n  name: media-probe-worker-egress\\n.*?)(---\\napiVersion: apps\\/v1\\nkind: Deployment\\nmetadata:\\n  name: media-probe-worker\\n.*?)(\\{% endif %\\}\\n)/m) { \"#{\$2}#{\$1}#{\$3}\" }"
expect_rejected 'media probe block before the proxy ingress client rule' \
  "block = text[/^#{Regexp.escape(\"${probe_gate}\")}.*?^\\{% endif %\\}\\n/m]; text.sub(block, '').sub(\"{% if media_egress_proxy_enabled\", \"#{block}{% if media_egress_proxy_enabled\")"

expect_rejected 'probe and forwarder objects in a separate gate before the proxy, old gate kept' \
  "block = text[/^#{Regexp.escape(\"${probe_gate}\")}.*?^\\{% endif %\\}\\n/m]; moved = block.sub(\"${probe_gate}\", \"{% if 'worker' in deployment_targets and media_probe_worker_enabled | default(false) | bool and true %}\\n\"); text.sub(block, \"${probe_gate}{% endif %}\\n\").sub(\"{% if media_egress_proxy_enabled\", \"#{moved}{% if media_egress_proxy_enabled\")"

printf '%s\n' 'PASS media probe apply order contract'
