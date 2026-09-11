#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
source "${ROOT_DIR}/infra/scripts/validate.sh"

app_template="${ROOT_DIR}/infra/k8s/apps.yaml.j2"
api_block="$(awk '
  /{% if '\''api'\'' in deployment_targets %}/ { capture = 1 }
  capture { print }
  capture && /^          volumeMounts:/ { exit }
' "${app_template}")"

if ! grep -Fq "{% if media_egress_proxy_enabled | default(false) | bool %}" "${app_template}" \
  || ! grep -Fq "{% if object_storage_egress_proxy_enabled | default(false) | bool %}" <<<"${api_block}"; then
  printf '%s\n' 'Proxy workload and runtime proxy consumers must use separate gates.' >&2
  exit 1
fi

if ! grep -Fq "{% if object_storage_egress_proxy_enabled | default(false) | bool %}" <<<"${api_block}" \
  || ! grep -Fq '            - name: OBJECT_STORAGE_EGRESS_PROXY_URL' <<<"${api_block}" \
  || ! grep -Fq '                  key: OBJECT_STORAGE_EGRESS_PROXY_URL' <<<"${api_block}"; then
  printf '%s\n' 'API runtime must gate the explicit object-storage proxy environment key.' >&2
  exit 1
fi

if awk '
  /{% if object_storage_egress_proxy_enabled \| default\(false\) \| bool %}/ { gated = 1; next }
  /{% endif %}/ { gated = 0 }
  /- name: OBJECT_STORAGE_EGRESS_PROXY_URL/ && !gated { found = 1 }
  END { exit found ? 0 : 1 }
' <<<"${api_block}"; then
  printf '%s\n' 'API runtime exposed the proxy key outside its explicit feature gate.' >&2
  exit 1
fi

if grep -Eq "'HTTP_PROXY'|'HTTPS_PROXY'" <<<"${api_block}"; then
  printf '%s\n' 'API runtime must not inject process-wide proxy environment keys.' >&2
  exit 1
fi

printf '%s\n' 'PASS application media Jinja-loop contract'
