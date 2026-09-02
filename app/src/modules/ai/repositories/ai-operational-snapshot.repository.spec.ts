import { describe, expect, it, jest } from '@jest/globals';

import { AiOperationalSnapshotRepository } from './ai-operational-snapshot.repository';

describe('AiOperationalSnapshotRepository', () => {
  it('reports readiness only after the AI-owned aggregate reads succeed and excludes raw job data', async () => {
    const query = jest.fn<(...args: readonly unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce([{ count: 2, status: 'FAILED' }])
      .mockResolvedValueOnce([{ count: 2, failureCode: 'PROVIDER_TIMEOUT' }]);
    const repository = new AiOperationalSnapshotRepository({ query } as never);

    await expect(repository.readSnapshot()).resolves.toEqual({
      failureClasses: [{ count: 2, failureCode: 'PROVIDER_TIMEOUT' }],
      health: 'healthy',
      jobSummary: [{ count: 2, status: 'FAILED' }],
      readiness: 'ready',
      resources: ['processingJobs'],
    });
    const queries = query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(queries).not.toContain('SELECT 1');
    expect(queries).not.toContain('error_message');
    expect(queries).not.toContain('source_text');
    expect(queries).not.toContain('prompt');
  });

  it('does not report a green snapshot when the AI read model is unavailable', async () => {
    const repository = new AiOperationalSnapshotRepository({ query: jest.fn(async () => { throw new Error('database unavailable'); }) } as never);

    await expect(repository.readSnapshot()).rejects.toThrow('database unavailable');
  });
});
