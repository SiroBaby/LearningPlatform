import { jest } from '@jest/globals';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

import { startTestDatabase } from './test-db';

jest.mock('@testcontainers/postgresql');
jest.mock('pg');
jest.mock('../database/migrate', () => ({ runUp: jest.fn() }));

describe('test database environment lifecycle', () => {
  it('restores DB environment when migration setup fails', async () => {
    const originalEnvironment = {
      DB_HOST: process.env.DB_HOST,
      DB_NAME: process.env.DB_NAME,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DB_PORT: process.env.DB_PORT,
      DB_USER: process.env.DB_USER,
    };
    const container = {
      getConnectionUri: () => 'postgresql://container/learning',
      getDatabase: () => 'container-db',
      getHost: () => 'container-host',
      getPassword: () => 'container-password',
      getPort: () => 6543,
      getUsername: () => 'container-user',
      start: jest.fn(),
      stop: jest.fn(),
    };
    const migrateClient = {
      connect: jest.fn(async () => undefined),
      end: jest.fn(async () => undefined),
    };
    const postgresContainerConstructor = PostgreSqlContainer as unknown as jest.Mock;
    const clientConstructor = Client as unknown as jest.Mock;
    postgresContainerConstructor.mockImplementationOnce(() => container);
    container.start.mockImplementationOnce(async () => container);
    clientConstructor.mockImplementationOnce(() => migrateClient);

    const { runUp } = await import('../database/migrate');
    (runUp as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('migration fixture failed');
    });

    await expect(startTestDatabase()).rejects.toThrow('migration fixture failed');
    expect(container.stop).toHaveBeenCalledTimes(1);
    expect(migrateClient.end).toHaveBeenCalledTimes(1);
    expect(process.env.DB_HOST).toBe(originalEnvironment.DB_HOST);
    expect(process.env.DB_PORT).toBe(originalEnvironment.DB_PORT);
    expect(process.env.DB_USER).toBe(originalEnvironment.DB_USER);
    expect(process.env.DB_PASSWORD).toBe(originalEnvironment.DB_PASSWORD);
    expect(process.env.DB_NAME).toBe(originalEnvironment.DB_NAME);
  });
});
