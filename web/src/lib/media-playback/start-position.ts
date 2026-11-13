const NON_NEGATIVE_INTEGER_PATTERN = /^\d{1,9}$/u;

/** Reads the `?t=` query value as a whole second, clamped to the media duration when it is known. */
export function parseStartSec(
  rawValue: string | readonly string[] | undefined,
  durationSec: number | null,
): number | undefined {
  const value = typeof rawValue === "string" ? rawValue : undefined;
  if (value === undefined || !NON_NEGATIVE_INTEGER_PATTERN.test(value)) return undefined;
  const startSec = Number(value);
  if (durationSec === null || !Number.isFinite(durationSec)) return startSec;
  return Math.min(startSec, Math.max(0, Math.floor(durationSec)));
}
