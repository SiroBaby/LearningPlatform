#!/usr/bin/env bash
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly INFRA_DIR
readonly HELM_VERSION='v3.21.3'
readonly NAMESPACE='observability'
output_dir=''

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require_helm() {
  command -v helm >/dev/null 2>&1 || fail "Helm ${HELM_VERSION} is required locally; install it or provide a local Helm binary."
  [[ "$(helm version --template '{{.Version}}' 2>/dev/null)" =~ ^${HELM_VERSION}(\+[0-9A-Za-z.-]+)?$ ]] || fail "Helm must be ${HELM_VERSION}, optionally followed by SemVer build metadata."
}

chart_dir=''
check_helm_version=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-helm-version)
      check_helm_version=true
      shift
      ;;
    --chart-dir)
      chart_dir="${2:-}"
      [ -d "${chart_dir}" ] || fail '--chart-dir must name a directory containing the three exact official chart archives.'
      shift 2
      ;;
    --output-dir)
      output_dir="${2:-}"
      [ -d "${output_dir}" ] || fail '--output-dir must name an existing directory.'
      shift 2
      ;;
    *) fail 'Usage: render-observability.sh [--check-helm-version] [--chart-dir DIRECTORY] [--output-dir DIRECTORY]' ;;
  esac
done
if [ -z "${output_dir}" ]; then
  output_dir="$(mktemp -d "${TMPDIR:-/tmp}/learning-platform-observability.XXXXXX")"
  trap 'rm -rf "${output_dir}"' EXIT
fi
readonly OUTPUT_DIR="${output_dir}"
require_helm
[ "${check_helm_version}" = false ] || exit 0

if [ -z "${chart_dir}" ]; then
  helm repo add --force-update prometheus-community https://prometheus-community.github.io/helm-charts
  helm repo add --force-update grafana-community https://grafana-community.github.io/helm-charts
  helm repo add --force-update grafana https://grafana.github.io/helm-charts
  helm repo update prometheus-community grafana-community grafana
  monitoring_chart='prometheus-community/kube-prometheus-stack'
  loki_chart='grafana-community/loki'
  alloy_chart='grafana/alloy'
else
  monitoring_chart="${chart_dir}/kube-prometheus-stack-87.21.0.tgz"
  loki_chart="${chart_dir}/loki-18.7.0.tgz"
  alloy_chart="${chart_dir}/alloy-1.11.0.tgz"
  [ -f "${monitoring_chart}" ] && [ -f "${loki_chart}" ] && [ -f "${alloy_chart}" ] || fail 'local chart archive names/versions must be exact.'
fi

render() {
  local release="$1" chart="$2" version="$3" values="$4" output="$5"
  local version_args=(--version "${version}")
  [ -n "${chart_dir}" ] && version_args=()
  helm template "${release}" "${chart}" --namespace "${NAMESPACE}" "${version_args[@]}" --values "${values}" >"${output}"
}

render learning-platform-monitoring "${monitoring_chart}" 87.21.0 "${INFRA_DIR}/observability/kube-prometheus-stack-values.yml" "${OUTPUT_DIR}/monitoring.yml"
render learning-platform-loki "${loki_chart}" 18.7.0 "${INFRA_DIR}/observability/loki-values.yml" "${OUTPUT_DIR}/loki.yml"
render learning-platform-alloy "${alloy_chart}" 1.11.0 "${INFRA_DIR}/observability/alloy-values.yml" "${OUTPUT_DIR}/alloy.yml"
ruby "${INFRA_DIR}/scripts/validate-rendered-observability.rb" --input "${OUTPUT_DIR}/monitoring.yml" --input "${OUTPUT_DIR}/loki.yml" --input "${OUTPUT_DIR}/alloy.yml" --junit "${OUTPUT_DIR}/rendered-observability-policy.xml"
printf 'PASS rendered charts validated; JUnit evidence was produced transiently at %s and cleaned on exit.\n' "${OUTPUT_DIR}/rendered-observability-policy.xml"
