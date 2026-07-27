import { validate } from 'class-validator';
import { describe, expect, it } from '@jest/globals';

import { IsUtcDateTime } from './is-utc-date-time.validator';

class TestDto {
  value!: string;
}

IsUtcDateTime()(TestDto.prototype, 'value');

describe('IsUtcDateTime', () => {
  it.each([
    '2026-06-21T12:34:56.789Z',
    '2026-06-21T12:34:56Z',
  ])('chấp nhận ISO-8601 UTC: %s', async (value) => {
    const dto = new TestDto();
    dto.value = value;

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    '2026-06-21T12:34:56+07:00',
    '2026-06-21 12:34:56Z',
    'not-a-date',
  ])('từ chối datetime không phải UTC ISO-8601: %s', async (value) => {
    const dto = new TestDto();
    dto.value = value;

    expect(await validate(dto)).toHaveLength(1);
  });
});
