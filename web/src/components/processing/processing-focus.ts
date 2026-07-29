export function shouldRestoreRetryFocus({
  previousRetryError,
  retryError,
  isRetrySubmitting,
}: {
  previousRetryError: string | null;
  retryError: string | null;
  isRetrySubmitting: boolean;
}): boolean {
  return previousRetryError === null && retryError !== null && !isRetrySubmitting;
}
