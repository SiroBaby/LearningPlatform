import { validate } from "class-validator";
import { describe, expect, it } from '@jest/globals';

import { IsNonBlankString } from "./is-non-blank-string.validator";

class TestDto {
  value!: string;
}

IsNonBlankString()(TestDto.prototype, 'value');

describe("IsNonBlankString", () => {
  it.each(["", " ", "\t\n"])("từ chối chuỗi trống: %j", async (value) => {
    const dto = new TestDto();
    dto.value = value;

    expect(await validate(dto)).toHaveLength(1);
  });

  it("chấp nhận chuỗi có nội dung", async () => {
    const dto = new TestDto();
    dto.value = "bài giảng.pdf";

    expect(await validate(dto)).toHaveLength(0);
  });
});
