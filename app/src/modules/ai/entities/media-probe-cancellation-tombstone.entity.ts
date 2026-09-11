import {
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

@Entity({ schema: 'ai', name: 'media_probe_cancellation_tombstones' })
@Index('uq_media_probe_cancellation_tombstone_fence', ['documentId', 'ownerId', 'deletionFence'], { unique: true })
@Index('uq_media_probe_cancellation_tombstone_event_key', ['eventIdempotencyKey'], { unique: true })
@Index('idx_media_probe_cancellation_tombstone_document', ['documentId', 'ownerId', 'deletionFence'])
export class MediaProbeCancellationTombstone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'deletion_fence', type: 'bigint' })
  deletionFence!: number;

  @Column({ type: 'varchar', length: 64 })
  reason!: string;

  @Column({ name: 'event_idempotency_key', type: 'varchar', length: 160 })
  eventIdempotencyKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
