#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT_DIR
readonly HELM_VERSION='v3.21.3'
readonly KUBE_PROMETHEUS_STACK_SHA256='05eae98df0ff6c21877a26a4400780e4bbff248bc3b88694ef8d08b273ed6815'
readonly LOKI_SHA256='066756e9541507b665da700f3cf489cb990a9fab17b735845a60138a8e5c35fc'
readonly ALLOY_SHA256='11d253b62e47beeacd89eb4283fc056962ecbf143984863c1998be13da0772dd'

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) helm_platform='linux-amd64'; helm_sha256='15e041a93a590dce8100f39385cd98c84a765c9e36aeeb9e2dc6ff9e4769e2e0' ;;
  Darwin-arm64) helm_platform='darwin-arm64'; helm_sha256='19879a848cad832b7a1ac24b767a481d20fb3b95ab53a220849649422ada144e' ;;
  *) fail "unsupported platform for pinned Helm ${HELM_VERSION}: $(uname -s)-$(uname -m)" ;;
esac

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/learning-platform-real-render.XXXXXX")"
trap 'rm -rf -- "${work_dir}"' EXIT
charts_dir="${work_dir}/charts"
render_dir="${work_dir}/rendered"
mkdir -p "${charts_dir}" "${render_dir}"

download() {
  local url="$1" output="$2" expected_sha256="$3"
  curl --fail --location --silent --show-error --retry 3 --retry-delay 2 --connect-timeout 10 --max-time 120 --output "${output}" "${url}"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s  %s\n' "${expected_sha256}" "${output}" | sha256sum --check --status -
  else
    [ "$(shasum -a 256 "${output}" | awk '{print $1}')" = "${expected_sha256}" ]
  fi || fail "checksum mismatch for ${output}"
}

helm_archive="${work_dir}/helm-${HELM_VERSION}-${helm_platform}.tar.gz"
download "https://get.helm.sh/helm-${HELM_VERSION}-${helm_platform}.tar.gz" "${helm_archive}" "${helm_sha256}"
tar -xzf "${helm_archive}" -C "${work_dir}"

download 'https://github.com/prometheus-community/helm-charts/releases/download/kube-prometheus-stack-87.21.0/kube-prometheus-stack-87.21.0.tgz' "${charts_dir}/kube-prometheus-stack-87.21.0.tgz" "${KUBE_PROMETHEUS_STACK_SHA256}"
download 'https://github.com/grafana-community/helm-charts/releases/download/loki-18.7.0/loki-18.7.0.tgz' "${charts_dir}/loki-18.7.0.tgz" "${LOKI_SHA256}"
download 'https://github.com/grafana/helm-charts/releases/download/alloy-1.11.0/alloy-1.11.0.tgz' "${charts_dir}/alloy-1.11.0.tgz" "${ALLOY_SHA256}"

PATH="${work_dir}/${helm_platform}:${PATH}" \
  bash "${ROOT_DIR}/infra/scripts/render-observability.sh" --chart-dir "${charts_dir}" --output-dir "${render_dir}"
ruby "${ROOT_DIR}/infra/scripts/tests/test-rendered-observability-real-policy.rb" --render-dir "${render_dir}"
printf '%s\n' 'PASS real observability charts were downloaded, checksum-pinned, rendered, and mutation-tested'
