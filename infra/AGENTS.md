# Infrastructure Rules

## Scope And Source Of Truth

- These rules apply to infrastructure configuration and validation under `infra/`.
- Observability log processing must preserve the original log transport contract: parse CRI records before downstream processing and keep the complete structured log body available to Loki/Grafana.

## Alloy Log Ingest

- Normalize only known JSON `level` values at ingest to the canonical levels consumed by Grafana (for example `log`/`info` -> `info`, `warn`/`warning` -> `warn`, and `err`/`error`/`fatal`/`critical` -> `error`). Unknown values must not be guessed or rewritten.
- Do not promote JSON `level`, event, job, correlation, or other unbounded fields to Loki labels. Keep only the bounded canonical labels explicitly allowed by the observability contract; Grafana may derive level from the log body.
- Preserve `stage.cri` before JSON-level normalization, and keep normalization scoped to recognized JSON fields so arbitrary message text is not rewritten.

## Alertmanager Routing

- Keep `InfoInhibitor` and `Watchdog` in the first child route to the credential-free null receiver; do not let either control alert reach Telegram/VaaBot.
- Keep `severity=info` on the existing Telegram receiver only as a long-interval digest when no separate safe low-priority receiver exists; warning and critical alerts remain on the actionable default route.
- Inhibit only `severity=info` from a source with `severity=warning|critical`, requiring equal `namespace` and `cluster` labels; never inhibit warning or critical alerts.
- Preserve the `alertmanager-telegram-config` Secret and its two SSM-backed placeholders; never add raw Telegram credentials to source or validation output.

## Loki Alert Rules

- Keep the Loki ruler inside the monolithic pod: `ruler.enabled: true` with `ruler.replicas: 0`, local rule storage at `/etc/loki/rules`, rules from the `learning-platform-loki-alert-rules` ConfigMap mounted read-only at `/etc/loki/rules/fake`, and `alertmanager_url` pinned to the in-cluster Alertmanager. Do not add a rules sidecar or a separate ruler workload without updating the CPU budget.
- Any new or changed Loki or application Prometheus alert must update the exact contract in `validate-rendered-observability.rb` and add a negative fixture case; prove a new LogQL rule loads (`health: ok`) and fires on a pinned Loki binary before merge.
- Extract the specific field a LogQL rule needs from Nest JSON logs (`| json field="message.field"`), never bare `| json`: every line carries its own `timestamp`/`pid`, which become labels and turn each line into its own series, so `last_over_time` returns every sample in the window like `max_over_time`. A heartbeat-missing rule must be built on the heartbeat itself over a window longer than the emit interval (and must count the failure event too), exclude an intentional shutdown, and be proven on the pinned Loki binary not to fire when the workload is disabled.

## Validation

- Any Alloy ingest change must update or preserve the static config-contract test. The test must check CRI parsing order, every supported level normalization mapping, unknown-level behavior, and the absence of `level`/correlation fields from Loki labels.
- Run the narrow observability validation for the changed configuration; do not require application or worker tests for documentation-only changes.

## K3s Node

- Keep kubelet image GC in the managed K3s config (`roles/k3s/defaults/main.yml`): the high threshold must leave at least `k3s_image_gc_minimum_free_disk_gib` free on `/` (above the 11Gi observability capacity gate), asserted against the root mount size before the config is written. Do not rely on kubelet defaults (85/80) or manual `crictl rmi --prune` to keep deploys unblocked.
- Every `kubelet-arg` must be a real command-line flag of the kubelet embedded in the pinned `k3s_version` and listed in `roles/k3s/tests/kubelet-args-contract.yml`; a field that exists only in `KubeletConfiguration` (for example `imageMaximumGCAge`) is an unknown flag and makes K3s exit on restart. Re-verify the allowlist against the K3s binary when `k3s_version` changes.
- A K3s config change must restart K3s inside the k3s role (`meta: flush_handlers`) and wait for `/readyz` before later roles call the API; the single site play would otherwise restart K3s after workloads were applied.

## Application Rollout

- When `infra/k8s/apps.yaml.j2` conditionally renders a Deployment for a selected application target, update workflow rollout target derivation and failure diagnostics to wait for that exact Deployment; keep optional image validation conditional on the target and cover both paths with static and execution regressions.
- The dev node has 2000m allocatable CPU. Any new application workload or CPU request change must keep `roles/applications/tests/cpu-request-budget-contract.yml` passing (app requests × replicas, plus maxSurge pods for any RollingUpdate Deployment, plus the largest app pod as buffer). Platform requests are read from their repo sources (observability Helm values, the cert-manager resource patch); pods without a repo manifest (k3s coredns/metrics-server/traefik/local-path, external-secrets) are literals pinned to `k3s_version` and the external-secrets manifest checksum. Re-read those sources and update the reviewed totals deliberately; never loosen the budget to hide a Pending rollout.
- When a flag turns an application workload off, delete its Deployment with `propagationPolicy: Foreground` and wait until no pod with its component label remains before deleting its NetworkPolicies, ServiceAccount or runtime ExternalSecret. The namespace has no default-deny policy, so removing the policy first leaves a still-running pod with its credentials and unrestricted egress. Delete only exact allowlisted names, and read back any shared policy whose client list the flag edits.
- When a flag adds a workload as a client of another component's NetworkPolicy (for example a podSelector in `media-egress-proxy-ingress`), render the whole workload block after that policy in `apps.yaml.j2`. The main apply does not wait between documents, so a Deployment listed before the shared policy can start, fail its preflight on a denied connection, and restart. Assert the order on the rendered manifests (Ansible) and in `validate.sh`.
