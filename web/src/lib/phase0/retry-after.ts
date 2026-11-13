const MAX_PASSTHROUGH_RETRY_AFTER_SEC = 3600;
const MILLISECONDS_PER_SECOND = 1000;
const DELTA_SECONDS_PATTERN = /^\d{1,7}$/u;
const IMF_FIXDATE_PATTERN = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u;

/** Reads `Retry-After` (delta-seconds or HTTP-date) into whole seconds; null when absent or malformed. */
export function parseRetryAfterSeconds(rawValue: string | null, nowMs: number): number | null {
  const value = rawValue?.trim() ?? "";
  if (value === "") return null;
  if (DELTA_SECONDS_PATTERN.test(value)) return Number(value);
  if (!IMF_FIXDATE_PATTERN.test(value)) return null;
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, Math.ceil((dateMs - nowMs) / MILLISECONDS_PER_SECOND));
}

/** The only response header the BFF forwards from a backend error: a validated, normalized `Retry-After`. */
export function readPassthroughErrorHeaders(headers: Headers, nowMs: number): Record<string, string> {
  const seconds = parseRetryAfterSeconds(headers.get("retry-after"), nowMs);
  if (seconds === null) return {};
  return { "Retry-After": String(Math.min(seconds, MAX_PASSTHROUGH_RETRY_AFTER_SEC)) };
}
