import { randomUUID } from 'crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { StorageService } from '../../storage/storage.service';
import {
  STORAGE_VERIFIER,
  StorageVerifier,
} from '../../storage/contracts/storage-verifier.port';
import { CreateUploadUrlCommand } from './contracts/create-upload-url.command';
import { UploadUrlResult } from './contracts/upload-url.result';
import { Document } from './entities/document.entity';
import { ContentRepository } from './repositories/content.repository';

@Injectable()
export class ContentService {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly storage: StorageService,
    @Inject(STORAGE_VERIFIER)
    private readonly verifier: StorageVerifier,
  ) {}

  /**
   * Tạo document (status=UPLOADED) + cấp presigned PUT URL.
   * Object key sinh ngẫu nhiên (UUID) — KHÔNG dùng tên file gốc làm path
   * (bài học 07-docs: chống path traversal).
   */
  async createUploadUrl(
    ownerId: string,
    command: CreateUploadUrlCommand,
  ): Promise<UploadUrlResult> {
    const ext = this.safeExtension(command.originalName);
    const objectKey = `${ownerId}/${randomUUID()}${ext}`;

    const saved = await this.contentRepository.createUploaded(
      ownerId,
      command,
      objectKey,
    );

    const { url, expirySec } = await this.storage.createPresignedPutUrl(
      objectKey,
    );

    return Object.assign(new UploadUrlResult(), {
      documentId: saved.id,
      uploadUrl: url,
      objectKey,
      bucket: this.storage.getBucketName(),
      expirySec,
    });
  }

  // Ownership enforcement từ ngày 1 (ADR-0011): luôn lọc theo owner_id
  async findById(ownerId: string, id: string): Promise<Document | null> {
    return this.contentRepository.findByOwnerId(ownerId, id);
  }

  /**
   * Confirm upload xong: verify file trên storage, rồi trong MỘT transaction
   * chỉ chạm schema `course` (ADR-0010): CAS status UPLOADED/FAILED -> PROCESSING
   * + ghi outbox(DocumentReadyForProcessing) mang owner_id (ADR-0005/0018).
   * Idempotent qua CAS: re-confirm không tạo outbox thứ hai.
   */
  async confirm(ownerId: string, id: string): Promise<Document> {
    const document = await this.contentRepository.findByOwnerId(ownerId, id);
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    const v = await this.verifier.verify(document.storageRef, document.type);
    if (!v.exists || !v.magicBytesValid) {
      throw new BadRequestException('Uploaded file failed verification');
    }

    const confirmed = await this.contentRepository.confirmProcessing(ownerId, id);
    if (!confirmed) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    return confirmed;
  }

  // Lấy đuôi file an toàn (chỉ chữ/số, tối đa 10 ký tự)
  private safeExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return '';
    const raw = name.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,10}$/.test(raw) ? `.${raw}` : '';
  }
}
