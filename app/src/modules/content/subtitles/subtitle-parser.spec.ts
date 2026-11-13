import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from '@jest/globals';

import { SubtitleParseError, SubtitleParseErrorCode } from './subtitle-parse-error';
import { parseSubtitle } from './subtitle-parser';
import type { SubtitleFormat } from './subtitle.types';

const FIXTURE_DIRECTORY = join(__dirname, '__fixtures__');
const VTT_HEADER = 'WEBVTT\n\n';

function readFixture(name: string): Buffer {
  return readFileSync(join(FIXTURE_DIRECTORY, name));
}

function captureError(source: Buffer, format: SubtitleFormat): SubtitleParseError {
  try {
    parseSubtitle(source, format);
  } catch (error) {
    if (error instanceof SubtitleParseError) return error;
    throw error;
  }
  throw new Error('Expected parseSubtitle to throw SubtitleParseError');
}

function expectFailure(source: Buffer, format: SubtitleFormat, code: SubtitleParseErrorCode, line?: number): void {
  const actualError = captureError(source, format);
  expect(actualError.code).toBe(code);
  expect(actualError.line).toBe(line);
}

function vttWithBlocks(...blocks: string[]): Buffer {
  return Buffer.from(`${VTT_HEADER}${blocks.join('\n\n')}\n`, 'utf8');
}

function srtWithBlocks(...blocks: string[]): Buffer {
  return Buffer.from(`${blocks.join('\n\n')}\n`, 'utf8');
}

describe('parseSubtitle VTT fixture', () => {
  const actualSubtitle = parseSubtitle(readFixture('bai-giang.vi.vtt'), 'VTT');

  it('sorts cues by start while keeping Vietnamese text in NFC', () => {
    expect(actualSubtitle.format).toBe('VTT');
    expect(actualSubtitle.cues.map((cue) => cue.startMs)).toEqual([500, 1000, 3000, 7000, 3723456]);
    expect(actualSubtitle.cues[1].text).toBe('Xin chào các bạn, hôm nay chúng ta học về ngăn xếp.');
    expect(actualSubtitle.cues[1].text).toBe(actualSubtitle.cues[1].text.normalize('NFC'));
  });

  it('keeps overlapping cues and reports the largest end as duration', () => {
    expect(actualSubtitle.cues[1]).toMatchObject({ startMs: 1000, endMs: 4500 });
    expect(actualSubtitle.cues[2]).toMatchObject({ startMs: 3000, endMs: 6000 });
    expect(actualSubtitle.durationMs).toBe(3725000);
  });

  it('strips tags, skips NOTE/STYLE and decodes entities into inert plain text', () => {
    const actualTexts = actualSubtitle.cues.map((cue) => cue.text);

    expect(actualTexts[0]).toBe('>> Mở đầu & giới thiệu');
    expect(actualTexts[2]).toBe('Ngăn xếp (stack) hoạt động theo nguyên tắc vào sau ra trước.');
    expect(actualTexts[3]).toBe('Ví dụ: <script>alert(1)</script> chỉ là chữ. Dòng thứ hai nối vào dòng đầu.');
    expect(actualTexts.join('')).not.toContain('Đây là ghi chú');
    expect(actualTexts.join('')).not.toContain('lime');
  });

  it('counts code points and cues consistently', () => {
    const expectedCharCount = actualSubtitle.cues.reduce((total, cue) => total + [...cue.text].length, 0);

    expect(actualSubtitle.cueCount).toBe(5);
    expect(actualSubtitle.charCount).toBe(expectedCharCount);
  });

  it('produces the same cues from an NFD encoded file', () => {
    const decomposed = Buffer.from(readFixture('bai-giang.vi.vtt').toString('utf8').normalize('NFD'), 'utf8');

    const actualNfdSubtitle = parseSubtitle(decomposed, 'VTT');

    expect(actualNfdSubtitle.cues).toEqual(actualSubtitle.cues);
  });
});

describe('parseSubtitle SRT fixture', () => {
  const actualSubtitle = parseSubtitle(readFixture('bai-giang.vi.srt'), 'SRT');

  it('reads indexed blocks, short hours, dot milliseconds and X1 coordinates', () => {
    expect(actualSubtitle.cues.map((cue) => [cue.startMs, cue.endMs])).toEqual([
      [500, 1000],
      [1000, 4500],
      [3000, 6000],
      [7000, 9250],
    ]);
  });

  it('removes font/i tags and ASS overrides but keeps escaped markup as text', () => {
    const actualTexts = actualSubtitle.cues.map((cue) => cue.text);

    expect(actualTexts[1]).toBe('Xin chào các bạn, hôm nay học về hàng đợi.');
    expect(actualTexts[2]).toBe('Hàng đợi (queue) hoạt động theo nguyên tắc vào trước ra trước.');
    expect(actualTexts[3]).toBe('Ví dụ <b>không phải thẻ</b>. Dòng thứ hai.');
  });
});

describe('parseSubtitle stable ordering and filtering', () => {
  it('keeps file order for cues that share a start', () => {
    const source = vttWithBlocks(
      '00:00:01.000 --> 00:00:02.000\nsecond start A',
      '00:00:00.000 --> 00:00:01.000\nfirst',
      '00:00:01.000 --> 00:00:03.000\nsecond start B',
    );

    const actualTexts = parseSubtitle(source, 'VTT').cues.map((cue) => cue.text);

    expect(actualTexts).toEqual(['first', 'second start A', 'second start B']);
  });

  it('drops cues that are empty after sanitizing', () => {
    const source = vttWithBlocks(
      '00:00:00.000 --> 00:00:01.000\n<c></c>&nbsp;&lrm;',
      '00:00:01.000 --> 00:00:02.000\nnội dung',
    );

    expect(parseSubtitle(source, 'VTT').cues).toEqual([{ startMs: 1000, endMs: 2000, text: 'nội dung' }]);
  });

  it('does not decode entities twice', () => {
    const source = vttWithBlocks('00:00:00.000 --> 00:00:01.000\n&amp;lt;b&amp;gt;');

    expect(parseSubtitle(source, 'VTT').cues[0].text).toBe('&lt;b&gt;');
  });

  it('accepts a cue of exactly 2,000 code points and a file of exactly 10,000 cues', () => {
    const longCue = vttWithBlocks(`00:00:00.000 --> 00:00:01.000\n${'a'.repeat(2000)}`);
    const manyCues = srtWithBlocks(...Array.from({ length: 10_000 }, (_, index) => {
      const startSecond = index;
      return `${index + 1}\n00:00:00,${String(startSecond % 1000).padStart(3, '0')} --> 10:00:00,000\nx`;
    }));

    expect(parseSubtitle(longCue, 'VTT').cueCount).toBe(1);
    expect(parseSubtitle(manyCues, 'SRT').cueCount).toBe(10_000);
  });
});

describe('parseSubtitle failures', () => {
  it('rejects an empty file and a file without cues', () => {
    expectFailure(Buffer.alloc(0), 'SRT', SubtitleParseErrorCode.SUBTITLE_EMPTY);
    expectFailure(Buffer.from('\n  \n', 'utf8'), 'VTT', SubtitleParseErrorCode.SUBTITLE_EMPTY);
    expectFailure(Buffer.from(VTT_HEADER, 'utf8'), 'VTT', SubtitleParseErrorCode.SUBTITLE_EMPTY);
    expectFailure(vttWithBlocks('00:00:00.000 --> 00:00:01.000\n<c></c>'), 'VTT', SubtitleParseErrorCode.SUBTITLE_EMPTY);
  });

  it('rejects a file over 5 MiB', () => {
    expectFailure(Buffer.alloc(5 * 1024 * 1024 + 1, 0x61), 'VTT', SubtitleParseErrorCode.SUBTITLE_TOO_LARGE);
  });

  it('rejects Latin-1 and UTF-16 encodings', () => {
    const latin1 = Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nB\xe0i gi\xe1ng\n', 'latin1');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${VTT_HEADER}00:00:00.000 --> 00:00:01.000\nxin chao\n`, 'utf16le')]);

    expectFailure(latin1, 'VTT', SubtitleParseErrorCode.SUBTITLE_ENCODING_INVALID);
    expectFailure(utf16, 'VTT', SubtitleParseErrorCode.SUBTITLE_ENCODING_INVALID);
  });

  it('rejects NUL and C1 control characters with their line', () => {
    expectFailure(Buffer.from(`${VTT_HEADER}00:00:00.000 --> 00:00:01.000\nxin\u0000chao\n`, 'utf8'), 'VTT', SubtitleParseErrorCode.SUBTITLE_ENCODING_INVALID, 4);
    expectFailure(Buffer.from(`1\n00:00:00,000 --> 00:00:01,000\nxin\u0085chao\n`, 'utf8'), 'SRT', SubtitleParseErrorCode.SUBTITLE_ENCODING_INVALID, 3);
  });

  it.each([
    ['missing WEBVTT header', Buffer.from('00:00:00.000 --> 00:00:01.000\nxin chao\n', 'utf8'), 'VTT', 1],
    ['WEBVTT glued to text', Buffer.from('WEBVTTX\n\n00:00:00.000 --> 00:00:01.000\nxin chao\n', 'utf8'), 'VTT', 1],
    ['timing swallowed by header', Buffer.from('WEBVTT\n00:00:00.000 --> 00:00:01.000\nxin chao\n', 'utf8'), 'VTT', 2],
    ['VTT file used as SRT', Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nxin chao\n', 'utf8'), 'SRT', 1],
    ['block without timing', vttWithBlocks('khong co moc thoi gian'), 'VTT', 3],
    ['SRT index without timing', srtWithBlocks('1\nxin chao'), 'SRT', 1],
    ['arrow inside VTT payload', vttWithBlocks('00:00:00.000 --> 00:00:01.000\na --> b'), 'VTT', 4],
    ['arrow inside SRT payload', srtWithBlocks('1\n00:00:00,000 --> 00:00:01,000\na --> b'), 'SRT', 3],
  ] as const)('rejects %s as a format error', (_label, source, format, line) => {
    expectFailure(source, format, SubtitleParseErrorCode.SUBTITLE_FORMAT_INVALID, line);
  });

  it.each([
    ['61 seconds', vttWithBlocks('00:00:61.000 --> 00:01:02.000\nx'), 'VTT', 3],
    ['61 minutes', vttWithBlocks('00:61:00.000 --> 01:02:00.000\nx'), 'VTT', 3],
    ['2-digit milliseconds in VTT', vttWithBlocks('00:00:01.00 --> 00:00:02.000\nx'), 'VTT', 3],
    ['comma milliseconds in VTT', vttWithBlocks('00:00:01,000 --> 00:00:02.000\nx'), 'VTT', 3],
    ['end equals start', vttWithBlocks('00:00:01.000 --> 00:00:01.000\nx'), 'VTT', 3],
    ['end before start', vttWithBlocks('00:00:02.000 --> 00:00:01.000\nx'), 'VTT', 3],
    ['end beyond 24 hours', vttWithBlocks('00:00:01.000 --> 24:00:01.000\nx'), 'VTT', 3],
    ['SRT without milliseconds', srtWithBlocks('1\n00:00:01 --> 00:00:02,000\nx'), 'SRT', 2],
    ['SRT end equals start', srtWithBlocks('1\n00:00:01,000 --> 00:00:01,000\nx'), 'SRT', 2],
  ] as const)('rejects %s as a timestamp error', (_label, source, format, line) => {
    expectFailure(source, format, SubtitleParseErrorCode.SUBTITLE_TIMESTAMP_INVALID, line);
  });

  it('rejects the 10,001st cue before sanitizing the rest', () => {
    const source = srtWithBlocks(...Array.from({ length: 10_001 }, (_, index) => `${index + 1}\n00:00:00,000 --> 00:00:01,000\nx`));

    expectFailure(source, 'SRT', SubtitleParseErrorCode.SUBTITLE_TOO_MANY_CUES);
  });

  it('rejects a cue of 2,001 code points with the timing line', () => {
    const source = vttWithBlocks(`00:00:00.000 --> 00:00:01.000\n${'a'.repeat(2001)}`);

    expectFailure(source, 'VTT', SubtitleParseErrorCode.SUBTITLE_CUE_TOO_LONG, 3);
  });

  it('counts a cue in code points, not UTF-16 units', () => {
    const source = vttWithBlocks(`00:00:00.000 --> 00:00:01.000\n${'😀'.repeat(2000)}`);

    expect(parseSubtitle(source, 'VTT').charCount).toBe(2000);
  });

  it('rejects more than 500,000 code points in total', () => {
    const cueText = 'a'.repeat(2000);
    const cueCount = 251;
    const source = srtWithBlocks(...Array.from({ length: cueCount }, (_, index) => `${index + 1}\n00:00:00,000 --> 00:00:01,000\n${cueText}`));

    expectFailure(source, 'SRT', SubtitleParseErrorCode.SUBTITLE_TOO_MANY_CHARS);
  });
});

describe('parseSubtitle sanitizer hardening', () => {
  function cueText(payload: string): string {
    return parseSubtitle(vttWithBlocks(`00:00:00.000 --> 00:00:01.000\n${payload}`), 'VTT').cues[0].text;
  }

  it.each([
    ['a&#0;b&#0;c'],
    ['a&#1;&#1;d'],
    ['&#1;&#x85;&#x85;x'],
    ['x&#x7F;y'],
    ['x&#8;y'],
  ])('rejects entity-encoded controls in %s', (payload) => {
    expectFailure(vttWithBlocks(`00:00:00.000 --> 00:00:01.000\n${payload}`), 'VTT', SubtitleParseErrorCode.SUBTITLE_ENCODING_INVALID);
  });

  it('keeps entity-encoded tab, newline and carriage return as whitespace', () => {
    expect(cueText('a&#9;b&#10;c&#13;d')).toBe('a b c d');
  });

  it('strips any well-formed tag but keeps escaped markup and lone angle brackets as text', () => {
    expect(cueText('x<br>y <span class=x>z</span> &lt;script&gt; 1 < 2 > 0')).toBe('xy z <script> 1 < 2 > 0');
  });

  it('removes Arabic letter mark and Mongolian vowel separator', () => {
    expect(cueText('a؜b᠎c')).toBe('abc');
  });
});
