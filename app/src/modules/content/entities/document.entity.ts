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
import type { ModelSelectionKind } from '../../ai/contracts/model-selection.contracts';

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

  @Column({ name: 'model_selection_kind', type: 'varchar', length: 10 })
  modelSelectionKind!: ModelSelectionKind;

  @Column({ name: 'platform_model_id', type: 'varchar', length: 100, nullable: true })
  platformModelId!: string | null;

  @Column({ name: 'custom_model_config_id', type: 'uuid', nullable: true })
  customModelConfigId!: string | null;

  @Column({ name: 'selected_model_label', type: 'varchar', length: 120, nullable: true })
  selectedModelLabel!: string | null;

  @Column({ name: 'estimate_status', type: 'varchar', length: 20, nullable: true })
  estimateStatus!: string | null;

  @Column({ name: 'estimated_credits', type: 'bigint', nullable: true })
  estimatedCredits!: number | null;

  @Column({ name: 'settled_credits', type: 'bigint', nullable: true })
  settledCredits!: number | null;

  @Column({ name: 'budget_status', type: 'varchar', length: 20, nullable: true })
  budgetStatus!: string | null;

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
