import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ExtractionError } from './contracts/extraction-error';

export const QuizGenerationErrorCode = {
  INSUFFICIENT_VALID_QUESTIONS: DocumentProcessingFailureCode.INSUFFICIENT_VALID_QUESTIONS,
  GENERATION_OUTPUT_INVALID: DocumentProcessingFailureCode.GENERATION_OUTPUT_INVALID,
  GENERATION_OUTPUT_TRUNCATED: DocumentProcessingFailureCode.GENERATION_OUTPUT_TRUNCATED,
} as const;

export type QuizGenerationErrorCode =
  (typeof QuizGenerationErrorCode)[keyof typeof QuizGenerationErrorCode];

export class QuizGenerationError extends ExtractionError {
  constructor(readonly code: QuizGenerationErrorCode) {
    super(code);
    this.name = 'QuizGenerationError';
  }
}
