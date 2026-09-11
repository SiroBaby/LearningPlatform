import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { MediaProbeJobStatus } from '../enums/media-probe-job-status.enum';

@Entity({ schema: 'ai', name: 'media_probe_jobs' })
@Index('uq_media_probe_job_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('uq_media_probe_job_generation', ['documentId', 'probeGeneration', 'policyVersion'], { unique: true })
export class MediaProbeJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'correlation_id', type: 'uuid' })
  correlationId!: string;

  @Column({ name: 'probe_generation', type: 'uuid' })
  probeGeneration!: string;

  @Column({ name: 'policy_version', type: 'varchar', length: 80 })
  policyVersion!: string;

  @Column({ name: 'deletion_fence', type: 'bigint', default: 0 })
  deletionFence!: number;

  @Column({ name: 'full_pipeline_job_id', type: 'uuid' })
  fullPipelineJobId!: string;

  @Column({ name: 'source_bucket', type: 'varchar', length: 255 })
  sourceBucket!: string;

  @Column({ name: 'source_key', type: 'varchar', length: 500 })
  sourceKey!: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: MediaProbeJobStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

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

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'source_version_id', type: 'varchar', length: 255, nullable: true })
  sourceVersionId!: string | null;

  @Column({ name: 'source_etag', type: 'varchar', length: 255, nullable: true })
  sourceEtag!: string | null;

  @Column({ name: 'source_content_length', type: 'bigint', nullable: true })
  sourceContentLength!: number | null;

  @Column({ name: 'probe_result_id', type: 'uuid', nullable: true })
  probeResultId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
