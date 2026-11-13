/**
 * Extracts the video id from a pasted YouTube link. Mirrors the backend normalizer
 * (`app/src/modules/content/youtube/youtube-video-id.ts`): both must accept and reject the same links.
 */

const MAX_URL_LENGTH = 2048;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const SHORT_HOST = "youtu.be";
const EMBED_HOSTS: ReadonlySet<string> = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const SHORT_PATH_PATTERN = /^\/([A-Za-z0-9_-]{11})\/?$/u;
const KIND_PATH_PATTERN = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})\/?$/u;
const WATCH_PATH_PATTERN = /^\/watch\/?$/u;

function readWatchVideoId(searchParams: URLSearchParams): string | null {
  const distinctIds = new Set(searchParams.getAll("v"));
  if (distinctIds.size !== 1) return null;
  const [videoId] = distinctIds;
  return VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

function readPathVideoId(url: URL): string | null {
  if (url.hostname === SHORT_HOST) return SHORT_PATH_PATTERN.exec(url.pathname)?.[1] ?? null;
  if (!EMBED_HOSTS.has(url.hostname)) return null;
  if (WATCH_PATH_PATTERN.test(url.pathname)) return readWatchVideoId(url.searchParams);
  return KIND_PATH_PATTERN.exec(url.pathname)?.[1] ?? null;
}

/** Returns the 11-character video id, or null when the text is not an accepted YouTube video link. */
export function parseYoutubeVideoId(input: string): string | null {
  const text = input.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;
  return readPathVideoId(url);
}
