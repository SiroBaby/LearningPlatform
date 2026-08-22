import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createApplicationLogger } from './application-logger.factory';

describe('createApplicationLogger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('formats development event objects as a concise single line while retaining standard Nest messages', () => {
    const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errors = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createApplicationLogger({ context: 'ApiBootstrap', environment: 'development' });

    logger.log('Application is ready');
    logger.warn('Application is degraded');
    logger.error('Application failed');
    logger.log({ runtime: 'api', port: 3_000, event: 'api.started' });

    const lines = output.mock.calls.map(([message]) => String(message));
    expect(lines[0]).toContain('LOG');
    expect(lines[0]).toContain('[ApiBootstrap]');
    expect(lines[0]).toContain('Application is ready');
    expect(lines[1]).toContain('WARN');
    expect(lines[1]).toContain('[ApiBootstrap]');
    expect(lines[1]).toContain('Application is degraded');
    expect(lines[2]).toContain('api.started port=3000 runtime=api');
    expect(lines[2]).not.toContain('Object(');
    expect(lines[2]).not.toContain('{ runtime:');
    const errorLines = errors.mock.calls.map(([message]) => String(message));
    expect(errorLines[0]).toContain('ERROR');
    expect(errorLines[0]).toContain('[ApiBootstrap]');
    expect(errorLines[0]).toContain('Application failed');
  });

  it('preserves event objects as JSON metadata in production', () => {
    const output = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createApplicationLogger({ context: 'ApiBootstrap', environment: 'production' });

    logger.warn({ runtime: 'api', port: 3_000, event: 'api.started' });

    const record = JSON.parse(String(output.mock.calls[0]?.[0])) as {
      readonly context: string;
      readonly level: string;
      readonly message: Record<string, unknown>;
    };
    expect(record).toMatchObject({
      context: 'ApiBootstrap',
      level: 'warn',
      message: { event: 'api.started', port: 3_000, runtime: 'api' },
    });
  });
});
