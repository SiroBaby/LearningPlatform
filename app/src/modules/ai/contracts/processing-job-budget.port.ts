export const PROCESSING_JOB_BUDGET = Symbol('PROCESSING_JOB_BUDGET');

export interface ProcessingJobBudget {
  record(input: {
    readonly attempt: number;
    readonly budgetStatus: string;
    readonly estimatedCredits: number;
    readonly jobId: string;
    readonly leaseId: string;
    readonly settledCredits: number;
  }): Promise<boolean>;
}
