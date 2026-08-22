import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ schema: 'quiz', name: 'attempts' })
@Index('idx_attempts_owner_quiz_created_at', ['ownerId', 'quizId', 'createdAt'])
export class AttemptEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'quiz_id', type: 'uuid' })
  quizId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'int' })
  score!: number;

  @Column({ name: 'question_count', type: 'int' })
  questionCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
