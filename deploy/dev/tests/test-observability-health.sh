#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; readonly ROOT_DIR
SAMPLER="${ROOT_DIR}/deploy/dev/observability-health.sh"; readonly SAMPLER
declare -a FIXTURE_DIRECTORIES=()
fail() { printf 'observability health test failed: %s\n' "$*" >&2; exit 1; }
cleanup() { local directory; for directory in "${FIXTURE_DIRECTORIES[@]:-}"; do rm -rf -- "$directory"; done; }
run_fixture() {
  local name="$1"; shift
  local directory; directory="$(mktemp -d)"; FIXTURE_DIRECTORIES+=("$directory")
  mkdir "$directory/bin"
  cat > "$directory/bin/ssh" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
remote_command="${!#}"
if [[ -n "${MOCK_HOSTILE_BASH_ENV:-}" ]]; then
  env BASH_ENV="$MOCK_HOSTILE_BASH_ENV" env -u BASH_ENV bash -c "$remote_command"
else
  env -u BASH_ENV bash -c "$remote_command"
fi
MOCK
  chmod 700 "$directory/bin/ssh"
  PATH="$directory/bin:$PATH" OBSERVABILITY_HEALTH_TEST_REMOTE=true "$@" "$SAMPLER" --host dev.example.test --user deploy_user --known-hosts /dev/null --output "$directory/$name.json"
  printf '%s\n' "$directory/$name.json"
}
main() {
  trap cleanup EXIT
  [[ -x "$SAMPLER" ]] || fail 'sampler must be executable'
  grep -Eq 'remote_probe \| ssh -o BatchMode=yes' "$SAMPLER" || fail 'remote script must be transported through SSH stdin without -n'
  grep -Eq 'env -u BASH_ENV bash --noprofile --norc -se' "$SAMPLER" || fail 'remote payload must clear hostile BASH_ENV before Bash starts'
  ! grep -Eq 'ssh -n .*<<' "$SAMPLER" || fail 'SSH stdin transport must not use -n'
  ! grep -Eiq 'kubectl[[:space:]].*(apply|create|delete|patch|edit|label|annotate|exec)|helm[[:space:]].*(install|upgrade|uninstall|rollback)|ansible|docker|nginx' "$SAMPLER" || fail 'sampler contains mutation command'
  grep -Eq 'kube-prometheus-stack-87\.21\.0|loki-18\.7\.0|alloy-1\.11\.0' "$SAMPLER" || fail 'release identity pins missing'
  grep -Eq 'get secret grafana-admin -o json \| python3' "$SAMPLER" && ! grep -Eq 'curl .* -u |GRAFANA_CURL_CONFIG|Authorization.*Basic.*\$' "$SAMPLER" || fail 'Grafana credentials must remain in the in-memory helper'
  grep -Eq 'start=\$emitted_at_ns.*end=\$now_ns' "$SAMPLER" || fail 'Loki query must use bounded nanosecond timestamps'
  grep -Eq 'observabilityPodsReady.*pvcUsage' "$SAMPLER" || fail 'each snapshot must record readiness and PVC usage'
  positive="$(run_fixture positive env)"
  ruby -rjson -e 'd=JSON.parse(File.read(ARGV[0])); abort unless d["status"]=="PASS" && d["transport"]=="remote-script-executed" && d["snapshots"].map{|x|x["offsetSeconds"]}==(0..30).map{|x|x*60}' "$positive"
  restart="$(run_fixture restart env OBSERVABILITY_HEALTH_TEST_RESTART_INCREASE=true)"
  pressure="$(run_fixture pressure env OBSERVABILITY_HEALTH_TEST_NODE_PRESSURE=true)"
  late_pod="$(run_fixture late-pod env OBSERVABILITY_HEALTH_TEST_LATE_POD_NOT_READY=true)"
  exact_threshold="$(run_fixture exact-threshold env OBSERVABILITY_HEALTH_TEST_DISK_GI=5 OBSERVABILITY_HEALTH_TEST_MEM_GI=1.5)"
  low_disk="$(run_fixture low-disk env OBSERVABILITY_HEALTH_TEST_DISK_GI=4.99 OBSERVABILITY_HEALTH_TEST_MEM_GI=1.5)"
  low_memory="$(run_fixture low-memory env OBSERVABILITY_HEALTH_TEST_DISK_GI=5 OBSERVABILITY_HEALTH_TEST_MEM_GI=1.49)"
  hostile_directory="$(mktemp -d)"; FIXTURE_DIRECTORIES+=("$hostile_directory")
  hostile_marker="$hostile_directory/sourced"
  hostile_bash_env="$hostile_directory/brittle-bash-env"
  printf '%s\n' "touch '$hostile_marker'; exit 99" > "$hostile_bash_env"
  hostile="$(run_fixture hostile-bash-env env MOCK_HOSTILE_BASH_ENV="$hostile_bash_env")"
  ruby -rjson -e 'ARGV.each { |p| abort unless JSON.parse(File.read(p))["status"]=="FAIL" }; abort unless JSON.parse(File.read(ARGV.fetch(2))).fetch("snapshots").last.fetch("observabilityPodsReady") == false' "$restart" "$pressure" "$late_pod"
  ruby -rjson -e 'pass = JSON.parse(File.read(ARGV.fetch(0))); abort unless pass["status"] == "PASS" && pass["snapshots"].all? { |snapshot| snapshot["diskAvailableGi"] == 5 && snapshot["memAvailableGi"] == 1.5 }; ARGV.drop(1).each { |path| abort unless JSON.parse(File.read(path))["status"] == "FAIL" }' "$exact_threshold" "$low_disk" "$low_memory"
  ruby -rjson -e 'abort if File.exist?(ARGV.fetch(0)); abort unless JSON.parse(File.read(ARGV.fetch(1)))["status"] == "PASS"' "$hostile_marker" "$hostile"
  POSITIVE="$positive" python3 - <<'PY'
import json

def loki_latency(payload, start_ns, end_ns, marker):
    values = [value for result in payload.get('data', {}).get('result', []) for value in result.get('values', [])]
    matching = [(int(value[0]) - start_ns) // 1_000_000_000 for value in values if marker in value[1] and start_ns <= int(value[0]) <= end_ns]
    return min(matching, default=121)

def grafana_contract(datasources, health, dashboards):
    expected = {
        'Prometheus': ('prometheus', 'http://prometheus-operated.observability.svc.cluster.local:9090'),
        'Loki': ('loki', 'http://learning-platform-loki.observability.svc.cluster.local:3100'),
    }
    indexed = {item['name']: item for item in datasources}
    return len(indexed) == 2 and all(name in indexed and (indexed[name]['type'], indexed[name]['url']) == contract and health[indexed[name]['id']] == 'OK' for name, contract in expected.items()) and dashboards == {
        'Kubernetes / Compute Resources / Cluster', 'Kubernetes / Compute Resources / Node (Pods)',
        'Kubernetes / Compute Resources / Namespace (Pods)', 'Node Exporter / Nodes'}

def pvc_contract(items):
    expected = {('learning-platform-monitoring', '3Gi'), ('learning-platform-monitoring', '1Gi'), ('learning-platform-loki', '2Gi')}
    return len(items) == 3 and {(item['owner'], item['size']) for item in items} == expected and all(item['phase'] == 'Bound' and item['storageClass'] == 'local-path' and item['uid'] and item['volumeName'] for item in items)

def ksm_contract(items):
    matches = [item for item in items if 'kube-state-metrics' in item['name']]
    return len(matches) == 1 and matches[0]['namespace'] == 'observability' and matches[0]['owner'] == 'learning-platform-monitoring'

marker = '00000000-0000-4000-8000-000000000001'; start = 1_000_000_000_000
assert loki_latency({'data': {'result': [{'values': [[str(start + 120_000_000_000), marker]]}]}}, start, start + 120_000_000_000, marker) == 120
assert loki_latency({'data': {'result': [{'values': [[str(start - 1), marker]]}]}}, start, start + 120_000_000_000, marker) == 121
sources = [{'name': 'Prometheus', 'type': 'prometheus', 'url': 'http://prometheus-operated.observability.svc.cluster.local:9090', 'id': 1}, {'name': 'Loki', 'type': 'loki', 'url': 'http://learning-platform-loki.observability.svc.cluster.local:3100', 'id': 2}]
dashboards = {'Kubernetes / Compute Resources / Cluster', 'Kubernetes / Compute Resources / Node (Pods)', 'Kubernetes / Compute Resources / Namespace (Pods)', 'Node Exporter / Nodes'}
assert grafana_contract(sources, {1: 'OK', 2: 'OK'}, dashboards)
assert not grafana_contract([{**sources[0], 'url': 'http://wrong'}, sources[1]], {1: 'OK', 2: 'OK'}, dashboards)
assert not grafana_contract(sources, {1: 'OK', 2: 'ERROR'}, dashboards)
claims = [{'owner': 'learning-platform-monitoring', 'size': '3Gi', 'phase': 'Bound', 'storageClass': 'local-path', 'uid': 'a', 'volumeName': 'pv-a'}, {'owner': 'learning-platform-monitoring', 'size': '1Gi', 'phase': 'Bound', 'storageClass': 'local-path', 'uid': 'b', 'volumeName': 'pv-b'}, {'owner': 'learning-platform-loki', 'size': '2Gi', 'phase': 'Bound', 'storageClass': 'local-path', 'uid': 'c', 'volumeName': 'pv-c'}]
assert pvc_contract(claims)
assert not pvc_contract([{**claims[0], 'phase': 'Pending'}, *claims[1:]])
assert not pvc_contract([{**claims[0], 'storageClass': 'wrong'}, *claims[1:]])
assert not pvc_contract([{**claims[0], 'volumeName': ''}, *claims[1:]])
assert ksm_contract([{'name': 'learning-platform-monitoring-kube-state-metrics', 'namespace': 'observability', 'owner': 'learning-platform-monitoring'}])
assert not ksm_contract([{'name': 'learning-platform-monitoring-kube-state-metrics', 'namespace': 'observability', 'owner': 'learning-platform-monitoring'}, {'name': 'second-kube-state-metrics', 'namespace': 'default', 'owner': 'other'}])
import os
assert all(snapshot['observabilityPodsReady'] for snapshot in json.loads(open(os.environ['POSITIVE']).read())['snapshots'])
PY
  printf '%s\n' 'PASS observability sampler remote transport, restart and pressure fixtures are deterministic'
}
main "$@"
