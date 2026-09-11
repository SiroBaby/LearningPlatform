import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DocumentPurgeManifestStatus } from '../enums/document-purge-manifest-status.enum';

export interface DocumentPurgeLocator {
  readonly bucket: string;
  readonly key: string;
  readonly versionId: string | null;
  readonly etag: string | null;
  readonly contentLength: number | null;
}

/** Durable tombstone kept independently from the Document row. */
@Entity({ schema: 'course', name: 'document_purge_manifests' })
@Index('uq_document_purge_manifest_document', ['documentId'], { unique: true })
@Index('uq_document_purge_manifest_idempotency_key', ['idempotencyKey'], { unique: true })
export class DocumentPurgeManifest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'deletion_fence', type: 'bigint' })
  deletionFence!: number;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey!: string;

  @Column({ type: 'jsonb' })
  locators!: DocumentPurgeLocator[];

  @Column({ type: 'varchar', length: 20, default: DocumentPurgeManifestStatus.PENDING })
  status!: DocumentPurgeManifestStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage!: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz', default: () => 'now()' })
  requestedAt!: Date;

  @Column({ name: 'purged_at', type: 'timestamptz', nullable: true })
  purgedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
