import assert from "node:assert/strict";
import { test } from "node:test";

import { parseYoutubeVideoId } from "./youtube-video-id.ts";

const ID = "dQw4w9WgXcQ";

const ACCEPTED = [
  [`https://www.youtube.com/watch?v=${ID}`, "watch on www"],
  [`https://youtube.com/watch?v=${ID}`, "watch on the bare host"],
  [`https://m.youtube.com/watch?v=${ID}`, "mobile host"],
  [`http://www.youtube.com/watch?v=${ID}`, "http is normalized"],
  [`  https://www.youtube.com/watch?v=${ID}  `, "surrounding spaces"],
  [`https://WWW.YouTube.com/watch?v=${ID}`, "host case"],
  [`https://www.youtube.com/watch?v=${ID}&list=PL1&t=30s`, "extra params are ignored"],
  [`https://www.youtube.com/watch?feature=share&v=${ID}`, "v after other params"],
  [`https://www.youtube.com/watch/?v=${ID}`, "trailing slash on watch"],
  [`https://www.youtube.com/watch?v=${ID}&v=${ID}`, "the same v twice"],
  [`https://www.youtube.com/shorts/${ID}`, "shorts"],
  [`https://www.youtube.com/embed/${ID}`, "embed"],
  [`https://www.youtube.com/live/${ID}`, "live"],
  [`https://www.youtube.com/v/${ID}`, "v path"],
  [`https://www.youtube.com/shorts/${ID}/`, "trailing slash"],
  [`https://youtu.be/${ID}`, "short link"],
  [`https://youtu.be/${ID}?t=10`, "short link with time"],
  [`https://www.youtube-nocookie.com/embed/${ID}`, "nocookie www"],
  [`https://youtube-nocookie.com/embed/${ID}`, "nocookie bare"],
  [`https://www.youtube.com:443/watch?v=${ID}`, "default port"],
  ["https://www.youtube.com/watch?v=abc_DEF-123", "id with underscore and hyphen"],
];

for (const [input, label] of ACCEPTED) {
  test(`accepts ${label}`, () => {
    const videoId = parseYoutubeVideoId(input);
    assert.match(videoId ?? "", /^[A-Za-z0-9_-]{11}$/u);
  });
}

test("returns the exact id", () => {
  assert.equal(parseYoutubeVideoId(`https://youtu.be/${ID}`), ID);
  assert.equal(parseYoutubeVideoId(`https://www.youtube.com/watch?v=${ID}&list=x`), ID);
});

const REJECTED = [
  ["", "empty"],
  ["   ", "blank"],
  [ID, "a bare id"],
  [`www.youtube.com/watch?v=${ID}`, "no scheme"],
  [`ftp://www.youtube.com/watch?v=${ID}`, "other scheme"],
  [`javascript:alert(1)//youtube.com/watch?v=${ID}`, "javascript scheme"],
  [`https://music.youtube.com/watch?v=${ID}`, "music host"],
  [`https://evil.com/watch?v=${ID}`, "other host"],
  [`https://www.youtube.com.evil.com/watch?v=${ID}`, "look-alike host"],
  [`https://evilyoutube.com/watch?v=${ID}`, "suffix host"],
  [`https://user:pass@www.youtube.com/watch?v=${ID}`, "userinfo"],
  [`https://www.youtube.com:8443/watch?v=${ID}`, "non-default port"],
  ["https://www.youtube.com/watch", "missing v"],
  ["https://www.youtube.com/watch?v=", "empty v"],
  [`https://www.youtube.com/watch?v=${ID}&v=aaaaaaaaaaa`, "conflicting v"],
  ["https://www.youtube.com/watch?v=short", "short id"],
  [`https://www.youtube.com/watch?v=${ID}x`, "long id"],
  ["https://www.youtube.com/watch?v=abc$%&def12", "illegal characters"],
  ["https://www.youtube.com/playlist?list=PL12345678901", "playlist"],
  ["https://www.youtube.com/channel/UC1234567890123456789012", "channel"],
  ["https://www.youtube.com/@handle", "handle"],
  ["https://www.youtube.com/results?search_query=x", "search results"],
  [`https://www.youtube.com/shorts/${ID}/extra`, "extra path segment"],
  [`https://www.youtube.com/embed/${ID}x`, "long embed id"],
  [`https://youtu.be/${ID}/more`, "short link with extra path"],
  [`https://youtu.be/watch?v=${ID}`, "watch on the short host"],
  [`https://www.youtube.com/${ID}`, "id at the root of the main host"],
  [`https://www.youtube.com/watch?v=${ID}${"a".repeat(2100)}`, "over 2048 characters"],
];

for (const [input, label] of REJECTED) {
  test(`rejects ${label}`, () => {
    assert.equal(parseYoutubeVideoId(input), null);
  });
}
