# Issue #19: mTLS and lease-authority foundation

## Scope delivered in this slice

- cert-manager `v1.16.2` is reconciled from its official SHA-256-pinned
  manifest. Its aggregate requests are `250m` CPU and `256Mi` memory.
- cert-manager generates the namespace-scoped internal CA and the short-lived
  `api-internal` server and `go-worker` client certificates. No private key is
  stored in Git.
- `api-internal` is a `ClusterIP` service on TLS port `3443`; it has no
  Traefik rule. The public API ingress is constrained to `/api/v1`.
- The AI-owned route `POST /internal/v1/lease-authority/validate` requires a
  verified client certificate with the exact `go-worker` SPIFFE URI SAN,
  `audience=ai-internal`, and `scope=lease.validate`.
- The authority returns `valid: false` until the future durable lease
  persistence from Issue #20 exists. This is intentionally deny-by-default.

## Migration boundary

No current Content or Assessment code reads `ai` schema through this route or
changes its user flow. No Go pipeline, worker image, queue consumer, lease
migration, traffic cutover, public ingress, or production deployment is part
of this slice. A later migration must implement the AI-owned durable lease
store, make the Go client use its mounted certificate with reload-on-rotation,
then migrate one fenced finalization path under an explicit rollout plan.

## Deployment verification (human-operated)

1. Run the reviewed Ansible playbook with `cert_manager` before
   `applications`; do not apply manifests manually.
2. Confirm all three cert-manager deployments are available and both
   `Certificate` resources `api-internal` and `go-worker` are `Ready=True`.
3. Confirm `api-internal` is `ClusterIP` on `3443`, absent from every
   `Ingress`, and its API pod only mounts `api-internal-tls` read-only.
4. From the future `go-worker` pod, call the internal route with its mounted
   client certificate: wrong/missing client certificates, URI SAN, audience,
   scope, or stale fence must be rejected; the current valid identity response
   remains `{"valid":false}` until the lease store lands.
