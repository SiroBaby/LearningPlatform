export const AI_OPERATIONAL_SNAPSHOT = Symbol('AI_OPERATIONAL_SNAPSHOT');

export interface AiOperationalSnapshot {
  readSnapshot(): Promise<{
    readonly failureClasses: ReadonlyArray<{ readonly count: number; readonly failureCode: string }>;
    readonly health: 'healthy';
    readonly jobSummary: ReadonlyArray<{ readonly count: number; readonly status: string }>;
    readonly readiness: 'ready';
    readonly resources: readonly ['processingJobs'];
  }>;
}
