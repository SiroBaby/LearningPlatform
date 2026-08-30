import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Durable identity-to-queue cancellation command. The queue owner consumes it
// asynchronously; auth status and this command are committed together.
@Entity({ schema: 'auth', name: 'outbox' })
@Index('uq_auth_outbox_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('idx_auth_outbox_unpublished', ['createdAt'], {
  where: '"published_at" IS NULL',
})
export class AuthOutboxEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
