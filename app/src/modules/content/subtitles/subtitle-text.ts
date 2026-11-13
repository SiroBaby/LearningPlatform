import { SubtitleParseError, SubtitleParseErrorCode } from './subtitle-parse-error';
import { MAX_SUBTITLE_BYTES } from './subtitle.constants';

const BYTE_ORDER_MARK = '﻿';
const FORBIDDEN_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const MARKUP_TAG_PATTERN =
  /<\/?(?:c|v|b|i|u|ruby|rt|lang|font)(?:[. \t][^<>]*)?>|<(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}>/giu;
const STYLE_OVERRIDE_PATTERN = /\{\\[^{}]*\}/gu;
const ENTITY_PATTERN = /&(amp|lt|gt|nbsp|quot|apos|lrm|rlm|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/gu;
const INVISIBLE_FORMATTING_PATTERN = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;
const WHITESPACE_RUN_PATTERN = /\s+/gu;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_RANGE_START = 0xd800;
const SURROGATE_RANGE_END = 0xdfff;
const HEXADECIMAL_RADIX = 16;
const DECIMAL_RADIX = 10;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lrm: '',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  rlm: '',
};

/**
 * Decodes strict UTF-8, strips one BOM, rejects control characters, unifies line breaks to LF and applies NFC.
 * Line numbers in the result match the source file.
 */
export function decodeSubtitleText(source: Buffer): string {
  if (source.length > MAX_SUBTITLE_BYTES) {
    throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_TOO_LARGE);
  }
  const decoded = decodeUtf8Strictly(source);
  const withoutBom = decoded.startsWith(BYTE_ORDER_MARK) ? decoded.slice(1) : decoded;
  const unified = withoutBom.replace(/\r\n?/gu, '\n');
  assertNoForbiddenControls(unified);
  return unified.normalize('NFC');
}

function decodeUtf8Strictly(source: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
  } catch {
    throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_ENCODING_INVALID);
  }
}

function assertNoForbiddenControls(text: string): void {
  const match = FORBIDDEN_CONTROL_PATTERN.exec(text);
  if (!match) return;
  throw new SubtitleParseError(
    SubtitleParseErrorCode.SUBTITLE_ENCODING_INVALID,
    countLinesBefore(text, match.index),
  );
}

function countLinesBefore(text: string, index: number): number {
  let line = 1;
  for (let position = text.indexOf('\n'); position !== -1 && position < index; position = text.indexOf('\n', position + 1)) {
    line += 1;
  }
  return line;
}

/**
 * Turns cue payload lines into one plain-text string: markup and style overrides are removed first, then entities
 * are decoded exactly once, so `&lt;script&gt;` ends up as inert literal text.
 */
export function sanitizeCuePayload(payloadLines: readonly string[]): string {
  const withoutMarkup = payloadLines
    .join('\n')
    .replace(MARKUP_TAG_PATTERN, '')
    .replace(STYLE_OVERRIDE_PATTERN, '');
  return decodeEntities(withoutMarkup)
    .replace(INVISIBLE_FORMATTING_PATTERN, '')
    .replace(FORBIDDEN_CONTROL_PATTERN, '')
    .replace(WHITESPACE_RUN_PATTERN, ' ')
    .trim()
    .normalize('NFC');
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (_match, name: string) => decodeEntity(name));
}

function decodeEntity(name: string): string {
  if (!name.startsWith('#')) return NAMED_ENTITIES[name] ?? '';
  const isHexadecimal = name[1] === 'x' || name[1] === 'X';
  const codePoint = isHexadecimal
    ? Number.parseInt(name.slice(2), HEXADECIMAL_RADIX)
    : Number.parseInt(name.slice(1), DECIMAL_RADIX);
  const isSurrogate = codePoint >= SURROGATE_RANGE_START && codePoint <= SURROGATE_RANGE_END;
  if (codePoint > MAX_CODE_POINT || isSurrogate) return '';
  return String.fromCodePoint(codePoint);
}

export function countCodePoints(text: string): number {
  let count = 0;
  for (const _codePoint of text) count += 1;
  return count;
}
