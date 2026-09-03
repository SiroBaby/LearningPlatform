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

## Validation

- Any Alloy ingest change must update or preserve the static config-contract test. The test must check CRI parsing order, every supported level normalization mapping, unknown-level behavior, and the absence of `level`/correlation fields from Loki labels.
- Run the narrow observability validation for the changed configuration; do not require application or worker tests for documentation-only changes.
