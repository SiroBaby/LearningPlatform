const MAX_ERROR_TEXT_LENGTH = 512;

export interface SafeBackendError {
  readonly code?: string;
  readonly message: string;
  readonly retryable?: boolean;
}

export function sanitizeBackendErrorText(value: string): string {
  const compactValue = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127) ? " " : character;
  }).join("").trim();
  return compactValue.slice(0, MAX_ERROR_TEXT_LENGTH) || "The Phase 0 API request failed.";
}

export function mapSafeBackendError(value: unknown): SafeBackendError | null {
  if (typeof value === "string") {
    return { message: sanitizeBackendErrorText(value) };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const source = Object.fromEntries(Object.entries(value));
  const message = source.message;
  const error: SafeBackendError = {
    message: typeof message === "string"
      ? sanitizeBackendErrorText(message)
      : Array.isArray(message) && message.every((entry) => typeof entry === "string")
        ? sanitizeBackendErrorText(message.join(" "))
        : "The Phase 0 API request failed.",
  };
  if (typeof source.code !== "string") {
    return error;
  }
  return {
    ...error,
    code: sanitizeBackendErrorText(source.code),
    ...(typeof source.retryable === "boolean" ? { retryable: source.retryable } : {}),
  };
}
