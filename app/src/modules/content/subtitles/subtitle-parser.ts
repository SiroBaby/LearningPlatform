import { SubtitleParseError, SubtitleParseErrorCode } from './subtitle-parse-error';
import {
  MAX_SUBTITLE_CHARS,
  MAX_SUBTITLE_CUE_CHARS,
  MAX_SUBTITLE_CUES,
} from './subtitle.constants';
import { countCodePoints, decodeSubtitleText, sanitizeCuePayload } from './subtitle-text';
import { looksLikeTimingLine, parseTimingLine, type TimingRange } from './subtitle-timing';
import type { ParsedSubtitle, SubtitleCue, SubtitleFormat } from './subtitle.types';

interface SourceLine {
  readonly number: number;
  readonly text: string;
}

type SourceBlock = readonly SourceLine[];

interface RawCue extends TimingRange {
  readonly timingLineNumber: number;
  readonly payload: readonly string[];
}

const VTT_HEADER_PATTERN = /^WEBVTT(?:[ \t].*)?$/u;
const VTT_SKIPPED_BLOCK_PATTERN = /^(?:NOTE|STYLE|REGION)(?:[ \t].*)?$/u;
const SRT_INDEX_PATTERN = /^\d+$/u;
const BLANK_LINE_PATTERN = /^[ \t]*$/u;

/**
 * Parses a WebVTT or SRT subtitle file into sanitized, start-ordered cues.
 * Linear and bounded: size, cue count and character caps are enforced while reading.
 */
export function parseSubtitle(source: Buffer, format: SubtitleFormat): ParsedSubtitle {
  const text = decodeSubtitleText(source);
  if (text.trim() === '') throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_EMPTY);
  const blocks = splitIntoBlocks(text);
  const rawCues = format === 'VTT' ? collectVttCues(blocks) : collectSrtCues(blocks);
  return buildParsedSubtitle(format, rawCues);
}

function splitIntoBlocks(text: string): SourceBlock[] {
  const blocks: SourceLine[][] = [];
  let current: SourceLine[] = [];
  text.split('\n').forEach((lineText, index) => {
    if (BLANK_LINE_PATTERN.test(lineText)) {
      if (current.length > 0) blocks.push(current);
      current = [];
      return;
    }
    current.push({ number: index + 1, text: lineText });
  });
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function collectVttCues(blocks: readonly SourceBlock[]): RawCue[] {
  const [header, ...body] = blocks;
  assertVttHeader(header);
  const cues: RawCue[] = [];
  for (const block of body) {
    if (VTT_SKIPPED_BLOCK_PATTERN.test(block[0].text)) continue;
    cues.push(parseCueBlock(block, 'VTT', findVttTimingIndex(block)));
    assertCueCount(cues.length);
  }
  return cues;
}

function assertVttHeader(header: SourceBlock | undefined): void {
  if (!header || !VTT_HEADER_PATTERN.test(header[0].text)) {
    throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_FORMAT_INVALID, header?.[0].number ?? 1);
  }
  const misplacedTiming = header.find((line) => looksLikeTimingLine(line.text));
  if (misplacedTiming) {
    throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_FORMAT_INVALID, misplacedTiming.number);
  }
}

function findVttTimingIndex(block: SourceBlock): number {
  if (looksLikeTimingLine(block[0].text)) return 0;
  if (block.length > 1 && looksLikeTimingLine(block[1].text)) return 1;
  throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_FORMAT_INVALID, block[0].number);
}

function collectSrtCues(blocks: readonly SourceBlock[]): RawCue[] {
  const cues: RawCue[] = [];
  for (const block of blocks) {
    cues.push(parseCueBlock(block, 'SRT', findSrtTimingIndex(block)));
    assertCueCount(cues.length);
  }
  return cues;
}

function findSrtTimingIndex(block: SourceBlock): number {
  if (looksLikeTimingLine(block[0].text)) return 0;
  const hasIndexLine = SRT_INDEX_PATTERN.test(block[0].text.trim());
  if (hasIndexLine && block.length > 1 && looksLikeTimingLine(block[1].text)) return 1;
  throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_FORMAT_INVALID, block[0].number);
}

function parseCueBlock(block: SourceBlock, format: SubtitleFormat, timingIndex: number): RawCue {
  const timingLine = block[timingIndex];
  const range = parseTimingLine(timingLine.text, format);
  if (!range) {
    throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_TIMESTAMP_INVALID, timingLine.number);
  }
  const payloadLines = block.slice(timingIndex + 1);
  const misplacedTiming = payloadLines.find((line) => looksLikeTimingLine(line.text));
  if (misplacedTiming) {
    throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_FORMAT_INVALID, misplacedTiming.number);
  }
  return { ...range, payload: payloadLines.map((line) => line.text), timingLineNumber: timingLine.number };
}

function assertCueCount(count: number): void {
  if (count > MAX_SUBTITLE_CUES) {
    throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_TOO_MANY_CUES);
  }
}

function buildParsedSubtitle(format: SubtitleFormat, rawCues: readonly RawCue[]): ParsedSubtitle {
  const cues: SubtitleCue[] = [];
  let charCount = 0;
  for (const rawCue of rawCues) {
    const text = sanitizeCuePayload(rawCue.payload);
    if (text === '') continue;
    const cueChars = countCodePoints(text);
    if (cueChars > MAX_SUBTITLE_CUE_CHARS) {
      throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_CUE_TOO_LONG, rawCue.timingLineNumber);
    }
    charCount += cueChars;
    if (charCount > MAX_SUBTITLE_CHARS) {
      throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_TOO_MANY_CHARS);
    }
    cues.push({ startMs: rawCue.startMs, endMs: rawCue.endMs, text });
  }
  if (cues.length === 0) throw new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_EMPTY);
  // Array.prototype.sort is stable, so cues that share a start keep their file order.
  const ordered = [...cues].sort((left, right) => left.startMs - right.startMs);
  return {
    charCount,
    cueCount: ordered.length,
    cues: ordered,
    durationMs: Math.max(...ordered.map((cue) => cue.endMs)),
    format,
  };
}
