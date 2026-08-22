export const PROCESSING_JOB_MODEL_SELECTION = Symbol('PROCESSING_JOB_MODEL_SELECTION');

export interface ProcessingJobModelSelection {
  ensureDefaultPlatformModel(input: {
    readonly attempt: number;
    readonly jobId: string;
    readonly leaseId: string;
    readonly modelId: string;
    readonly ownerId: string;
  }): Promise<boolean>;
}
