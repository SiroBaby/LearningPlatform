/** Decides what the learner can do after the subtitle preview request failed. */

export interface PreviewFailureLike {
  readonly code?: string;
  readonly status?: number;
  readonly retryable?: boolean;
}

/** "retry": the same document can be previewed again. "change-file": the subtitle itself must change. */
export type PreviewFailureAction = "retry" | "change-file";

const STATUS_BAD_REQUEST = 400;
const STATUS_CONFLICT = 409;
const STATUS_SERVER_ERROR = 500;
const STATUS_REQUEST_TIMEOUT = 408;
const STATUS_TOO_MANY_REQUESTS = 429;

/** Parse errors and rejected states will fail again unchanged; timeouts, transport and server errors may not. */
export function decidePreviewFailureAction(failure: PreviewFailureLike): PreviewFailureAction {
  if (failure.retryable === true) return "retry";
  if (failure.code === "REQUEST_TIMEOUT") return "retry";
  const { status } = failure;
  if (status === undefined || status === 0) return "retry";
  if (status === STATUS_REQUEST_TIMEOUT || status === STATUS_TOO_MANY_REQUESTS || status >= STATUS_SERVER_ERROR) return "retry";
  if (status === STATUS_BAD_REQUEST || status === STATUS_CONFLICT) return "change-file";
  return "change-file";
}
