#!/usr/bin/env bash
# Executes the real remote payload of verify-media-probe-egress.sh against a
# mocked ssh/sudo/timeout/k3s so verdicts, sanitized output and cleanup are
# exercised without a cluster.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; readonly ROOT_DIR
readonly VERIFIER="${ROOT_DIR}/deploy/dev/verify-media-probe-egress.sh"
declare -a FIXTURE_DIRECTORIES=()
fail() { printf 'media probe egress verifier test failed: %s\n' "$*" >&2; exit 1; }
cleanup() { local directory; for directory in "${FIXTURE_DIRECTORIES[@]:-}"; do [[ -z "$directory" ]] || rm -rf -- "$directory"; done; }
trap cleanup EXIT

write_mocks() {
  local bin="$1"
  cat > "$bin/ssh" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${MOCK_SSH_TRANSPORT_FAILURE:-}" == true ]] && exit 255
remote_command="${!#}"
# POSIX sh ignores BASH_ENV; the bash it starts must unset it itself.
env BASH_ENV="$MOCK_HOSTILE_BASH_ENV" /bin/sh -c "$remote_command"
MOCK
  cat > "$bin/sudo" <<'MOCK'
#!/usr/bin/env bash
exec "$@"
MOCK
  cat > "$bin/timeout" <<'MOCK'
#!/usr/bin/env bash
shift
exec "$@"
MOCK
  cat > "$bin/k3s" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_K3S_LOG"
shift
case "$1" in
  rollout)
    [[ "${MOCK_NOT_READY:-}" != "$3" ]] ;;
  apply) cat > "$MOCK_MANIFEST" ;;
  wait|delete) exit 0 ;;
  exec)
    host="${@: -2:1}"
    script="${@: -3:1}"
    if [[ "$script" == *CONNECT* ]]; then
      [[ "$host" == s3.ap-southeast-1.amazonaws.com ]] && exit 0
      exit 10
    fi
    [[ "$host" == media-probe-db-egress ]] && exit 0
    [[ "${MOCK_LEAKY_HOST:-}" == "$host" ]] && exit 0
    [[ "${MOCK_DNS_FAILURE_HOST:-}" == "$host" ]] && exit 3
    exit 124 ;;
  *) exit 2 ;;
esac
MOCK
  chmod 700 "$bin"/*
}

# run_fixture <name> [ENV=VALUE...]; prints the fixture directory.
run_fixture() {
  shift # fixture label, kept for readable call sites
  local directory; directory="$(mktemp -d)"; FIXTURE_DIRECTORIES+=("$directory")
  mkdir "$directory/bin"
  write_mocks "$directory/bin"
  printf 'touch %q\n' "$directory/hostile-bash-env-ran" > "$directory/hostile-bash-env"
  local status=0
  env PATH="$directory/bin:$PATH" VPS_HOST=dev.example.test VPS_USER=deploy_user \
    MOCK_K3S_LOG="$directory/k3s.log" MOCK_MANIFEST="$directory/manifest.yaml" \
    MOCK_HOSTILE_BASH_ENV="$directory/hostile-bash-env" "$@" \
    "$VERIFIER" > "$directory/stdout" 2> "$directory/stderr" || status=$?
  printf '%s\n' "$status" > "$directory/status"
  printf '%s\n' "$directory"
}

assert_cleaned_up() {
  grep -Eq '^kubectl delete pod media-probe-egress-check-[a-f0-9]{8} ' "$1/k3s.log" || fail "$2: check Pod was not deleted"
  [[ ! -e "$1/hostile-bash-env-ran" ]] || fail "$2: remote shell sourced BASH_ENV"
}

secure="$(run_fixture secure)"
[[ "$(<"$secure/status")" == 0 ]] || fail "secure: expected success, got $(<"$secure/status"): $(<"$secure/stdout")"
for check in ready:media-egress-proxy ready:media-probe-db-egress ready:media-probe-worker \
  reachable:proxy-connect-s3 reachable:forwarder blocked:direct-database blocked:direct-s3 \
  blocked:direct-internet-ip blocked:proxy-connect-database blocked:proxy-connect-not-allowlisted; do
  grep -Fxq "PASS ${check}" "$secure/stdout" || fail "secure: missing PASS ${check}"
done
grep -Fxq 'RESULT PASS' "$secure/stdout" || fail 'secure: missing RESULT PASS'
grep -Fq 'pg-15341ed3-ngocphat076-b603.j.aivencloud.com 27158' "$secure/k3s.log" || fail 'secure: database upstream was not read from dev vars'
grep -Fq 'app.kubernetes.io/component: media-probe-worker' "$secure/manifest.yaml" || fail 'secure: check Pod lacks the probe NetworkPolicy label'
grep -Fq 'activeDeadlineSeconds: 300' "$secure/manifest.yaml" || fail 'secure: check Pod is not time-bounded'
grep -Fq 'automountServiceAccountToken: false' "$secure/manifest.yaml" || fail 'secure: check Pod mounts a token'
[[ "$(grep -Evc '^(PASS|FAIL) |^RESULT ' "$secure/stdout")" == 0 ]] || fail 'secure: output contains unsanitized lines'
assert_cleaned_up "$secure" secure

leaky="$(run_fixture leaky MOCK_LEAKY_HOST=1.1.1.1)"
[[ "$(<"$leaky/status")" != 0 ]] || fail 'leaky: a reachable Internet IP must fail'
grep -Fxq 'FAIL blocked:direct-internet-ip (connected)' "$leaky/stdout" || fail 'leaky: missing direct Internet failure'
grep -Fxq 'RESULT FAIL 1' "$leaky/stdout" || fail 'leaky: missing RESULT FAIL 1'
assert_cleaned_up "$leaky" leaky

dns="$(run_fixture dns MOCK_DNS_FAILURE_HOST=pg-15341ed3-ngocphat076-b603.j.aivencloud.com)"
[[ "$(<"$dns/status")" != 0 ]] || fail 'dns: an unresolved target must not count as blocked'
grep -Fq 'FAIL blocked:direct-database (inconclusive' "$dns/stdout" || fail 'dns: missing inconclusive failure'
assert_cleaned_up "$dns" dns

not_ready="$(run_fixture not-ready MOCK_NOT_READY=deployment/media-probe-db-egress)"
[[ "$(<"$not_ready/status")" != 0 ]] || fail 'not-ready: an unready forwarder must fail'
grep -Fxq 'FAIL ready:media-probe-db-egress' "$not_ready/stdout" || fail 'not-ready: missing readiness failure'
assert_cleaned_up "$not_ready" not-ready

transport="$(run_fixture transport MOCK_SSH_TRANSPORT_FAILURE=true)"
[[ "$(<"$transport/status")" != 0 ]] || fail 'transport: SSH failure must fail'
grep -Fq 'SSH transport failed' "$transport/stderr" || fail 'transport: missing transport failure message'

disabled_vars="$(mktemp)"; FIXTURE_DIRECTORIES+=("$disabled_vars")
sed 's/^media_probe_worker_enabled: true$/media_probe_worker_enabled: false/' "${ROOT_DIR}/infra/ansible/vars/dev.yml" > "$disabled_vars"
disabled="$(run_fixture disabled DEV_ANSIBLE_VARS="$disabled_vars")"
[[ "$(<"$disabled/status")" != 0 ]] || fail 'disabled: a disabled flag must fail before SSH'
[[ ! -s "$disabled/k3s.log" ]] || fail 'disabled: remote commands ran with the flag disabled'

printf '%s\n' 'media probe egress verifier tests passed'
