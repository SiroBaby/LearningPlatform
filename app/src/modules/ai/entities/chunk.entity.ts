import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { Locator } from '../contracts/extraction.contracts';

@Entity({ schema: 'ai', name: 'chunks' })
@Index('uq_chunks_document_owner_index', ['documentId', 'ownerId', 'chunkIndex'], {
  unique: true,
})
@Index('idx_chunks_owner_document_order', ['ownerId', 'documentId', 'chunkIndex'])
export class Chunk {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'jsonb' })
  locator!: Locator;

  @Column({ name: 'page_number', type: 'int', nullable: true })
  pageNumber!: number | null;

  @Column({ name: 'start_sec', type: 'numeric', precision: 12, scale: 3, nullable: true })
  startSec!: string | null;

  @Column({ name: 'end_sec', type: 'numeric', precision: 12, scale: 3, nullable: true })
  endSec!: string | null;

  @Column({ name: 'content_hash', type: 'varchar', length: 64 })
  contentHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
