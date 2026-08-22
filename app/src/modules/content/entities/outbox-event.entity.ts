import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Transactional outbox cho forward seam content -> ai (ADR-0002).
// Ghi cùng TX với documents (same-schema course, ADR-0010).
@Entity({ schema: 'course', name: 'outbox' })
@Index('idx_course_outbox_unpublished', ['createdAt'], {
  where: '"published_at" IS NULL',
})
export class OutboxEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
