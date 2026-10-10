#!/usr/bin/env bash
# Executes the real remote payload of verify-media-probe-egress.sh against a
# mocked ssh/sudo/timeout/k3s so verdicts, sanitized output and cleanup are
# exercised without a cluster. The in-pod DIRECT_CONNECT/PROXY_CONNECT commands
# run for real with bash /dev/tcp against a local fake network: an open port,
# a closed port and a fake Squid that answers CONNECT with 200 or 403.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; readonly ROOT_DIR
readonly VERIFIER="${ROOT_DIR}/deploy/dev/verify-media-probe-egress.sh"
declare -a FIXTURE_DIRECTORIES=()
FAKE_NETWORK_PID=''
fail() { printf 'media probe egress verifier test failed: %s\n' "$*" >&2; exit 1; }
cleanup() {
  local directory
  [[ -z "$FAKE_NETWORK_PID" ]] || kill "$FAKE_NETWORK_PID" 2>/dev/null || true
  for directory in "${FIXTURE_DIRECTORIES[@]:-}"; do [[ -z "$directory" ]] || rm -rf -- "$directory"; done
}
trap cleanup EXIT

# Starts the fake network and exports MOCK_OPEN_PORT, MOCK_CLOSED_PORT and
# MOCK_SQUID_PORT. Squid allows only the S3 endpoint, like the real ACL.
start_fake_network() {
  local directory; directory="$(mktemp -d)"; FIXTURE_DIRECTORIES+=("$directory")
  python3 -I - "$directory/ports" <<'PY_NET' &
import socket, sys, threading
def listener():
    server = socket.socket(); server.bind(("127.0.0.1", 0)); server.listen(16); return server
def serve_open(server):
    while True:
        connection, _ = server.accept(); connection.close()
def serve_squid(server):
    while True:
        connection, _ = server.accept()
        request_line = connection.makefile("rb").readline().decode()
        allowed = request_line.startswith("CONNECT s3.ap-southeast-1.amazonaws.com:443 ")
        connection.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n" if allowed else b"HTTP/1.1 403 Forbidden\r\n\r\n")
        connection.close()
closed = listener(); closed_port = closed.getsockname()[1]; closed.close()
open_server, squid_server = listener(), listener()
threading.Thread(target=serve_open, args=(open_server,), daemon=True).start()
threading.Thread(target=serve_squid, args=(squid_server,), daemon=True).start()
with open(sys.argv[1] + ".tmp", "w") as ports:
    ports.write(f"{open_server.getsockname()[1]} {closed_port} {squid_server.getsockname()[1]}\n")
import os; os.replace(sys.argv[1] + ".tmp", sys.argv[1])
threading.Event().wait()
PY_NET
  FAKE_NETWORK_PID=$!
  local attempt
  for attempt in $(seq 1 50); do [[ -s "$directory/ports" ]] && break; sleep 0.1; done
  [[ -s "$directory/ports" ]] || fail "fake network did not start (attempt ${attempt})"
  read -r MOCK_OPEN_PORT MOCK_CLOSED_PORT MOCK_SQUID_PORT < "$directory/ports"
  export MOCK_OPEN_PORT MOCK_CLOSED_PORT MOCK_SQUID_PORT
}

write_mocks() {
  local bin="$1"
  cat > "$bin/ssh" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${MOCK_SSH_TRANSPORT_FAILURE:-}" == true ]] && exit 255
remote_command="${!#}"
# POSIX sh ignores BASH_ENV; the bash it starts must unset it itself.
if [[ -n "${MOCK_SSH_STDOUT_LINES:-}" ]]; then
  # Simulates a dropped session: the reader goes away after N lines.
  env BASH_ENV="$MOCK_HOSTILE_BASH_ENV" /bin/sh -c "$remote_command" | head -n "$MOCK_SSH_STDOUT_LINES" || true
  exit 255
fi
env BASH_ENV="$MOCK_HOSTILE_BASH_ENV" /bin/sh -c "$remote_command"
MOCK
  cat > "$bin/sudo" <<'MOCK'
#!/usr/bin/env bash
exec "$@"
MOCK
  cat > "$bin/timeout" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MOCK_TIMEOUT_LOG"
shift
exec "$@"
MOCK
  # Fake cluster DNS: every name resolves to loopback unless told to fail.
  cat > "$bin/getent" <<'MOCK'
#!/usr/bin/env bash
[[ "$1" == ahostsv4 && "${MOCK_DNS_FAILURE_HOST:-}" != "$2" ]] || exit 2
printf '127.0.0.1       STREAM %s\n' "$2"
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
    exec_count=$(( $(grep -c ' exec ' "$MOCK_K3S_LOG") ))
    # kubectl exec itself failing (1) or the outer timeout expiring (124).
    if [[ -n "${MOCK_EXEC_FAIL_AFTER:-}" && "$exec_count" -gt "$MOCK_EXEC_FAIL_AFTER" ]]; then exit "${MOCK_EXEC_FAIL_STATUS:-1}"; fi
    script="${@: -3:1}"
    host="${@: -2:1}"
    port="${@: -1}"
    # Fake routing: the forwarder and an optional leaky host are reachable,
    # everything else is refused; the proxy name routes to the fake Squid.
    if [[ "$script" == *getent* ]]; then
      if [[ "$host" == media-probe-db-egress || "${MOCK_LEAKY_HOST:-}" == "$host" ]]; then port="$MOCK_OPEN_PORT"; else port="$MOCK_CLOSED_PORT"; fi
    fi
    script="${script//media-egress-proxy\/3128/127.0.0.1\/${MOCK_SQUID_PORT}}"
    exec bash -c "$script" "$host" "$port" ;;
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
  : > "$directory/k3s.log"
  write_mocks "$directory/bin"
  printf 'touch %q\n' "$directory/hostile-bash-env-ran" > "$directory/hostile-bash-env"
  local status=0
  env PATH="$directory/bin:$PATH" VPS_HOST=dev.example.test VPS_USER=deploy_user \
    MOCK_K3S_LOG="$directory/k3s.log" MOCK_MANIFEST="$directory/manifest.yaml" MOCK_TIMEOUT_LOG="$directory/timeout.log" \
    MOCK_HOSTILE_BASH_ENV="$directory/hostile-bash-env" "$@" \
    "$VERIFIER" > "$directory/stdout" 2> "$directory/stderr" || status=$?
  printf '%s\n' "$status" > "$directory/status"
  printf '%s\n' "$directory"
}

assert_cleaned_up() {
  grep -Eq '^kubectl delete pod media-probe-egress-check-[a-f0-9]{8} ' "$1/k3s.log" || fail "$2: check Pod was not deleted"
  [[ ! -e "$1/hostile-bash-env-ran" ]] || fail "$2: remote shell sourced BASH_ENV"
}

# Nit 2: the check Pod reuses the proxy image so the node pulls nothing new.
squid_image_pattern='ubuntu/squid@sha256:[a-f0-9]{64}'
manifest_image="$(grep -Eo "$squid_image_pattern" "${ROOT_DIR}/infra/k8s/apps.yaml.j2" | sort -u)"
verifier_image="$(grep -Eo "$squid_image_pattern" "$VERIFIER" | sort -u)"
[[ -n "$manifest_image" && "$(wc -l <<<"$manifest_image" | tr -d ' ')" == 1 ]] || fail 'apps.yaml.j2 must pin exactly one Squid image'
[[ "$verifier_image" == "$manifest_image" ]] || fail 'verifier check image differs from the media-egress-proxy image'

start_fake_network

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
# Leftover check Pods from an interrupted run are swept before a new one starts.
sweep_line="$(grep -n '^kubectl delete pod --namespace learning-platform-dev --selector learning-platform.io/egress-check=true ' "$secure/k3s.log" | cut -d: -f1 | head -n 1)"
apply_line="$(grep -n '^kubectl apply ' "$secure/k3s.log" | cut -d: -f1)"
[[ -n "$sweep_line" && "$sweep_line" -lt "$apply_line" ]] || fail 'secure: stale check Pods are not swept before apply'
# Nit 1: every outer timeout must exceed the --timeout passed to kubectl.
while read -r outer rest; do
  [[ "$rest" =~ --timeout=([0-9]+)s ]] || continue
  [[ "${outer%s}" -gt "${BASH_REMATCH[1]}" ]] || fail "secure: outer timeout ${outer} does not exceed --timeout=${BASH_REMATCH[1]}s"
done < "$secure/timeout.log"
grep -Eq '^105s sudo k3s kubectl wait .*--timeout=90s' "$secure/timeout.log" || fail 'secure: check Pod wait is not bounded by its own outer timeout'

# Medium 1: kubectl exec failing after the positive controls must never count
# as blocked, whether kubectl fails (1) or the outer timeout expires (124).
for exec_status in 1 124; do
  exec_failure="$(run_fixture exec-failure MOCK_EXEC_FAIL_AFTER=2 MOCK_EXEC_FAIL_STATUS="$exec_status")"
  [[ "$(<"$exec_failure/status")" != 0 ]] || fail "exec-failure ${exec_status}: a failed kubectl exec must fail"
  grep -Fxq 'PASS reachable:forwarder' "$exec_failure/stdout" || fail "exec-failure ${exec_status}: positive controls should still pass"
  grep -Eq '^PASS blocked:' "$exec_failure/stdout" && fail "exec-failure ${exec_status}: a failed kubectl exec was reported as blocked"
  grep -Fxq "FAIL blocked:direct-database (inconclusive: exit ${exec_status})" "$exec_failure/stdout" || fail "exec-failure ${exec_status}: missing inconclusive failure"
  grep -Fxq 'RESULT FAIL 5' "$exec_failure/stdout" || fail "exec-failure ${exec_status}: missing RESULT FAIL 5"
  assert_cleaned_up "$exec_failure" "exec-failure ${exec_status}"
done

# Low 3: a dropped SSH session must still delete the check Pod.
dropped="$(run_fixture dropped MOCK_SSH_STDOUT_LINES=4)"
[[ "$(<"$dropped/status")" != 0 ]] || fail 'dropped: a dropped session must fail'
grep -Fq 'SSH transport failed' "$dropped/stderr" || fail 'dropped: missing transport failure message'
assert_cleaned_up "$dropped" dropped
[[ "$(grep -c ' exec ' "$dropped/k3s.log")" -le 2 ]] || fail 'dropped: checks kept running after the session dropped'

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
