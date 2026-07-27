import { ProcessingJob } from '../entities/processing-job.entity';

export const JOB_PROCESSOR = Symbol('JOB_PROCESSOR');

export interface JobProcessor {
  process(job: ProcessingJob): Promise<void>;
}
