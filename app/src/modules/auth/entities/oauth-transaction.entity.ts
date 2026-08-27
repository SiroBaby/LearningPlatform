import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'auth', name: 'oauth_transactions' })
@Index('uq_auth_oauth_transactions_state_hash', ['stateHash'], { unique: true })
@Index('idx_auth_oauth_transactions_expiry', ['expiresAt'])
export class OAuthTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'state_hash', type: 'varchar', length: 128 })
  stateHash!: string;

  @Column({ name: 'nonce_hash', type: 'varchar', length: 128 })
  nonceHash!: string;

  @Column({ name: 'pkce_verifier_ciphertext', type: 'bytea' })
  pkceVerifierCiphertext!: Buffer;

  @Column({ type: 'varchar', length: 32 })
  environment!: string;

  @Column({ name: 'max_attempts', type: 'integer', default: 5 })
  maxAttempts!: number;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'processing_at', type: 'timestamptz', nullable: true })
  processingAt!: Date | null;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
