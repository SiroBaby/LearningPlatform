import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';

import { User } from './user.entity';

@Entity({ schema: 'auth', name: 'user_profiles' })
export class UserProfile {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'display_name', type: 'varchar', length: 200, nullable: true })
  displayName!: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 2_000, nullable: true })
  avatarUrl!: string | null;

  @Column({ name: 'learning_goal', type: 'varchar', length: 80, nullable: true })
  learningGoal!: string | null;

  @Column({ name: 'preferred_language', type: 'varchar', length: 16, nullable: true })
  preferredLanguage!: string | null;

  @Column({ name: 'proficiency_level', type: 'varchar', length: 16, nullable: true })
  proficiencyLevel!: string | null;

  @Column({ name: 'onboarding_completed_at', type: 'timestamptz', nullable: true })
  onboardingCompletedAt!: Date | null;

  @Column({ name: 'onboarding_skipped_at', type: 'timestamptz', nullable: true })
  onboardingSkippedAt!: Date | null;
}
