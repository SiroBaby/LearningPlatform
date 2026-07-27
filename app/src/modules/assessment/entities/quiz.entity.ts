import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'quiz', name: 'quizzes' })
@Index('idx_quizzes_owner_document', ['ownerId', 'documentId'])
@Index('uq_quizzes_idempotency_key', ['idempotencyKey'], { unique: true })
export class QuizEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'prompt_version', type: 'varchar', length: 128 })
  promptVersion!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 64 })
  idempotencyKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
