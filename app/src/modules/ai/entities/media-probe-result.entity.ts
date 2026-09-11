import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ schema: 'ai', name: 'media_probe_results' })
@Index('uq_media_probe_result_job_id', ['mediaProbeJobId'], { unique: true })
@Index('uq_media_probe_result_document_owner', ['id', 'documentId', 'ownerId'], { unique: true })
export class MediaProbeResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'media_probe_job_id', type: 'uuid' })
  mediaProbeJobId!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'probe_generation', type: 'uuid' })
  probeGeneration!: string;

  @Column({ name: 'policy_version', type: 'varchar', length: 80 })
  policyVersion!: string;

  @Column({ name: 'deletion_fence', type: 'bigint' })
  deletionFence!: number;

  @Column({ name: 'duration_sec', type: 'int' })
  durationSec!: number;

  @Column({ name: 'bucket', type: 'varchar', length: 255 })
  bucket!: string;

  @Column({ name: 'object_key', type: 'varchar', length: 500 })
  objectKey!: string;

  @Column({ name: 'version_id', type: 'varchar', length: 255 })
  versionId!: string;

  @Column({ name: 'etag', type: 'varchar', length: 255 })
  etag!: string;

  @Column({ name: 'content_length', type: 'bigint' })
  contentLength!: number;

  @Column({ name: 'full_pipeline_job_id', type: 'uuid' })
  fullPipelineJobId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
