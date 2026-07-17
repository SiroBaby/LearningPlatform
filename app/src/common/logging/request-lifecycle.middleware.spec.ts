import { randomUUID } from 'crypto';

import { describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';
import type { NextFunction } from 'express';

import { createRequestLifecycleMiddleware } from './request-lifecycle.middleware';

describe('createRequestLifecycleMiddleware', () => {
  it('uses a valid incoming correlation ID and logs only the safe completion fields', () => {
    const correlationId = randomUUID();
    const logger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const clock = jest.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(16.5);
    const response = createResponse();
    const next = jest.fn() as NextFunction;
    const middleware = createRequestLifecycleMiddleware();

    middleware(
      {
        headers: {
          authorization: 'Bearer secret-token',
          'x-correlation-id': correlationId,
        },
        method: 'POST',
        path: '/api/v1/documents',
      },
      response,
      next,
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret-token');
    response.emit('finish');

    expect(response.setHeader).toHaveBeenCalledWith('x-correlation-id', correlationId);
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      {
        correlationId,
        durationMs: 7,
        event: 'api.request.completed',
        method: 'POST',
        pathname: '/api/v1/documents',
        runtime: 'api',
        statusCode: 201,
      },
    );
    expect(clock).toHaveBeenCalledTimes(2);
  });

  it('generates a correlation ID when the incoming header is invalid', () => {
    const response = createResponse();
    const middleware = createRequestLifecycleMiddleware();

    middleware(
      {
        headers: { 'x-correlation-id': 'not-a-uuid' },
        method: 'GET',
        path: '/api/v1/documents',
      },
      response,
      jest.fn() as NextFunction,
    );

    const correlationId = response.setHeader.mock.calls[0]?.[1];
    expect(typeof correlationId).toBe('string');
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

function createResponse(): {
  readonly emit: (event: 'finish') => void;
  readonly setHeader: ReturnType<typeof jest.fn<(name: string, value: string) => void>>;
  readonly statusCode: number;
  once(event: 'finish', listener: () => void): void;
} {
  let finishListener: (() => void) | undefined;
  const setHeader = jest.fn<(name: string, value: string) => void>();
  return {
    emit: (_event: 'finish'): void => finishListener?.(),
    setHeader,
    statusCode: 201,
    once: (_event: 'finish', listener: () => void): void => {
      finishListener = listener;
    },
  };
}
