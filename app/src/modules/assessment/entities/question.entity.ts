import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { CitationCandidate } from '../contracts/quiz-generation-handoff.contract';

@Entity({ schema: 'quiz', name: 'questions' })
@Index('uq_questions_idempotency_key', ['idempotencyKey'], { unique: true })
@Index('uq_questions_quiz_chunk_ordinal', ['quizId', 'chunkId', 'ordinal'], { unique: true })
@Index('idx_questions_owner_quiz', ['ownerId', 'quizId', 'ordinal'])
export class QuestionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'quiz_id', type: 'uuid' })
  quizId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'chunk_id', type: 'uuid' })
  chunkId!: string;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'int' })
  ordinal!: number;

  @Column({ type: 'text' })
  stem!: string;

  @Column({ type: 'text' })
  explanation!: string;

  @Column({ name: 'citation_ref', type: 'jsonb' })
  citation!: CitationCandidate;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 64 })
  idempotencyKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
