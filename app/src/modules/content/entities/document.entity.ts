import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AutoMap } from '@automapper/classes';

import { DocumentStatus } from '../enums/document-status.enum';
import { DocumentType } from '../enums/document-type.enum';

@Entity({ schema: 'course', name: 'documents' })
@Index('idx_doc_owner', ['ownerId', 'createdAt'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  @AutoMap()
  id!: string;

  // ref auth.users (logical) — Phase 0 chưa có Auth tách riêng
  @Column({ name: 'owner_id', type: 'uuid' })
  @AutoMap()
  ownerId!: string;

  @Column({ type: 'varchar', length: 20 })
  @AutoMap()
  type!: DocumentType;

  @Column({ name: 'original_name', type: 'varchar', length: 500 })
  @AutoMap()
  originalName!: string;

  // MinIO object key
  @Column({ name: 'storage_ref', type: 'varchar', length: 500 })
  @AutoMap()
  storageRef!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  @AutoMap()
  sizeBytes!: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  @AutoMap()
  language!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: DocumentStatus.UPLOADED,
  })
  @AutoMap()
  status!: DocumentStatus;

  @Column({ name: 'duration_sec', type: 'int', nullable: true })
  @AutoMap()
  durationSec!: number | null;

  @Column({ name: 'page_count', type: 'int', nullable: true })
  @AutoMap()
  pageCount!: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  @AutoMap()
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @AutoMap()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @AutoMap()
  updatedAt!: Date;
}
