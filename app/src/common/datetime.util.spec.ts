import { describe, expect, it } from '@jest/globals';

import { DateTimeUtil } from './datetime.util';

describe('DateTimeUtil', () => {
  it('trả ISO-8601 UTC cho Date hợp lệ', () => {
    const value = new Date('2026-06-21T12:34:56.789Z');

    expect(DateTimeUtil.toUtcIsoString(value)).toBe('2026-06-21T12:34:56.789Z');
  });

  it('tạo timestamp hiện tại theo UTC', () => {
    expect(DateTimeUtil.nowUtc().toISOString()).toMatch(/Z$/);
  });
});
