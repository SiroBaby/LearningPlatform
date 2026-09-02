import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AiOperationalSnapshot } from '../contracts/ai-operational-snapshot.port';

@Injectable()
export class AiOperationalSnapshotRepository implements AiOperationalSnapshot {
  constructor(private readonly dataSource: DataSource) {}

  async readSnapshot(): ReturnType<AiOperationalSnapshot['readSnapshot']> {
    // These owner-scoped aggregate reads prove the AI read model is available; no raw job data leaves it.
    const [jobs, failures] = await Promise.all([
      this.dataSource.query(
        `SELECT "status", count(*)::int AS "count"
         FROM "ai"."processing_jobs" GROUP BY "status" ORDER BY "status"`,
      ) as Promise<Array<{ readonly count: number; readonly status: string }>>,
      this.dataSource.query(
        `SELECT "failure_code" AS "failureCode", count(*)::int AS "count"
         FROM "ai"."processing_jobs"
         WHERE "failure_code" IS NOT NULL
         GROUP BY "failure_code" ORDER BY "failure_code"`,
      ) as Promise<Array<{ readonly count: number; readonly failureCode: string }>>,
    ]);
    return {
      failureClasses: failures.map((failure) => ({ count: failure.count, failureCode: failure.failureCode })),
      health: 'healthy',
      jobSummary: jobs.map((job) => ({ count: job.count, status: job.status })),
      readiness: 'ready',
      resources: ['processingJobs'],
    };
  }
}
