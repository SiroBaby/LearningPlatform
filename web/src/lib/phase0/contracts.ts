export const phase0DocumentTypes = ["PDF", "TEXT"] as const;

export type Phase0DocumentType = (typeof phase0DocumentTypes)[number];

export const phase0DocumentStatuses = ["UPLOADED", "PROCESSING", "READY", "FAILED"] as const;

export type Phase0DocumentStatus = (typeof phase0DocumentStatuses)[number];

export interface Phase0Document {
  readonly id: string;
  readonly originalName: string;
  readonly type: Phase0DocumentType;
  readonly sizeBytes: number;
  readonly language: string | null;
  readonly status: Phase0DocumentStatus;
  readonly durationSec: number | null;
  readonly pageCount: number | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Phase0UploadUrlRequest {
  readonly originalName: string;
  readonly type: "PDF" | "TEXT";
  readonly sizeBytes: number;
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
  readonly message: string;
}
