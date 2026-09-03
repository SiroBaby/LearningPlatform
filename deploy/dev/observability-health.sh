#!/usr/bin/env bash
set -Eeuo pipefail

readonly OBSERVABILITY_HEALTH_INTERVAL_SECONDS="${OBSERVABILITY_HEALTH_INTERVAL_SECONDS:-60}"
readonly OBSERVABILITY_HEALTH_SNAPSHOT_COUNT="${OBSERVABILITY_HEALTH_SNAPSHOT_COUNT:-31}"

fail() { printf 'observability health failed: %s\n' "$*" >&2; exit 1; }

validate_artifact() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as artifact_file:
    artifact = json.load(artifact_file)

if artifact.get('schemaVersion') != 1:
    raise ValueError('unsupported health artifact schema')
if artifact.get('status') in {'PASS', 'FAIL'}:
    if artifact.get('transport') != 'remote-script-executed':
        raise ValueError('remote health artifact transport is invalid')
    if [snapshot.get('offsetSeconds') for snapshot in artifact.get('snapshots', [])] != list(range(0, 1801, 60)):
        raise ValueError('remote health artifact cadence is invalid')
elif artifact.get('status') == 'BLOCKED':
    if artifact != {
        'schemaVersion': 1,
        'status': 'BLOCKED',
        'transport': 'ssh-transport-failed',
        'blockedCategory': 'SSH_TRANSPORT_FAILURE',
        'snapshots': [],
    }:
        raise ValueError('blocked health artifact contract is invalid')
else:
    raise ValueError('unsupported health artifact status')
PY
}

write_transport_failure_artifact() {
  local temporary_output="$1"
  printf '%s\n' '{"schemaVersion":1,"status":"BLOCKED","transport":"ssh-transport-failed","blockedCategory":"SSH_TRANSPORT_FAILURE","snapshots":[]}' > "$temporary_output"
  validate_artifact "$temporary_output"
}

remote_probe() {
  cat <<'REMOTE_BASH'
set -Eeuo pipefail
readonly KUBECONFIG=/etc/rancher/k3s/k3s.yaml
readonly OBSERVABILITY_NAMESPACE=observability
readonly APPLICATION_NAMESPACE=learning-platform-dev
readonly INTERVAL_SECONDS=60
readonly SNAPSHOT_COUNT=31
declare -a PORT_FORWARD_PIDS=()
evidence_status=PASS

cleanup() {
  local pid
  for pid in "${PORT_FORWARD_PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT
kubectl_ro() { sudo k3s kubectl --kubeconfig "$KUBECONFIG" "$@"; }
helm_ro() { sudo /usr/local/bin/helm --kubeconfig "$KUBECONFIG" "$@"; }
mark_failed() { evidence_status=FAIL; }
monotonic_seconds() { awk '{print int($1)}' /proc/uptime; }

if [[ "${OBSERVABILITY_HEALTH_TEST_REMOTE:-}" == true ]]; then
  status=PASS
  [[ "${OBSERVABILITY_HEALTH_TEST_RESTART_INCREASE:-false}" == true || "${OBSERVABILITY_HEALTH_TEST_NODE_PRESSURE:-false}" == true || "${OBSERVABILITY_HEALTH_TEST_LATE_POD_NOT_READY:-false}" == true ]] && status=FAIL
  STATUS="$status" PRESSURE="${OBSERVABILITY_HEALTH_TEST_NODE_PRESSURE:-false}" RESTART="${OBSERVABILITY_HEALTH_TEST_RESTART_INCREASE:-false}" LATE_POD="${OBSERVABILITY_HEALTH_TEST_LATE_POD_NOT_READY:-false}" DISK_GI="${OBSERVABILITY_HEALTH_TEST_DISK_GI:-5}" MEM_GI="${OBSERVABILITY_HEALTH_TEST_MEM_GI:-1.5}" \
    python3 -c 'import json,os; disk=float(os.environ["DISK_GI"]); mem=float(os.environ["MEM_GI"]); status=os.environ["STATUS"]; status="FAIL" if status=="FAIL" or disk<5 or mem<1.5 else "PASS"; snapshots=[{"offsetSeconds":i*60,"diskAvailableGi":disk,"memAvailableGi":mem,"nodePressureFree":os.environ.get("PRESSURE")!="true","restartCount":i if os.environ.get("RESTART")=="true" else 0,"observabilityPodsReady":not (os.environ.get("LATE_POD")=="true" and i==30),"pvcUsage":"NOT_OBSERVABLE"} for i in range(31)]; print(json.dumps({"schemaVersion":1,"status":status,"transport":"remote-script-executed","marker":"00000000-0000-4000-8000-000000000001","lokiMarkerLatencySeconds":1,"snapshots":snapshots},separators=(",",":")))'
  exit 0
fi

start_port_forward() {
  kubectl_ro --namespace "$1" port-forward "$2" "$3:$4" >/dev/null 2>&1 &
  PORT_FORWARD_PIDS+=("$!")
  for _ in $(seq 1 20); do curl --silent --max-time 2 --request GET "http://127.0.0.1:$3/" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}
release_contract() {
  helm_ro list --namespace "$OBSERVABILITY_NAMESPACE" --all --output json | python3 -c 'import json,sys; expected={("learning-platform-monitoring","deployed","kube-prometheus-stack-87.21.0"),("learning-platform-loki","deployed","loki-18.7.0"),("learning-platform-alloy","deployed","alloy-1.11.0")}; actual={(x.get("name"),x.get("status"),x.get("chart")) for x in json.load(sys.stdin)}; print(str(actual==expected).lower())'
}
pvc_evidence() {
  local pvcs statefulsets
  pvcs="$(kubectl_ro --namespace "$OBSERVABILITY_NAMESPACE" get pvc -o json)" || { printf '{"valid":false,"claims":[]}'; return; }
  python3 -c 'import json,sys; pvcs=json.loads(sys.argv[1])["items"]; expected={("learning-platform-monitori-prometheus","3Gi"),("learning-platform-monitoring","1Gi"),("learning-platform-loki","2Gi")}; actual={(p.get("metadata",{}).get("labels",{}).get("app.kubernetes.io/instance"),p.get("spec",{}).get("resources",{}).get("requests",{}).get("storage")) for p in pvcs}; valid=len(pvcs)==3 and actual==expected and all(p.get("status",{}).get("phase")=="Bound" and p.get("spec",{}).get("storageClassName")=="local-path" and p.get("metadata",{}).get("uid") and p.get("spec",{}).get("volumeName") for p in pvcs); print(json.dumps({"valid":valid,"claims":[{"name":p["metadata"]["name"],"uid":p["metadata"]["uid"],"owner":p.get("metadata",{}).get("labels",{}).get("app.kubernetes.io/instance"),"size":p.get("spec",{}).get("resources",{}).get("requests",{}).get("storage"),"phase":p.get("status",{}).get("phase"),"storageClass":p.get("spec",{}).get("storageClassName"),"volumeName":p.get("spec",{}).get("volumeName")} for p in pvcs]},separators=(",",":")))' "$pvcs"
}
pods_ready() {
  kubectl_ro --namespace "$OBSERVABILITY_NAMESPACE" get pods -o json | python3 -c 'import json,sys; pods=json.load(sys.stdin)["items"]; required=("prometheus","grafana","loki","alloy","kube-state-metrics"); names=[x["metadata"]["name"] for x in pods]; ready=bool(pods) and all(x.get("status",{}).get("phase")=="Running" and bool(x.get("status",{}).get("containerStatuses")) and all(c.get("ready") for c in x["status"]["containerStatuses"]) for x in pods); print(str(ready and all(any(word in name for name in names) for word in required)).lower())'
}
node_snapshot() {
  local disk mem pressure restarts
  disk="$(df -Pk / | awk 'NR==2 {print $4}')"; mem="$(awk '$1=="MemAvailable:" {print $2}' /proc/meminfo)"
  pressure="$(kubectl_ro get node -o json | python3 -c 'import json,sys; types={"DiskPressure","MemoryPressure","PIDPressure"}; print(str(not any(c.get("type") in types and c.get("status")=="True" for n in json.load(sys.stdin)["items"] for c in n.get("status",{}).get("conditions",[]))).lower())')"
  restarts="$(kubectl_ro --namespace "$OBSERVABILITY_NAMESPACE" get pods -o json | python3 -c 'import json,sys; print(sum(c.get("restartCount",0) for p in json.load(sys.stdin)["items"] for c in p.get("status",{}).get("containerStatuses",[])))')"
  python3 -c 'import json,sys; print(json.dumps({"diskAvailableGi":round(int(sys.argv[1])/1048576,2),"memAvailableGi":round(int(sys.argv[2])/1048576,2),"nodePressureFree":sys.argv[3]=="true","restartCount":int(sys.argv[4])},separators=(",",":")))' "$disk" "$mem" "$pressure" "$restarts"
}

releases="$(release_contract)" || releases=false
pvc_json="$(pvc_evidence)" || pvc_json='{"valid":false,"claims":[]}'
pods="$(pods_ready)" || pods=false
ksm="$(kubectl_ro get deploy --all-namespaces -o json | python3 -c 'import json,sys; items=json.load(sys.stdin)["items"]; matches=[x for x in items if "kube-state-metrics" in x["metadata"]["name"]]; print(str(len(matches)==1 and matches[0]["metadata"].get("namespace")=="observability" and matches[0]["metadata"].get("labels",{}).get("app.kubernetes.io/instance")=="learning-platform-monitoring").lower())' || printf false)"
start_port_forward "$OBSERVABILITY_NAMESPACE" service/prometheus-operated 19090 9090 || mark_failed
start_port_forward "$OBSERVABILITY_NAMESPACE" service/learning-platform-loki 13100 3100 || mark_failed
start_port_forward "$OBSERVABILITY_NAMESPACE" service/learning-platform-monitoring-grafana 13000 80 || mark_failed
start_port_forward "$APPLICATION_NAMESPACE" service/api 13001 3000 || mark_failed
prometheus="$(curl --fail --silent --max-time 10 --request GET 'http://127.0.0.1:19090/api/v1/query?query=up' | python3 -c 'import json,sys; r=json.load(sys.stdin).get("data",{}).get("result",[]); print(str(bool(r) and all(float(x["value"][1])==1 for x in r)).lower())' || printf false)"
marker="$(uuidgen | tr '[:upper:]' '[:lower:]')"; emitted_at="$(date +%s)"; emitted_at_ns="$((emitted_at * 1000000000))"
curl --fail --silent --max-time 10 --request GET -H "x-correlation-id: $marker" http://127.0.0.1:13001/api/v1/health >/dev/null || mark_failed
marker_latency=121
for _ in $(seq 1 12); do
  now_ns="$(( $(date +%s) * 1000000000 ))"; result="$(curl --fail --silent --max-time 10 --request GET --get --data-urlencode "query={namespace=\"$APPLICATION_NAMESPACE\"} |= \"$marker\"" --data-urlencode "start=$emitted_at_ns" --data-urlencode "end=$now_ns" 'http://127.0.0.1:13100/loki/api/v1/query_range' | python3 -c 'import json,sys; d=json.load(sys.stdin); values=[v for r in d.get("data",{}).get("result",[]) for v in r.get("values",[])]; print(min(((int(v[0])-int(sys.argv[1]))//1000000000 for v in values if sys.argv[2] in v[1] and int(sys.argv[1])<=int(v[0])<=int(sys.argv[3])),default=121))' "$emitted_at_ns" "$marker" "$now_ns" || printf 121)"; marker_latency="$result"; (( marker_latency <= 120 )) && break; sleep 10; done
# Grafana enforces its public HTTPS root URL even when accessed through port-forward.
grafana_contract="$(kubectl_ro --namespace "$OBSERVABILITY_NAMESPACE" get secret grafana-admin -o json | python3 -c 'import base64,json,sys,urllib.request; result={"health":False,"datasources":False,"dashboards":0}; s=json.load(sys.stdin)["data"]; token=base64.b64encode(base64.b64decode(s["admin-user"])+b":"+base64.b64decode(s["admin-password"])).decode(); headers={"Authorization":"Basic "+token,"Host":"grafana.sirobabycloud.io.vn","X-Forwarded-Proto":"https"}; get=lambda path: json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:13000"+path,headers=headers),timeout=10));
try: result["health"]=get("/api/health").get("database")=="ok"
except Exception: pass
try:
 ds={x.get("name"):x for x in get("/api/datasources")}; expected={"Prometheus":("prometheus","http://prometheus-operated.observability.svc.cluster.local:9090"),"Loki":("loki","http://learning-platform-loki.observability.svc.cluster.local:3100")}; result["datasources"]=len(ds)>=len(expected) and all(name in ds and (ds[name].get("type"),ds[name].get("url"))==contract and ds[name].get("uid") and get("/api/datasources/uid/%s/health" % ds[name]["uid"]).get("status")=="OK" for name,contract in expected.items())
except Exception: pass
try: result["dashboards"]=sum(x in {x.get("title") for x in get("/api/search?type=dash-db")} for x in {"Kubernetes / Compute Resources / Cluster","Kubernetes / Compute Resources / Node (Pods)","Kubernetes / Compute Resources / Namespace (Pods)","Node Exporter / Nodes"})
except Exception: pass
print(json.dumps(result,separators=(",",":")))' 2>/dev/null || printf '{"health":false,"datasources":false,"dashboards":0}')"
grafana_health="$(python3 -c 'import json,sys; print(str(json.load(sys.stdin)["health"]).lower())' <<<"$grafana_contract")"; datasources="$(python3 -c 'import json,sys; print(str(json.load(sys.stdin)["datasources"]).lower())' <<<"$grafana_contract")"; dashboards="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["dashboards"])' <<<"$grafana_contract")"
snapshots='[]'; initial_restarts=''; next_tick="$(monotonic_seconds)"
for index in $(seq 0 30); do
  snapshot="$(node_snapshot)" || snapshot='{"diskAvailableGi":0,"memAvailableGi":0,"nodePressureFree":false,"restartCount":0}'
  sample_pods="$(pods_ready)" || sample_pods=false
  sample_usage="$(curl --fail --silent --max-time 10 --request GET 'http://127.0.0.1:19090/api/v1/query?query=kubelet_volume_stats_used_bytes' | python3 -c 'import json,sys; r=json.load(sys.stdin).get("data",{}).get("result",[]); print("CAPTURED" if r else "NOT_OBSERVABLE")' || printf NOT_OBSERVABLE)"
  restart="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["restartCount"])' <<<"$snapshot")"; [[ -z "$initial_restarts" ]] && initial_restarts="$restart"
  python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(not (d["diskAvailableGi"]>=5 and d["memAvailableGi"]>=1.5 and d["nodePressureFree"] and d["restartCount"]<=int(sys.argv[1]) and sys.argv[2]=="true"))' "$initial_restarts" "$sample_pods" <<<"$snapshot" || mark_failed
  snapshots="$(python3 -c 'import json,sys; rows=json.load(sys.stdin); row=json.loads(sys.argv[1]); row["offsetSeconds"]=int(sys.argv[2]); row["observabilityPodsReady"]=sys.argv[3]=="true"; row["pvcUsage"]=sys.argv[4]; rows.append(row); print(json.dumps(rows,separators=(",",":")))' "$snapshot" "$((index * INTERVAL_SECONDS))" "$sample_pods" "$sample_usage" <<<"$snapshots")"
  next_tick=$((next_tick + INTERVAL_SECONDS)); delay=$((next_tick - $(monotonic_seconds))); (( index < 30 && delay > 0 )) && sleep "$delay"
done
[[ "$releases" == true && "$(python3 -c 'import json,sys; print(str(json.load(sys.stdin)["valid"]).lower())' <<<"$pvc_json")" == true && "$pods" == true && "$ksm" == true && "$prometheus" == true && "$marker_latency" -le 120 && "$grafana_health" == true && "$datasources" == true && "$dashboards" == 4 ]] || mark_failed
python3 -c 'import json,sys; snapshots=json.loads(sys.argv[12]); print(json.dumps({"schemaVersion":1,"status":sys.argv[1],"transport":"remote-script-executed","marker":sys.argv[2],"lokiMarkerLatencySeconds":int(sys.argv[3]),"releaseContract":sys.argv[4]=="true","pvc":json.loads(sys.argv[5]),"observabilityPodsReady":sys.argv[6]=="true","monitoringOwnedKubeStateMetrics":sys.argv[7]=="true","prometheusUp":sys.argv[8]=="true","grafanaHealthy":sys.argv[9]=="true","grafanaDatasources":sys.argv[10]=="true","grafanaProvisionedDashboards":int(sys.argv[11]),"snapshots":snapshots},separators=(",",":")))' "$evidence_status" "$marker" "$marker_latency" "$releases" "$pvc_json" "$pods" "$ksm" "$prometheus" "$grafana_health" "$datasources" "$dashboards" "$snapshots"
REMOTE_BASH
}

main() {
  local host='' user='' known_hosts='' output='' output_directory='' temporary_output=''
  while (($#)); do case "$1" in --host) host="$2"; shift 2 ;; --user) user="$2"; shift 2 ;; --known-hosts) known_hosts="$2"; shift 2 ;; --output) output="$2"; shift 2 ;; *) fail "unsupported argument: $1" ;; esac; done
  [[ "$host" =~ ^[A-Za-z0-9.-]+$ && "$user" =~ ^[A-Za-z0-9._-]+$ && -n "$output" ]] || fail 'host, user, and output are required'
  [[ "$OBSERVABILITY_HEALTH_INTERVAL_SECONDS" == 60 && "$OBSERVABILITY_HEALTH_SNAPSHOT_COUNT" == 31 ]] || fail 'health cadence must remain T+0 through T+30m at 60s'
  output_directory="$(dirname "$output")"
  [[ -d "$output_directory" ]] || fail 'output directory must exist'
  temporary_output="$(mktemp "$output_directory/.observability-health.XXXXXX")"
  trap 'rm -f -- "${temporary_output:-}"' EXIT
  remote_command="env OBSERVABILITY_HEALTH_TEST_REMOTE=$(printf '%q' "${OBSERVABILITY_HEALTH_TEST_REMOTE:-}") OBSERVABILITY_HEALTH_TEST_RESTART_INCREASE=$(printf '%q' "${OBSERVABILITY_HEALTH_TEST_RESTART_INCREASE:-}") OBSERVABILITY_HEALTH_TEST_NODE_PRESSURE=$(printf '%q' "${OBSERVABILITY_HEALTH_TEST_NODE_PRESSURE:-}") OBSERVABILITY_HEALTH_TEST_LATE_POD_NOT_READY=$(printf '%q' "${OBSERVABILITY_HEALTH_TEST_LATE_POD_NOT_READY:-}") OBSERVABILITY_HEALTH_TEST_DISK_GI=$(printf '%q' "${OBSERVABILITY_HEALTH_TEST_DISK_GI:-}") OBSERVABILITY_HEALTH_TEST_MEM_GI=$(printf '%q' "${OBSERVABILITY_HEALTH_TEST_MEM_GI:-}") env -u BASH_ENV bash --noprofile --norc -se"
  if remote_probe | ssh -o BatchMode=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" "$user@$host" "$remote_command" > "$temporary_output"; then
    validate_artifact "$temporary_output"
    mv -f -- "$temporary_output" "$output"
    temporary_output=''
    return
  fi
  write_transport_failure_artifact "$temporary_output"
  mv -f -- "$temporary_output" "$output"
  temporary_output=''
  return 1
}
main "$@"
