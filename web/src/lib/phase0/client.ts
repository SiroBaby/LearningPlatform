import type {
  Phase0AttemptResultResponse,
  Phase0ConfirmDocumentResponse,
  Phase0Document,
  Phase0DocumentQuizResponse,
  Phase0EstimateRequest,
  Phase0EstimateResponse,
  Phase0ModelOption,
  Phase0PracticeFeedbackRequest,
  Phase0PracticeFeedbackResponse,
  Phase0QuizResponse,
  Phase0SubmitQuizAttemptRequest,
  Phase0SubmitQuizAttemptResponse,
  Phase0UploadUrlRequest,
  Phase0UploadUrlResponse,
} from "@/lib/phase0/contracts";
import {
  mapAttemptResultResponse,
  mapConfirmDocumentResponse,
  mapDocumentsResponse,
  mapDocumentQuizResponse,
  mapDocumentResponse,
  mapEstimateResponse,
  mapModelOptionsResponse,
  mapPracticeFeedbackResponse,
  mapQuizResponse,
  mapSubmitQuizAttemptResponse,
  mapUploadUrlResponse,
} from "@/lib/phase0/mappers";

export class Phase0ClientError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "Phase0ClientError";
    this.status = status;
  }
}

function readErrorMessage(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const message = Object.entries(value).find(([key]) => key === "message")?.[1];
    if (typeof message === "string") {
      return message;
    }
  }
  return "The Phase 0 API request failed.";
}

async function readResponseBody(response: Response): Promise<unknown> {
  const responseText = await response.text();
  if (responseText.length === 0) {
    return null;
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return responseText;
  }
  try {
    const parsed: unknown = JSON.parse(responseText);
    return parsed;
  } catch {
    return responseText;
  }
}

async function requestPhase0Api<T>(
  path: string,
  method: "GET" | "POST",
  mapResponse: (value: unknown) => T,
  body?: unknown,
): Promise<T> {
  const headers = body === undefined ? undefined : { "Content-Type": "application/json" };
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    throw new Phase0ClientError(response.status, readErrorMessage(responseBody));
  }
  return mapResponse(responseBody);
}

export function getPhase0Documents(): Promise<readonly Phase0Document[]> {
  return requestPhase0Api("/api/phase0/documents", "GET", mapDocumentsResponse);
}

export function getPhase0Document(documentId: string): Promise<Phase0Document> {
  return requestPhase0Api(`/api/phase0/documents/${documentId}`, "GET", mapDocumentResponse);
}

export function getPhase0ModelOptions(): Promise<readonly Phase0ModelOption[]> {
  return requestPhase0Api("/api/phase0/ai/models", "GET", mapModelOptionsResponse);
}

export function estimatePhase0DocumentUpload(request: Phase0EstimateRequest): Promise<Phase0EstimateResponse> {
  return requestPhase0Api("/api/phase0/documents/estimate", "POST", mapEstimateResponse, request);
}

export function createPhase0UploadUrl(request: Phase0UploadUrlRequest): Promise<Phase0UploadUrlResponse> {
  return requestPhase0Api("/api/phase0/documents/upload-url", "POST", mapUploadUrlResponse, request);
}

export function confirmPhase0Document(documentId: string): Promise<Phase0ConfirmDocumentResponse> {
  return requestPhase0Api(`/api/phase0/documents/${documentId}/confirm`, "POST", mapConfirmDocumentResponse);
}

export function getPhase0DocumentQuiz(documentId: string): Promise<Phase0DocumentQuizResponse> {
  return requestPhase0Api(`/api/phase0/documents/${documentId}/quiz`, "GET", mapDocumentQuizResponse);
}

export function getPhase0Quiz(quizId: string): Promise<Phase0QuizResponse> {
  return requestPhase0Api(`/api/phase0/quizzes/${quizId}`, "GET", mapQuizResponse);
}

export function requestPhase0PracticeFeedback(
  quizId: string,
  request: Phase0PracticeFeedbackRequest,
): Promise<Phase0PracticeFeedbackResponse> {
  return requestPhase0Api(
    `/api/phase0/quizzes/${quizId}/practice-feedback`,
    "POST",
    mapPracticeFeedbackResponse,
    request,
  );
}

export function submitPhase0QuizAttempt(
  quizId: string,
  request: Phase0SubmitQuizAttemptRequest,
): Promise<Phase0SubmitQuizAttemptResponse> {
  return requestPhase0Api(`/api/phase0/quizzes/${quizId}/attempts`, "POST", mapSubmitQuizAttemptResponse, request);
}

export function getPhase0AttemptResult(
  quizId: string,
  attemptId: string,
): Promise<Phase0AttemptResultResponse> {
  return requestPhase0Api(
    `/api/phase0/quizzes/${quizId}/attempts/${attemptId}`,
    "GET",
    mapAttemptResultResponse,
  );
}
