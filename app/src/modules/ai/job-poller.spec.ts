import { describe, expect, it } from '@jest/globals';

import { JobPoller } from './job-poller.service';

describe('JobPoller', () => {
  it('does not claim durable processing jobs in the Node relay runtime', async () => {
    await expect(new JobPoller().tick()).resolves.toBe(false);
  });
});
