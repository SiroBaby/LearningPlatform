import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { SessionTokenType } from '../enums/session-token-type.enum';

@Entity({ schema: 'auth', name: 'sessions' })
@Index('uq_auth_sessions_token_hash', ['tokenHash'], { unique: true })
@Index('idx_auth_sessions_family', ['sessionFamilyId'])
@Index('idx_auth_sessions_active_user', ['userId', 'revokedAt'])
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'session_family_id', type: 'uuid' })
  sessionFamilyId!: string;

  @Column({ name: 'token_type', type: 'varchar', length: 16 })
  tokenType!: SessionTokenType;

  @Column({ name: 'token_hash', type: 'varchar', length: 128 })
  tokenHash!: string;

  @Column({ name: 'previous_token_hash', type: 'varchar', length: 128, nullable: true })
  previousTokenHash!: string | null;

  @Column({ name: 'rotation_counter', type: 'integer', default: 0 })
  rotationCounter!: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoked_reason', type: 'varchar', length: 64, nullable: true })
  revokedReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;
}
