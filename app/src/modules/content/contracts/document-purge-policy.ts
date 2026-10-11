/**
 * Extra wait after the presigned upload expiry before the first purge
 * attempt, covering clock skew between the API, database and storage.
 */
export const PRESIGNED_UPLOAD_CLOCK_SKEW_SECONDS = 60;
const MILLISECONDS_PER_SECOND = 1_000;

/**
 * Earliest purge time for a deleted Document: a presigned upload issued just
 * before deletion can no longer create bytes once its expiry has passed.
 */
export function calculatePurgeNotBefore(now: Date, presignExpirySeconds: number): Date {
  const delaySeconds = presignExpirySeconds + PRESIGNED_UPLOAD_CLOCK_SKEW_SECONDS;
  return new Date(now.getTime() + delaySeconds * MILLISECONDS_PER_SECOND);
}
