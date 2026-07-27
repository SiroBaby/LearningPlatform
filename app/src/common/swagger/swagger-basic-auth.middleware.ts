import { timingSafeEqual } from 'crypto';

import type { NextFunction, Request, Response } from 'express';

export function createSwaggerBasicAuthMiddleware(
  username: string,
  password: string,
): (request: Request, response: Response, next: NextFunction) => void {
  const expectedCredentials = Buffer.from(`${username}:${password}`);

  return (request, response, next): void => {
    const authorization = request.headers.authorization;
    const credentials = authorization?.startsWith('Basic ')
      ? Buffer.from(authorization.slice('Basic '.length), 'base64')
      : Buffer.alloc(0);

    const isAuthorized =
      credentials.length === expectedCredentials.length &&
      timingSafeEqual(credentials, expectedCredentials);

    if (isAuthorized) {
      next();
      return;
    }

    response.setHeader('WWW-Authenticate', 'Basic realm="API documentation"');
    response.status(401).send('Unauthorized');
  };
}
