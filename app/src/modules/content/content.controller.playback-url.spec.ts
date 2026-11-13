import 'reflect-metadata';

import { describe, expect, it, jest } from '@jest/globals';
import { GUARDS_METADATA, HTTP_CODE_METADATA, HEADERS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ParseUUIDPipe, ValidationPipe } from '@nestjs/common';
import type { Mapper } from '@automapper/core';

import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { MediaPlaybackUrlResult } from './contracts/media-playback-url.result';
import { CreateMediaPlaybackUrlDto } from './dto/create-media-playback-url.dto';

describe('ContentController.createPlaybackUrl', () => {
  it('is protected by SessionAuthGuard at class level', () => {
    const actualGuards = Reflect.getMetadata(GUARDS_METADATA, ContentController) as unknown[];

    expect(actualGuards).toContain(SessionAuthGuard);
  });

  it('answers 200 with Cache-Control no-store', () => {
    const handler = ContentController.prototype.createPlaybackUrl;

    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([{ name: 'Cache-Control', value: 'no-store' }]);
  });

  it('validates the id param with ParseUUIDPipe', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ContentController, 'createPlaybackUrl') as
      Record<string, { data?: string; pipes: unknown[] }>;

    const actualPipes = Object.values(args).find((arg) => arg.data === 'id')?.pipes ?? [];

    expect(actualPipes.some((pipe) => pipe instanceof ParseUUIDPipe)).toBe(true);
  });

  it('forwards owner, document and default reason then maps the result', async () => {
    const createMediaPlaybackUrl = jest.fn<ContentService['createMediaPlaybackUrl']>()
      .mockResolvedValue(new MediaPlaybackUrlResult());
    const mapper = { map: jest.fn().mockReturnValue({ url: 'mapped' }) };
    const controller = new ContentController(
      { createMediaPlaybackUrl } as unknown as ContentService,
      mapper as unknown as Mapper,
    );

    const actualResponse = await controller.createPlaybackUrl('owner-1', 'document-1', new CreateMediaPlaybackUrlDto());

    expect(createMediaPlaybackUrl).toHaveBeenCalledWith({ ownerId: 'owner-1', documentId: 'document-1', reason: 'INITIAL' });
    expect(actualResponse).toEqual({ url: 'mapped' });
  });

  it('rejects unknown reasons and unknown properties through the global ValidationPipe', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metadata = { type: 'body' as const, metatype: CreateMediaPlaybackUrlDto };

    await expect(pipe.transform({ reason: 'WHATEVER' }, metadata)).rejects.toBeDefined();
    await expect(pipe.transform({ extra: 1 }, metadata)).rejects.toBeDefined();
    await expect(pipe.transform({}, metadata)).resolves.toEqual({});
    await expect(pipe.transform({ reason: 'FOREGROUND' }, metadata)).resolves.toMatchObject({ reason: 'FOREGROUND' });
  });
});
