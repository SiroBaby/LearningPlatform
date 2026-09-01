import "server-only";

import { requestAuthenticatedPhase0Backend } from "@/lib/phase0/backend-client";
import type {
  Phase0AttemptResultResponse,
  Phase0Document,
  Phase0QuizResponse,
} from "@/lib/phase0/contracts";
import {
  mapAttemptResultResponse,
  mapDocumentResponse,
  mapQuizResponse,
} from "@/lib/phase0/mappers";

export class Phase0ServerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "Phase0ServerError";
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return text;
    throw error;
  }
}

function readErrorMessage(value: unknown): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const message = Object.entries(value).find(([key]) => key === "message")?.[1];
    if (typeof message === "string") return message;
  }
  if (typeof value === "string" && value.trim()) return value;
  return "The Phase 0 API request failed.";
}

async function requestServerData<T>(path: string, mapper: (value: unknown) => T): Promise<T> {
  const response = await requestAuthenticatedPhase0Backend({ method: "GET", path });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Phase0ServerError(response.status, readErrorMessage(body));
  }
  return mapper(body);
}

export function getPhase0DocumentServer(documentId: string): Promise<Phase0Document> {
  return requestServerData(`/documents/${documentId}`, mapDocumentResponse);
}

export function getPhase0QuizServer(quizId: string): Promise<Phase0QuizResponse> {
  return requestServerData(`/quizzes/${quizId}`, mapQuizResponse);
}

export function getPhase0AttemptResultServer(
  quizId: string,
  attemptId: string,
): Promise<Phase0AttemptResultResponse> {
  return requestServerData(
    `/quizzes/${quizId}/attempts/${attemptId}`,
    mapAttemptResultResponse,
  );
}
