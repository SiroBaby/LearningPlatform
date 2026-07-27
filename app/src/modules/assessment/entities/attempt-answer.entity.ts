import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'quiz', name: 'attempt_answers' })
@Index('idx_attempt_answers_owner_attempt', ['ownerId', 'attemptId'])
export class AttemptAnswerEntity {
  @PrimaryColumn({ name: 'attempt_id', type: 'uuid' })
  attemptId!: string;

  @PrimaryColumn({ name: 'question_id', type: 'uuid' })
  questionId!: string;

  @Column({ name: 'selected_option_id', type: 'uuid' })
  selectedOptionId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'is_correct', type: 'boolean' })
  isCorrect!: boolean;
}
