import { randomUUID } from 'crypto';

import type { NextFunction } from 'express';

import { createApplicationLogger } from './application-logger.factory';

const CORRELATION_ID_HEADER = 'x-correlation-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RequestLifecycleRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method: string;
  readonly path: string;
}

interface RequestLifecycleResponse {
  once(event: 'finish', listener: () => void): void;
  setHeader(name: string, value: string): void;
  readonly statusCode: number;
}

export function createRequestLifecycleMiddleware(): (
  request: RequestLifecycleRequest,
  response: RequestLifecycleResponse,
  next: NextFunction,
) => void {
  const logger = createApplicationLogger({ context: 'ApiRequestLifecycle' });

  return (request, response, next): void => {
    const startedAt = performance.now();
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_ID_HEADER]);
    request.headers[CORRELATION_ID_HEADER] = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.once('finish', () => {
      logger.log({
        correlationId,
        durationMs: Math.round(performance.now() - startedAt),
        event: 'api.request.completed',
        method: request.method,
        pathname: request.path,
        runtime: 'api',
        statusCode: response.statusCode,
      });
    });
    next();
  };
}

function resolveCorrelationId(value: string | string[] | undefined): string {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : randomUUID();
}
