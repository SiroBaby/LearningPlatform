export const AssessmentErrorCode = {
  IDEMPOTENCY_OWNER_CONFLICT: 'IDEMPOTENCY_OWNER_CONFLICT',
  INSUFFICIENT_VALID_QUESTIONS: 'INSUFFICIENT_VALID_QUESTIONS',
} as const;

export type AssessmentErrorCode =
  (typeof AssessmentErrorCode)[keyof typeof AssessmentErrorCode];

export class AssessmentError extends Error {
  constructor(
    readonly code: AssessmentErrorCode,
    readonly acceptedQuestionCount?: number,
    readonly totalQuestionCount?: number,
  ) {
    super(code);
    this.name = AssessmentError.name;
  }
}
