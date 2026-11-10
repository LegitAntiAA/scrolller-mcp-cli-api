/** Unit tests for the BUG-1 download rule (CONTRACT.md §7): download URLs come
 * ONLY from post-level `mediaSources[]`; `fullLengthSource`/`gfycatSource`/
 * `redgifsSource` are reference PAGE URLs and are never media files.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bestMediaSource } from "../src/download.js";
import { DownloadError } from "../src/errors.js";

const gfycatPageUrl = "https://gfycat.com/somename-quick-fox"; // a PAGE, not a media file
const redgifsPageUrl = "https://www.redgifs.com/watch/somename"; // a PAGE, not a media file

function media(url: string, type: string | null, width: number | null, height: number | null) {
  return { url, type, width, height, isOptimized: null };
}

test("images: picks the largest-area mediaSources entry", () => {
  const post = {
    mediaSources: [
      media("https://images.scrolller.com/zepto/a-108x144.webp", "WEBP", 108, 144),
      media("https://images.scrolller.com/zepto/b-1080x1440.jpg", "JPEG", 1080, 1440),
      media("https://images.scrolller.com/zepto/c-640x853.webp", "WEBP", 640, 853),
    ],
  };
  const source = bestMediaSource(post);
  assert.equal(source.url, "https://images.scrolller.com/zepto/b-1080x1440.jpg");
});

test("videos: picks the largest-area MP4/WEBM entry, ignoring image thumbnails", () => {
  const post = {
    mediaSources: [
      media("https://images.scrolller.com/yocto/v-480x360.webp", "WEBP", 480, 360),
      media("https://atto.scrolller.com/v.mp4", "MP4", 1920, 1080),
      media("https://atto.scrolller.com/v.webm", "WEBM", 1280, 720),
    ],
  };
  const source = bestMediaSource(post);
  assert.equal(source.url, "https://atto.scrolller.com/v.mp4");
});

test("videos: larger WEBM beats MP4 when both are present", () => {
  const post = {
    mediaSources: [
      media("https://atto.scrolller.com/v.mp4", "MP4", 640, 360),
      media("https://atto.scrolller.com/v.webm", "WEBM", 1920, 1080),
    ],
  };
  const source = bestMediaSource(post);
  assert.equal(source.url, "https://atto.scrolller.com/v.webm");
});

test("videos: an .mp4 URL without a type field is still treated as a video", () => {
  const post = {
    mediaSources: [
      media("https://images.scrolller.com/zepto/big-5000x5000.jpg", "JPEG", 5000, 5000),
      { url: "https://atto.scrolller.com/clip.mp4", width: 640, height: 360 },
    ],
  };
  const source = bestMediaSource(post);
  assert.equal(source.url, "https://atto.scrolller.com/clip.mp4");
});

test("BUG-1: fullLengthSource/gfycatSource/redgifsSource page links are NEVER picked", () => {
  const post = {
    fullLengthSource: gfycatPageUrl,
    gfycatSource: gfycatPageUrl,
    redgifsSource: redgifsPageUrl,
    mediaSources: [
      media("https://images.scrolller.com/yocto/v-480x360.webp", "WEBP", 480, 360),
      media("https://atto.scrolller.com/v.mp4", "MP4", 1280, 720),
    ],
  };
  const source = bestMediaSource(post);
  assert.equal(source.url, "https://atto.scrolller.com/v.mp4");
  assert.notEqual(source.url, gfycatPageUrl);
  assert.notEqual(source.url, redgifsPageUrl);
});

test("BUG-1: a post with ONLY page-link fields and no mediaSources is unusable", () => {
  const post = { fullLengthSource: gfycatPageUrl, gfycatSource: gfycatPageUrl, redgifsSource: redgifsPageUrl };
  assert.throws(() => bestMediaSource(post), DownloadError);
});

test("literal 'undefined'/'null' url strings inside mediaSources are skipped", () => {
  const post = {
    mediaSources: [
      { url: "undefined", type: "MP4", width: 9999, height: 9999 },
      { url: "null", type: "WEBP", width: 500, height: 500 },
      media("https://images.scrolller.com/zepto/ok-640x853.jpg", "JPEG", 640, 853),
    ],
  };
  const source = bestMediaSource(post);
  assert.equal(source.url, "https://images.scrolller.com/zepto/ok-640x853.jpg");
});

test("string dimensions are parsed as numbers", () => {
  const post = {
    mediaSources: [
      { url: "https://images.scrolller.com/zepto/a-1080x1440.jpg", type: "JPEG", width: "1080", height: "1440" },
      { url: "https://images.scrolller.com/zepto/b-108x144.webp", type: "WEBP", width: "108", height: "144" },
    ],
  };
  const source = bestMediaSource(post);
  assert.equal(source.url, "https://images.scrolller.com/zepto/a-1080x1440.jpg");
});

test("entries without dimensions still rank by area 0 but remain usable alone", () => {
  const source = bestMediaSource({ mediaSources: [{ url: "https://atto.scrolller.com/v.mp4", type: "MP4" }] });
  assert.equal(source.url, "https://atto.scrolller.com/v.mp4");
});

test("missing or empty mediaSources throws DownloadError", () => {
  assert.throws(() => bestMediaSource({}), DownloadError);
  assert.throws(() => bestMediaSource({ mediaSources: [] }), DownloadError);
  assert.throws(() => bestMediaSource({ mediaSources: [{ url: "undefined" }] }), DownloadError);
});
