const MAX_YOUTUBE_URL_LENGTH = 2048;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_HOSTNAMES: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const SHORT_LINK_HOSTNAME = 'youtu.be';
const PATH_PREFIXES_WITH_VIDEO_ID: readonly string[] = ['shorts', 'embed', 'live', 'v'];

/** Returns true when the value is a syntactically valid YouTube video id. */
export function isYoutubeVideoId(value: string): boolean {
  return YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

/**
 * Extracts the canonical video id from an accepted YouTube URL. Returns null for anything else
 * (playlists, channels, handles, search pages, other hosts, userinfo, custom ports, conflicting `v`).
 * The raw URL must never be persisted; only the returned id is.
 */
export function normalizeYoutubeVideoId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_YOUTUBE_URL_LENGTH) return null;
  const url = parseUrl(trimmed);
  if (!url || !isPlainWebUrl(url)) return null;
  const hostname = url.hostname.toLowerCase();
  const segments = splitPathSegments(url.pathname);
  if (hostname === SHORT_LINK_HOSTNAME) return extractShortLinkId(segments);
  if (!YOUTUBE_HOSTNAMES.has(hostname)) return null;
  return extractYoutubeHostId(url, segments);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isPlainWebUrl(url: URL): boolean {
  const isWebProtocol = url.protocol === 'https:' || url.protocol === 'http:';
  return isWebProtocol && url.username === '' && url.password === '' && url.port === '';
}

/** Splits the path into segments, tolerating one trailing slash but no empty inner segment. */
function splitPathSegments(pathname: string): string[] | null {
  const segments = pathname.split('/').slice(1);
  if (segments.length > 0 && segments[segments.length - 1] === '') segments.pop();
  return segments.every((segment) => segment.length > 0) ? segments : null;
}

function extractShortLinkId(segments: string[] | null): string | null {
  if (!segments || segments.length !== 1) return null;
  return toVideoId(segments[0]);
}

function extractYoutubeHostId(url: URL, segments: string[] | null): string | null {
  if (!segments) return null;
  if (segments.length === 1 && segments[0] === 'watch') return extractWatchId(url);
  if (segments.length === 2 && PATH_PREFIXES_WITH_VIDEO_ID.includes(segments[0])) {
    return toVideoId(segments[1]);
  }
  return null;
}

function extractWatchId(url: URL): string | null {
  const distinctValues = new Set(url.searchParams.getAll('v'));
  if (distinctValues.size !== 1) return null;
  return toVideoId([...distinctValues][0]);
}

function toVideoId(candidate: string): string | null {
  return isYoutubeVideoId(candidate) ? candidate : null;
}
