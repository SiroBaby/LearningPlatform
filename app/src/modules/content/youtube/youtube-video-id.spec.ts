import { describe, expect, it } from '@jest/globals';

import { isYoutubeVideoId, normalizeYoutubeVideoId } from './youtube-video-id';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('normalizeYoutubeVideoId', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${VIDEO_ID}`],
    [`https://youtube.com/watch?v=${VIDEO_ID}&t=42s&list=PLx`],
    [`https://m.youtube.com/watch?v=${VIDEO_ID}`],
    [`http://www.youtube.com/watch?v=${VIDEO_ID}`],
    [`  https://www.youtube.com/watch?v=${VIDEO_ID}  `],
    [`https://WWW.YouTube.com/watch?v=${VIDEO_ID}`],
    [`https://www.youtube.com/watch/?v=${VIDEO_ID}`],
    [`https://www.youtube.com/watch?v=${VIDEO_ID}&v=${VIDEO_ID}`],
    [`https://www.youtube.com/shorts/${VIDEO_ID}`],
    [`https://www.youtube.com/shorts/${VIDEO_ID}/`],
    [`https://www.youtube.com/embed/${VIDEO_ID}?start=3`],
    [`https://www.youtube.com/live/${VIDEO_ID}?si=abc`],
    [`https://www.youtube.com/v/${VIDEO_ID}`],
    [`https://youtu.be/${VIDEO_ID}`],
    [`https://youtu.be/${VIDEO_ID}?t=10`],
    [`http://youtu.be/${VIDEO_ID}`],
    [`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`],
    [`https://youtube-nocookie.com/embed/${VIDEO_ID}`],
  ])('accepts %s', (input) => {
    expect(normalizeYoutubeVideoId(input)).toBe(VIDEO_ID);
  });

  it.each([
    ['music host', `https://music.youtube.com/watch?v=${VIDEO_ID}`],
    ['lookalike host', `https://www.youtube.com.evil.example/watch?v=${VIDEO_ID}`],
    ['suffix host', `https://notyoutube.com/watch?v=${VIDEO_ID}`],
    ['userinfo', `https://user:pass@www.youtube.com/watch?v=${VIDEO_ID}`],
    ['custom port', `https://www.youtube.com:8443/watch?v=${VIDEO_ID}`],
    ['ftp protocol', `ftp://www.youtube.com/watch?v=${VIDEO_ID}`],
    ['javascript protocol', 'javascript:alert(1)'],
    ['playlist', 'https://www.youtube.com/playlist?list=PLabcdefghij'],
    ['channel', 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'],
    ['handle', 'https://www.youtube.com/@someone'],
    ['results', 'https://www.youtube.com/results?search_query=abc'],
    ['missing v', 'https://www.youtube.com/watch'],
    ['conflicting v', `https://www.youtube.com/watch?v=${VIDEO_ID}&v=aaaaaaaaaaa`],
    ['short id', 'https://www.youtube.com/watch?v=short'],
    ['long id', `https://www.youtube.com/watch?v=${VIDEO_ID}x`],
    ['bad characters', 'https://www.youtube.com/watch?v=dQw4w9WgXc!'],
    ['extra path segment', `https://www.youtube.com/embed/${VIDEO_ID}/extra`],
    ['empty path segment', `https://www.youtube.com/embed//${VIDEO_ID}`],
    ['short link with path', `https://youtu.be/${VIDEO_ID}/extra`],
    ['short link root', 'https://youtu.be/'],
    ['empty string', ''],
    ['whitespace', '   '],
    ['not a url', 'khong-phai-link'],
    ['over 2048 chars', `https://www.youtube.com/watch?v=${VIDEO_ID}&x=${'a'.repeat(2048)}`],
  ])('rejects %s', (_label, input) => {
    expect(normalizeYoutubeVideoId(input)).toBeNull();
  });
});

describe('isYoutubeVideoId', () => {
  it('accepts exactly 11 url-safe characters', () => {
    expect(isYoutubeVideoId(VIDEO_ID)).toBe(true);
    expect(isYoutubeVideoId('a_b-C1d2E3f')).toBe(true);
    expect(isYoutubeVideoId('abc')).toBe(false);
    expect(isYoutubeVideoId(`${VIDEO_ID}\n`)).toBe(false);
  });
});
