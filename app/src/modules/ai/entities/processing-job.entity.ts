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
import type { ModelSelectionKind } from '../contracts/model-selection.contracts';

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

  @Column({ name: 'lease_id', type: 'uuid', nullable: true })
  leaseId!: string | null;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;

  @Column({ name: 'next_visible_at', type: 'timestamptz', default: () => 'now()' })
  nextVisibleAt!: Date;

  @Column({ name: 'technical_retry_count', type: 'int', default: 0 })
  technicalRetryCount!: number;

  @Column({ name: 'failure_code', type: 'varchar', length: 80, nullable: true })
  failureCode!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'model_selection_kind', type: 'varchar', length: 10, nullable: true })
  modelSelectionKind!: ModelSelectionKind | null;

  @Column({ name: 'platform_model_id', type: 'varchar', length: 100, nullable: true })
  platformModelId!: string | null;

  @Column({ name: 'custom_model_config_id', type: 'uuid', nullable: true })
  customModelConfigId!: string | null;

  @Column({ name: 'estimated_credits', type: 'bigint', nullable: true })
  estimatedCredits!: number | null;

  @Column({ name: 'settled_credits', type: 'bigint', nullable: true })
  settledCredits!: number | null;

  @Column({ name: 'budget_status', type: 'varchar', length: 20, nullable: true })
  budgetStatus!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
