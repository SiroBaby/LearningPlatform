# AI Worker Bootstrap

This bootstrap validates the `document.processing.requested` v1 envelope and
serves health endpoints. It does not receive or acknowledge deliveries.

The PostgreSQL handoff, durable replay source, idempotency, and attempt/lease
fence must be implemented at the persistence boundary in issue #21. Until
then, this worker intentionally performs no durable delivery or deduplication;
it must not be used to claim ADR-0023 at-least-once guarantees.

Set `AI_WORKER_HEALTH_ADDRESS` to a valid `host:port`. `/healthz` reports that
the health server is running. `/readyz` reports ready only after the bootstrap
consumer lifecycle has started.
