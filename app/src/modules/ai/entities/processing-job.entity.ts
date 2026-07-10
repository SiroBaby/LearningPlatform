import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { JobStatus } from '../enums/job-status.enum';
import { JobType } from '../enums/job-type.enum';

@Entity({ schema: 'ai', name: 'processing_jobs' })
@Index('uq_job_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('uq_job_document_type', ['documentId', 'jobType'], { unique: true })
export class ProcessingJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  // owner_id truyền qua data plane (ADR-0018), không do worker chế tạo
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'job_type', type: 'varchar', length: 30 })
  jobType!: JobType;

  @Column({ type: 'varchar', length: 20, default: JobStatus.PENDING })
  status!: JobStatus;

  // document-scoped: hash(document_id + job_type) (ADR-0005)
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
