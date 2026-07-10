import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, jest } from '@jest/globals';

import { createSwaggerBasicAuthMiddleware } from './swagger-basic-auth.middleware';

describe('createSwaggerBasicAuthMiddleware', () => {
  const middleware = createSwaggerBasicAuthMiddleware('docs', 'secret');

  function createResponse(): Response {
    return {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as Response;
  }

  it('cho phép Basic Auth hợp lệ', () => {
    const request = {
      headers: {
        authorization: `Basic ${Buffer.from('docs:secret').toString('base64')}`,
      },
    } as Request;
    const response = createResponse();
    const next = jest.fn() as NextFunction;

    middleware(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('từ chối request không có hoặc có Basic Auth sai', () => {
    const request = { headers: {} } as Request;
    const response = createResponse();
    const next = jest.fn() as NextFunction;

    middleware(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Basic realm="API documentation"',
    );
    expect(response.status).toHaveBeenCalledWith(401);
  });
});
