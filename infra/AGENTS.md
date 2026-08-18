# Infrastructure Rules

## Scope And Source Of Truth

- These rules apply to infrastructure configuration and validation under `infra/`.
- Observability log processing must preserve the original log transport contract: parse CRI records before downstream processing and keep the complete structured log body available to Loki/Grafana.

## Alloy Log Ingest

- Normalize only known JSON `level` values at ingest to the canonical levels consumed by Grafana (for example `log`/`info` -> `info`, `warn`/`warning` -> `warn`, and `err`/`error`/`fatal`/`critical` -> `error`). Unknown values must not be guessed or rewritten.
- Do not promote JSON `level`, event, job, correlation, or other unbounded fields to Loki labels. Keep only the bounded canonical labels explicitly allowed by the observability contract; Grafana may derive level from the log body.
- Preserve `stage.cri` before JSON-level normalization, and keep normalization scoped to recognized JSON fields so arbitrary message text is not rewritten.

## Validation

- Any Alloy ingest change must update or preserve the static config-contract test. The test must check CRI parsing order, every supported level normalization mapping, unknown-level behavior, and the absence of `level`/correlation fields from Loki labels.
- Run the narrow observability validation for the changed configuration; do not require application or worker tests for documentation-only changes.
