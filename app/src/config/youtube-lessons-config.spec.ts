import { afterEach, describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from './application-config.service';
import appConfig from './app.config';

function configWith(value: unknown): ApplicationConfigService {
  return new ApplicationConfigService(new ConfigService({ app: { youtubeLessonsEnabled: value } }));
}

describe('ApplicationConfigService.youtubeLessonsEnabled', () => {
  it('is enabled only by the strict boolean true', () => {
    expect(configWith(true).youtubeLessonsEnabled).toBe(true);
  });

  it.each([[false], [undefined], ['true'], [1], [null]])('is disabled for %p', (value) => {
    expect(configWith(value).youtubeLessonsEnabled).toBe(false);
  });
});

describe('app config YOUTUBE_LESSONS_ENABLED', () => {
  const originalValue = process.env.YOUTUBE_LESSONS_ENABLED;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.YOUTUBE_LESSONS_ENABLED;
    else process.env.YOUTUBE_LESSONS_ENABLED = originalValue;
  });

  it.each([
    ['true', true],
    ['false', false],
    ['TRUE', false],
    ['1', false],
    ['', false],
  ])('maps %p to %p', (rawValue, expectedEnabled) => {
    process.env.YOUTUBE_LESSONS_ENABLED = rawValue;

    expect(appConfig().youtubeLessonsEnabled).toBe(expectedEnabled);
  });

  it('defaults to disabled when unset', () => {
    delete process.env.YOUTUBE_LESSONS_ENABLED;

    expect(appConfig().youtubeLessonsEnabled).toBe(false);
  });
});
