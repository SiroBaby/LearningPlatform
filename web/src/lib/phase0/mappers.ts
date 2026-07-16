import type {
  Phase0AttemptResultItem,
  Phase0AttemptResultResponse,
  Phase0ConfirmDocumentResponse,
  Phase0Document,
  Phase0DocumentQuizResponse,
  Phase0DocumentStatus,
  Phase0DocumentType,
  Phase0CitationLocator,
  Phase0QuizOption,
  Phase0QuizQuestion,
  Phase0QuizResponse,
  Phase0SubmitQuizAttemptResponse,
  Phase0UploadUrlResponse,
} from "@/lib/phase0/contracts";

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected an object response from the Phase 0 API.");
  }
  const entries: readonly (readonly [string, unknown])[] = Object.entries(value);
  return Object.fromEntries(entries);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${field} to be a string.`);
  }
  return value;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Expected ${field} to be a finite number.`);
  }
  return value;
}

function readNullableString(value: unknown, field: string): string | null {
  return value === null ? null : readString(value, field);
}

function readNullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : readNumber(value, field);
}

function readArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected ${field} to be an array.`);
  }
  return value;
}

function readDocumentType(value: unknown): Phase0DocumentType {
  switch (readString(value, "document.type")) {
    case "PDF":
      return "PDF";
    case "TEXT":
      return "TEXT";
    default:
      throw new TypeError("Expected document.type to be PDF or TEXT.");
  }
}

function readDocumentStatus(value: unknown, field: string): Phase0DocumentStatus {
  switch (readString(value, field)) {
    case "UPLOADED":
      return "UPLOADED";
    case "PROCESSING":
      return "PROCESSING";
    case "READY":
      return "READY";
    case "FAILED":
      return "FAILED";
    default:
      throw new TypeError(`Expected ${field} to be a valid document status.`);
  }
}

function mapCitationLocator(value: unknown): Phase0CitationLocator {
  const source = readObject(value);
  switch (readString(source.kind, "result.citation.locator.kind")) {
    case "page":
      return { kind: "page", page: readNumber(source.page, "result.citation.locator.page") };
    case "text-range":
      return {
        kind: "text-range",
        start: readNumber(source.start, "result.citation.locator.start"),
        end: readNumber(source.end, "result.citation.locator.end"),
      };
    case "time":
      return {
        kind: "time",
        startSec: readNumber(source.startSec, "result.citation.locator.startSec"),
        endSec: readNumber(source.endSec, "result.citation.locator.endSec"),
      };
    default:
      throw new TypeError("Expected result.citation.locator.kind to be page, text-range, or time.");
  }
}

function mapDocument(value: unknown): Phase0Document {
  const source = readObject(value);
  return {
    id: readString(source.id, "document.id"),
    originalName: readString(source.originalName, "document.originalName"),
    type: readDocumentType(source.type),
    sizeBytes: readNumber(source.sizeBytes, "document.sizeBytes"),
    language: readNullableString(source.language, "document.language"),
    status: readDocumentStatus(source.status, "document.status"),
    durationSec: readNullableNumber(source.durationSec, "document.durationSec"),
    pageCount: readNullableNumber(source.pageCount, "document.pageCount"),
    errorMessage: readNullableString(source.errorMessage, "document.errorMessage"),
    createdAt: readString(source.createdAt, "document.createdAt"),
    updatedAt: readString(source.updatedAt, "document.updatedAt"),
  };
}

function mapQuizOption(value: unknown): Phase0QuizOption {
  const source = readObject(value);
  return {
    id: readString(source.id, "option.id"),
    optionIndex: readNumber(source.optionIndex, "option.optionIndex"),
    content: readString(source.content, "option.content"),
  };
}

function mapQuizQuestion(value: unknown): Phase0QuizQuestion {
  const source = readObject(value);
  return {
    id: readString(source.id, "question.id"),
    ordinal: readNumber(source.ordinal, "question.ordinal"),
    stem: readString(source.stem, "question.stem"),
    options: readArray(source.options, "question.options").map(mapQuizOption),
  };
}

function mapAttemptResultItem(value: unknown): Phase0AttemptResultItem {
  const source = readObject(value);
  const citation = readObject(source.citation);
  if (typeof source.isCorrect !== "boolean") {
    throw new TypeError("Expected result.isCorrect to be a boolean.");
  }
  return {
    questionId: readString(source.questionId, "result.questionId"),
    ordinal: readNumber(source.ordinal, "result.ordinal"),
    stem: readString(source.stem, "result.stem"),
    selectedOptionId: readString(source.selectedOptionId, "result.selectedOptionId"),
    selectedOptionContent: readString(source.selectedOptionContent, "result.selectedOptionContent"),
    correctOptionId: readString(source.correctOptionId, "result.correctOptionId"),
    correctOptionContent: readString(source.correctOptionContent, "result.correctOptionContent"),
    isCorrect: source.isCorrect,
    explanation: readString(source.explanation, "result.explanation"),
    citation: {
      chunkId: readString(citation.chunkId, "result.citation.chunkId"),
      locator: mapCitationLocator(citation.locator),
      snippet: readString(citation.snippet, "result.citation.snippet"),
    },
  };
}

export function mapDocumentsResponse(value: unknown): readonly Phase0Document[] {
  return readArray(value, "documents").map(mapDocument);
}

export function mapDocumentResponse(value: unknown): Phase0Document {
  return mapDocument(value);
}

export function mapUploadUrlResponse(value: unknown): Phase0UploadUrlResponse {
  const source = readObject(value);
  const uploadFields = readObject(source.uploadFields);
  const mappedFields: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(uploadFields)) {
    mappedFields[key] = readString(fieldValue, `uploadFields.${key}`);
  }
  return {
    documentId: readString(source.documentId, "documentId"),
    uploadUrl: readString(source.uploadUrl, "uploadUrl"),
    uploadFields: mappedFields,
    expirySec: readNumber(source.expirySec, "expirySec"),
  };
}

export function mapConfirmDocumentResponse(value: unknown): Phase0ConfirmDocumentResponse {
  const source = readObject(value);
  return {
    documentId: readString(source.documentId, "documentId"),
    status: readDocumentStatus(source.status, "status"),
  };
}

export function mapDocumentQuizResponse(value: unknown): Phase0DocumentQuizResponse {
  const source = readObject(value);
  return {
    quizId: readString(source.quizId, "quizId"),
    documentId: readString(source.documentId, "documentId"),
    questionCount: readNumber(source.questionCount, "questionCount"),
  };
}

export function mapQuizResponse(value: unknown): Phase0QuizResponse {
  const source = readObject(value);
  return {
    id: readString(source.id, "quiz.id"),
    questions: readArray(source.questions, "quiz.questions").map(mapQuizQuestion),
  };
}

export function mapSubmitQuizAttemptResponse(value: unknown): Phase0SubmitQuizAttemptResponse {
  const source = readObject(value);
  return {
    attemptId: readString(source.attemptId, "attemptId"),
    score: readNumber(source.score, "score"),
    questionCount: readNumber(source.questionCount, "questionCount"),
  };
}

export function mapAttemptResultResponse(value: unknown): Phase0AttemptResultResponse {
  const source = readObject(value);
  return {
    attemptId: readString(source.attemptId, "attemptId"),
    quizId: readString(source.quizId, "quizId"),
    submittedAt: readString(source.submittedAt, "submittedAt"),
    score: readNumber(source.score, "score"),
    questionCount: readNumber(source.questionCount, "questionCount"),
    results: readArray(source.results, "results").map(mapAttemptResultItem),
  };
}
