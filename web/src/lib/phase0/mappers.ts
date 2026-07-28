import type {
  Phase0AttemptResultItem,
  Phase0AttemptResultResponse,
  Phase0BudgetStatus,
  Phase0CitationLocator,
  Phase0ConfirmDocumentResponse,
  Phase0Document,
  Phase0DocumentProcessingFailureCode,
  Phase0DocumentQuizResponse,
  Phase0DocumentStatus,
  Phase0DocumentType,
  Phase0EstimatePrecision,
  Phase0EstimateResponse,
  Phase0ModelOption,
  Phase0ModelSelectionKind,
  Phase0PracticeFeedbackResponse,
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

function readModelSelectionKind(value: unknown, field: string): Phase0ModelSelectionKind {
  switch (readString(value, field)) {
    case "PLAN":
      return "PLAN";
    case "CUSTOM":
      return "CUSTOM";
    default:
      throw new TypeError(`Expected ${field} to be PLAN or CUSTOM.`);
  }
}

function readNullableModelSelectionKind(value: unknown, field: string): Phase0ModelSelectionKind | null {
  return value === null ? null : readModelSelectionKind(value, field);
}

function readEstimatePrecision(value: unknown, field: string): Phase0EstimatePrecision {
  switch (readString(value, field)) {
    case "COARSE":
      return "COARSE";
    case "AUTHORITATIVE":
      return "AUTHORITATIVE";
    default:
      throw new TypeError(`Expected ${field} to be COARSE or AUTHORITATIVE.`);
  }
}

function readNullableEstimatePrecision(value: unknown, field: string): Phase0EstimatePrecision | null {
  return value === null ? null : readEstimatePrecision(value, field);
}

function readBudgetStatus(value: unknown, field: string): Phase0BudgetStatus {
  switch (readString(value, field)) {
    case "NOT_RESERVED":
      return "NOT_RESERVED";
    case "CUSTOM_ZERO_COST":
      return "CUSTOM_ZERO_COST";
    case "SETTLED":
      return "SETTLED";
    case "HELD":
      return "HELD";
    case "EXHAUSTED":
      return "EXHAUSTED";
    default:
      throw new TypeError(`Expected ${field} to be a valid budget status.`);
  }
}

function readNullableBudgetStatus(value: unknown, field: string): Phase0BudgetStatus | null {
  return value === null ? null : readBudgetStatus(value, field);
}

function readDocumentProcessingFailureCode(
  value: unknown,
  field: string,
): Phase0DocumentProcessingFailureCode {
  switch (readString(value, field)) {
    case "BUDGET_EXHAUSTED":
      return "BUDGET_EXHAUSTED";
    case "CHUNK_RESOURCE_LIMIT_EXCEEDED":
      return "CHUNK_RESOURCE_LIMIT_EXCEEDED";
    case "EXTRACTION_OBJECT_NOT_FOUND":
      return "EXTRACTION_OBJECT_NOT_FOUND";
    case "EXTRACTION_OBJECT_TOO_LARGE":
      return "EXTRACTION_OBJECT_TOO_LARGE";
    case "GENERATION_OUTPUT_INVALID":
      return "GENERATION_OUTPUT_INVALID";
    case "INSUFFICIENT_VALID_QUESTIONS":
      return "INSUFFICIENT_VALID_QUESTIONS";
    case "PDF_INVALID":
      return "PDF_INVALID";
    case "PDF_TEXT_NOT_FOUND":
      return "PDF_TEXT_NOT_FOUND";
    case "PROCESSING_FAILED":
      return "PROCESSING_FAILED";
    case "PROCESSING_TIMED_OUT":
      return "PROCESSING_TIMED_OUT";
    case "PROVIDER_UNAVAILABLE":
      return "PROVIDER_UNAVAILABLE";
    default:
      throw new TypeError(`Expected ${field} to be a valid document processing failure code.`);
  }
}

function readNullableDocumentProcessingFailureCode(
  value: unknown,
  field: string,
): Phase0DocumentProcessingFailureCode | null {
  return value === null ? null : readDocumentProcessingFailureCode(value, field);
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
    errorCode: readNullableDocumentProcessingFailureCode(source.errorCode, "document.errorCode"),
    errorMessage: readNullableString(source.errorMessage, "document.errorMessage"),
    selectedModelKind: readNullableModelSelectionKind(source.selectedModelKind, "document.selectedModelKind"),
    selectedModelLabel: readNullableString(source.selectedModelLabel, "document.selectedModelLabel"),
    estimateStatus: readNullableEstimatePrecision(source.estimateStatus, "document.estimateStatus"),
    estimatedCredits: readNullableNumber(source.estimatedCredits, "document.estimatedCredits"),
    settledCredits: readNullableNumber(source.settledCredits, "document.settledCredits"),
    budgetStatus: readNullableBudgetStatus(source.budgetStatus, "document.budgetStatus"),
    createdAt: readString(source.createdAt, "document.createdAt"),
    updatedAt: readString(source.updatedAt, "document.updatedAt"),
  };
}

function mapModelOption(value: unknown): Phase0ModelOption {
  const source = readObject(value);
  const kind = readModelSelectionKind(source.kind, "model.kind");
  const mapped = {
    id: readString(source.id, "model.id"),
    kind,
    label: readString(source.label, "model.label"),
  };

  if ("apiKey" in source || "baseUrl" in source || "apiKeyCiphertext" in source) {
    throw new TypeError("Model option payload contains unsupported private fields.");
  }

  return mapped;
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

export function mapModelOptionsResponse(value: unknown): readonly Phase0ModelOption[] {
  return readArray(value, "models").map(mapModelOption);
}

export function mapEstimateResponse(value: unknown): Phase0EstimateResponse {
  const source = readObject(value);
  return {
    estimatedCredits: readNumber(source.estimatedCredits, "estimatedCredits"),
    precision: readEstimatePrecision(source.precision, "precision"),
    selectedModelKind: readModelSelectionKind(source.selectedModelKind, "selectedModelKind"),
    selectedModelLabel: readString(source.selectedModelLabel, "selectedModelLabel"),
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

export function mapPracticeFeedbackResponse(value: unknown): Phase0PracticeFeedbackResponse {
  const source = readObject(value);
  const citation = readObject(source.citation);
  if (typeof source.isCorrect !== "boolean") {
    throw new TypeError("Expected practiceFeedback.isCorrect to be a boolean.");
  }
  return {
    questionId: readString(source.questionId, "practiceFeedback.questionId"),
    selectedOptionId: readString(source.selectedOptionId, "practiceFeedback.selectedOptionId"),
    isCorrect: source.isCorrect,
    explanation: readString(source.explanation, "practiceFeedback.explanation"),
    citation: {
      chunkId: readString(citation.chunkId, "practiceFeedback.citation.chunkId"),
      locator: mapCitationLocator(citation.locator),
      snippet: readString(citation.snippet, "practiceFeedback.citation.snippet"),
    },
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
