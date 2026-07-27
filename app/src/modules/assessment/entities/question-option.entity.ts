import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'quiz', name: 'options' })
@Index('uq_options_question_index', ['questionId', 'optionIndex'], { unique: true })
@Index('idx_options_owner_question', ['ownerId', 'questionId'])
export class QuestionOptionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'option_index', type: 'int' })
  optionIndex!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'is_correct', type: 'boolean' })
  isCorrect!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
