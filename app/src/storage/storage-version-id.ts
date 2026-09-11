/**
 * Normalizes a provider version identifier and rejects placeholder values.
 * A literal "null" is not an immutable object version.
 */
export function normalizeStorageVersionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized === '' || normalized.toLowerCase() === 'null') return undefined;
  return normalized;
}
