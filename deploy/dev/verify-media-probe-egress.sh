#!/usr/bin/env bash
# Owner-run runtime evidence for the dev media-probe egress boundary (#158, #199).
#
# Over one SSH session it checks that media-egress-proxy, media-probe-db-egress
# and media-probe-worker are rolled out, then starts one short-lived check Pod
# carrying the media-probe-worker labels so the same NetworkPolicies apply to
# it. From that Pod, direct PostgreSQL/S3/Internet connections and Squid
# CONNECT to non-allowlisted targets must be blocked, while the forwarder and
# the allowlisted S3 endpoint stay reachable as positive controls. The Pod is
# always deleted. Output is a fixed PASS/FAIL line per check; no kubectl
# output, Secret data, or connection payload is printed.
#
# A Ready media-probe-worker is the database evidence: it becomes Ready only
# after its pgx Ping succeeds through the forwarder with verified TLS (#198).
#
# Usage: VPS_HOST=<host> VPS_USER=<user> deploy/dev/verify-media-probe-egress.sh
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; readonly ROOT_DIR
readonly DEV_ANSIBLE_VARS="${DEV_ANSIBLE_VARS:-${ROOT_DIR}/infra/ansible/vars/dev.yml}"
readonly SSH_TRANSPORT_FAILURE=255

fail() { printf 'media probe egress verification failed: %s\n' "$*" >&2; exit 1; }

read_dev_var() {
  local name="$1" values
  values="$(grep -E "^${name}: " "$DEV_ANSIBLE_VARS" | sed -E "s/^${name}: //" || true)"
  [[ -n "$values" && "$(wc -l <<<"$values" | tr -d ' ')" == 1 ]] || fail "${name} must be declared exactly once in ${DEV_ANSIBLE_VARS}"
  printf '%s\n' "$values"
}

remote_payload() {
  cat <<'REMOTE_BASH'
set -Eeuo pipefail
readonly NAMESPACE=learning-platform-dev
readonly DATABASE_HOST="$1"
readonly DATABASE_PORT="$2"
readonly CHECK_POD="media-probe-egress-check-$3"
# Same pinned image as media-egress-proxy, so the node pulls nothing new.
readonly CHECK_IMAGE=ubuntu/squid@sha256:6a097f68bae708cedbabd6188d68c7e2e7a38cedd05a176e1cc0ba29e3bbe029
readonly S3_ENDPOINT=s3.ap-southeast-1.amazonaws.com
readonly NOT_ALLOWLISTED_HOST=example.com
readonly INTERNET_IP=1.1.1.1
failures=0

kubectl_bounded() { timeout 60s sudo k3s kubectl "$@"; }
cleanup() { kubectl_bounded delete pod "$CHECK_POD" --namespace "$NAMESPACE" --ignore-not-found --wait=false >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

report() {
  printf '%s %s\n' "$1" "$2"
  if [[ "$1" != PASS ]]; then failures=$((failures + 1)); fi
}

# Exit codes inside the check Pod: 0 connected, 3 DNS failure, other blocked.
readonly DIRECT_CONNECT='ip="$(getent ahostsv4 "$0" | awk "NR==1 {print \$1}")"; [ -n "$ip" ] || exit 3; exec timeout 8 bash -c "exec 3<>/dev/tcp/\$0/\$1" "$ip" "$1"'
# Exit codes: 0 Squid returned 200, 10 Squid returned 403, other unexpected.
readonly PROXY_CONNECT='exec 3<>/dev/tcp/media-egress-proxy/3128 || exit 4; printf "CONNECT %s:%s HTTP/1.1\r\nHost: %s:%s\r\n\r\n" "$0" "$1" "$0" "$1" >&3; IFS= read -r -t 15 status_line <&3 || exit 5; case "$status_line" in "HTTP/1."?" 200"*) exit 0 ;; "HTTP/1."?" 403"*) exit 10 ;; *) exit 6 ;; esac'

run_check() {
  local script="$1" host="$2" port="$3" status=0
  kubectl_bounded exec --namespace "$NAMESPACE" "$CHECK_POD" -- bash -c "$script" "$host" "$port" >/dev/null 2>&1 || status=$?
  printf '%s\n' "$status"
}

expect_blocked() {
  local label="$1" status
  status="$(run_check "$DIRECT_CONNECT" "$2" "$3")"
  case "$status" in
    0) report FAIL "$label (connected)" ;;
    3) report FAIL "$label (inconclusive: DNS resolution failed)" ;;
    *) report PASS "$label" ;;
  esac
}

expect_proxy_status() {
  local label="$1" expected="$2" status
  status="$(run_check "$PROXY_CONNECT" "$3" "$4")"
  if [[ "$status" == "$expected" ]]; then report PASS "$label"; else report FAIL "$label (exit ${status})"; fi
}

for deployment in media-egress-proxy media-probe-db-egress media-probe-worker; do
  if kubectl_bounded rollout status "deployment/${deployment}" --namespace "$NAMESPACE" --timeout=45s >/dev/null 2>&1; then
    report PASS "ready:${deployment}"
  else
    report FAIL "ready:${deployment}"
  fi
done

if ! kubectl_bounded apply --namespace "$NAMESPACE" -f - >/dev/null 2>&1 <<MANIFEST
apiVersion: v1
kind: Pod
metadata:
  name: ${CHECK_POD}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: learning-platform
    app.kubernetes.io/component: media-probe-worker
    learning-platform.io/egress-check: 'true'
spec:
  restartPolicy: Never
  activeDeadlineSeconds: 300
  serviceAccountName: media-probe-worker
  automountServiceAccountToken: false
  securityContext:
    runAsNonRoot: true
    runAsUser: 65532
    runAsGroup: 65532
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: check
      image: ${CHECK_IMAGE}
      imagePullPolicy: IfNotPresent
      command: [sleep, '240']
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: [ALL]
      resources:
        requests: {cpu: 10m, memory: 16Mi}
        limits: {cpu: 100m, memory: 64Mi}
MANIFEST
then
  report FAIL 'check-pod:create'
  printf 'RESULT FAIL %s\n' "$failures"
  exit 1
fi
if ! kubectl_bounded wait --namespace "$NAMESPACE" --for=condition=Ready "pod/${CHECK_POD}" --timeout=90s >/dev/null 2>&1; then
  report FAIL 'check-pod:ready'
  printf 'RESULT FAIL %s\n' "$failures"
  exit 1
fi

# Positive controls prove the check Pod has the probe identity, so the blocked
# results below come from policy rather than from a broken check.
expect_proxy_status 'reachable:proxy-connect-s3' 0 "$S3_ENDPOINT" 443
if [[ "$(run_check 'exec timeout 8 bash -c "exec 3<>/dev/tcp/$0/$1"' media-probe-db-egress 5432)" == 0 ]]; then
  report PASS 'reachable:forwarder'
else
  report FAIL 'reachable:forwarder'
fi

expect_blocked 'blocked:direct-database' "$DATABASE_HOST" "$DATABASE_PORT"
expect_blocked 'blocked:direct-s3' "$S3_ENDPOINT" 443
expect_blocked 'blocked:direct-internet-ip' "$INTERNET_IP" 443
expect_proxy_status 'blocked:proxy-connect-database' 10 "$DATABASE_HOST" "$DATABASE_PORT"
expect_proxy_status 'blocked:proxy-connect-not-allowlisted' 10 "$NOT_ALLOWLISTED_HOST" 443

if [[ "$failures" -eq 0 ]]; then
  printf 'RESULT PASS\n'
else
  printf 'RESULT FAIL %s\n' "$failures"
  exit 1
fi
REMOTE_BASH
}

main() {
  [[ -n "${VPS_HOST:-}" && -n "${VPS_USER:-}" ]] || fail 'VPS_HOST and VPS_USER must be set'
  [[ "$VPS_USER" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'VPS_USER contains unsupported characters'
  [[ "$VPS_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || fail 'VPS_HOST contains unsupported characters'
  [[ "$(read_dev_var media_probe_worker_enabled)" == true ]] || fail 'media_probe_worker_enabled is not true; nothing to verify'
  local database_host database_port check_suffix status=0
  database_host="$(read_dev_var media_probe_database_upstream_host)"
  database_port="$(read_dev_var media_probe_database_upstream_port)"
  [[ "$database_host" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || fail 'media_probe_database_upstream_host is not a lowercase host name'
  [[ "$database_port" =~ ^[0-9]{1,5}$ ]] || fail 'media_probe_database_upstream_port is not numeric'
  check_suffix="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  [[ "$check_suffix" =~ ^[a-f0-9]{8}$ ]] || fail 'could not generate a check Pod suffix'
  # stdin deliberately carries the remote payload, so ssh does not use -n.
  ssh -o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 \
    -o StrictHostKeyChecking=yes "${VPS_USER}@${VPS_HOST}" \
    "env -u BASH_ENV bash --noprofile --norc -s -- ${database_host} ${database_port} ${check_suffix}" \
    < <(remote_payload) || status=$?
  if [[ "$status" -eq "$SSH_TRANSPORT_FAILURE" ]]; then
    fail 'SSH transport failed; no runtime evidence was collected'
  fi
  [[ "$status" -eq 0 ]] || fail "one or more runtime checks failed (exit ${status})"
}

main "$@"
