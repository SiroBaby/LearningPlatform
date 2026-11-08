import { Client } from 'pg';

import type { TestDb } from './test-db';

const LOCK_WAIT_TIMEOUT_MS = 15_000;
const LOCK_POLL_INTERVAL_MS = 25;

export interface BlockDocumentRowInput {
  readonly db: TestDb;
  readonly documentId: string;
  readonly minimumWaiters: number;
  readonly start: () => readonly Promise<unknown>[];
}

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Forces real overlap: holds FOR UPDATE on the Document row from a separate connection, starts the concurrent
 * operations, waits (bounded) until at least `minimumWaiters` other backends are blocked on a lock, then commits.
 * Returns the settled results so callers assert that no operation rejected.
 */
export async function runWithBlockedDocumentRow(input: BlockDocumentRowInput): Promise<PromiseSettledResult<unknown>[]> {
  const blocker = new Client({ connectionString: input.db.container.getConnectionUri() });
  await blocker.connect();
  let isCommitted = false;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT 1 FROM "course"."documents" WHERE "id" = $1 FOR UPDATE', [input.documentId]);
    const settled = Promise.allSettled(input.start());
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    for (;;) {
      const waiters = await input.db.client.query<{ readonly count: number }>(
        `SELECT count(*)::int AS "count" FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> $1`,
        [(await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid],
      );
      if ((waiters.rows[0]?.count ?? 0) >= input.minimumWaiters) break;
      if (Date.now() > deadline) throw new Error(`Fewer than ${input.minimumWaiters} backends waited on the Document row lock`);
      await sleep(LOCK_POLL_INTERVAL_MS);
    }
    await blocker.query('COMMIT');
    isCommitted = true;
    return await settled;
  } finally {
    if (!isCommitted) await blocker.query('ROLLBACK').catch(() => undefined);
    await blocker.end();
  }
}
