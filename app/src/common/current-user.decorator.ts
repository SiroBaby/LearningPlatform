import {
  createParamDecorator,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import type { Request } from 'express';

/**
 * CurrentUser seam (Phase 0): danh tính lấy từ header `X-User-Id`.
 * Hỗ trợ nhiều user (dev) để test IDOR thật. Xem ADR-0011.
 *
 * Phase 3: chính decorator này đổi sang trích userId từ JWT —
 * controller KHÔNG phải sửa. Đây là đường nối (seam) cho Auth thật.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ownerId = req.headers['x-user-id'];
    if (typeof ownerId !== 'string' || !isUuid(ownerId)) {
      throw new BadRequestException('Missing or invalid X-User-Id header');
    }
    return ownerId;
  },
);
