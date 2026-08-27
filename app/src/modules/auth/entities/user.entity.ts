import { AutoMap } from '@automapper/classes';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { AccountRole } from '../enums/account-role.enum';
import { AccountStatus } from '../enums/account-status.enum';

@Entity({ schema: 'auth', name: 'users' })
@Index('uq_auth_users_google_sub', ['googleSub'], { unique: true })
@Index('uq_auth_users_normalized_email', ['normalizedEmail'], { unique: true })
@Index('idx_auth_users_status', ['status'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  @AutoMap()
  id!: string;

  @Column({ name: 'google_sub', type: 'varchar', length: 255 })
  googleSub!: string;

  @Column({ name: 'normalized_email', type: 'varchar', length: 320 })
  @AutoMap()
  normalizedEmail!: string;

  @Column({ name: 'email_verified', type: 'boolean', default: true })
  emailVerified!: boolean;

  @Column({ type: 'varchar', length: 16, default: AccountRole.USER })
  @AutoMap()
  role!: AccountRole;

  @Column({ type: 'varchar', length: 16, default: AccountStatus.ACTIVE })
  @AutoMap()
  status!: AccountStatus;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
