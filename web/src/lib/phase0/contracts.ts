export const phase0DocumentTypes = ["PDF", "TEXT"] as const;

export type Phase0DocumentType = (typeof phase0DocumentTypes)[number];

export const phase0DocumentStatuses = ["UPLOADED", "PROCESSING", "READY", "FAILED"] as const;

export type Phase0DocumentStatus = (typeof phase0DocumentStatuses)[number];

export const phase0ModelSelectionKinds = ["PLAN", "CUSTOM"] as const;

export type Phase0ModelSelectionKind = (typeof phase0ModelSelectionKinds)[number];

export const phase0EstimatePrecisionLevels = ["COARSE", "AUTHORITATIVE"] as const;

export type Phase0EstimatePrecision = (typeof phase0EstimatePrecisionLevels)[number];

export const phase0BudgetStatuses = [
  "NOT_RESERVED",
  "CUSTOM_ZERO_COST",
  "SETTLED",
  "HELD",
  "EXHAUSTED",
] as const;

export type Phase0BudgetStatus = (typeof phase0BudgetStatuses)[number];

export const phase0DocumentProcessingFailureCodes = [
  "BUDGET_EXHAUSTED",
  "CHUNK_RESOURCE_LIMIT_EXCEEDED",
  "EXTRACTION_OBJECT_NOT_FOUND",
  "EXTRACTION_OBJECT_TOO_LARGE",
  "GENERATION_OUTPUT_INVALID",
  "INSUFFICIENT_VALID_QUESTIONS",
  "PDF_INVALID",
  "PDF_TEXT_NOT_FOUND",
  "PROCESSING_FAILED",
  "PROCESSING_TIMED_OUT",
  "PROVIDER_UNAVAILABLE",
] as const;

export type Phase0DocumentProcessingFailureCode =
  (typeof phase0DocumentProcessingFailureCodes)[number];

export interface Phase0Document {
  readonly id: string;
  readonly originalName: string;
  readonly type: Phase0DocumentType;
  readonly sizeBytes: number;
  readonly language: string | null;
  readonly status: Phase0DocumentStatus;
  readonly durationSec: number | null;
  readonly pageCount: number | null;
  readonly errorCode: Phase0DocumentProcessingFailureCode | null;
  readonly errorMessage: string | null;
  readonly selectedModelKind: Phase0ModelSelectionKind | null;
  readonly selectedModelLabel: string | null;
  readonly estimateStatus: Phase0EstimatePrecision | null;
  readonly estimatedCredits: number | null;
  readonly settledCredits: number | null;
  readonly budgetStatus: Phase0BudgetStatus | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Phase0PlanModelOption {
  readonly id: string;
  readonly kind: "PLAN";
  readonly label: string;
}

export interface Phase0CustomModelOption {
  readonly id: string;
  readonly kind: "CUSTOM";
  readonly label: string;
}

export type Phase0ModelOption = Phase0PlanModelOption | Phase0CustomModelOption;

export type Phase0UploadModelSelection =
  | {
      readonly modelSelectionKind: "PLAN";
      readonly platformModelId: string;
      readonly customModelConfigId?: never;
    }
  | {
      readonly modelSelectionKind: "CUSTOM";
      readonly customModelConfigId: string;
      readonly platformModelId?: never;
    };

export type Phase0UploadUrlRequest = {
  readonly originalName: string;
  readonly type: "PDF" | "TEXT";
  readonly sizeBytes: number;
} & Phase0UploadModelSelection;

export type Phase0EstimateRequest = {
  readonly type: "PDF" | "TEXT";
  readonly sizeBytes: number;
} & Phase0UploadModelSelection;

export interface Phase0EstimateResponse {
  readonly estimatedCredits: number;
  readonly precision: Phase0EstimatePrecision;
  readonly selectedModelKind: Phase0ModelSelectionKind;
  readonly selectedModelLabel: string;
}

export interface Phase0ModelOptionGroup {
  readonly kind: Phase0ModelSelectionKind;
  readonly title: string;
  readonly description: string;
  readonly options: readonly Phase0ModelOption[];
}

export interface Phase0UploadUrlResponse {
  readonly documentId: string;
  readonly uploadUrl: string;
  readonly uploadFields: Readonly<Record<string, string>>;
  readonly expirySec: number;
}

export interface Phase0ConfirmDocumentResponse {
  readonly documentId: string;
  readonly status: Phase0DocumentStatus;
}

export interface Phase0DocumentQuizResponse {
  readonly quizId: string;
  readonly documentId: string;
  readonly questionCount: number;
}

export interface Phase0QuizOption {
  readonly id: string;
  readonly optionIndex: number;
  readonly content: string;
}

export interface Phase0QuizQuestion {
  readonly id: string;
  readonly ordinal: number;
  readonly stem: string;
  readonly options: readonly Phase0QuizOption[];
}

export interface Phase0QuizResponse {
  readonly id: string;
  readonly questions: readonly Phase0QuizQuestion[];
}

export interface Phase0SubmitQuizAttemptRequest {
  readonly answers: readonly {
    readonly questionId: string;
    readonly optionId: string;
  }[];
}

export interface Phase0PracticeFeedbackRequest {
  readonly questionId: string;
  readonly optionId: string;
}

export interface Phase0PracticeFeedbackResponse {
  readonly questionId: string;
  readonly selectedOptionId: string;
  readonly isCorrect: boolean;
  readonly explanation: string;
  readonly citation: {
    readonly chunkId: string;
    readonly locator: Phase0CitationLocator;
    readonly snippet: string;
  };
}

export interface Phase0SubmitQuizAttemptResponse {
  readonly attemptId: string;
  readonly score: number;
  readonly questionCount: number;
}

export interface Phase0AttemptResultItem {
  readonly questionId: string;
  readonly ordinal: number;
  readonly stem: string;
  readonly selectedOptionId: string;
  readonly selectedOptionContent: string;
  readonly correctOptionId: string;
  readonly correctOptionContent: string;
  readonly isCorrect: boolean;
  readonly explanation: string;
  readonly citation: {
    readonly chunkId: string;
    readonly locator: Phase0CitationLocator;
    readonly snippet: string;
  };
}

export type Phase0CitationLocator =
  | Phase0PageLocator
  | Phase0TextRangeLocator
  | Phase0TimeLocator;

interface Phase0PageLocator {
  readonly kind: "page";
  readonly page: number;
}

interface Phase0TextRangeLocator {
  readonly kind: "text-range";
  readonly start: number;
  readonly end: number;
}

interface Phase0TimeLocator {
  readonly kind: "time";
  readonly startSec: number;
  readonly endSec: number;
}

export interface Phase0AttemptResultResponse {
  readonly attemptId: string;
  readonly quizId: string;
  readonly submittedAt: string;
  readonly score: number;
  readonly questionCount: number;
  readonly results: readonly Phase0AttemptResultItem[];
}

export interface Phase0ApiError {
  readonly code?: string;
  readonly message: string;
  readonly retryable?: boolean;
}
