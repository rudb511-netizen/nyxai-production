import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  audioHostAllowed,
  contentSpan,
  entireTrackRange,
  isStreamableAudioType,
  musicStreamPath,
  parseAudioSource,
  redirectTargetAllowed,
  remoteAudioUrl,
  safeRangeHeader,
  spanReachesEnd,
  streamContentType,
  streamPlaybackSources,
  typeFromAudioMagic,
} from "./music-stream.ts";

describe("music stream allowlist", () => {
  it("accepts licensed preview and storage hosts", () => {
    assert.equal(audioHostAllowed("audio-ssl.itunes.apple.com"), true);
    assert.equal(audioHostAllowed("prod-1.storage.jamendo.com"), true);
    assert.equal(audioHostAllowed("cdn.example.cloudfront.net"), true);
    assert.ok(parseAudioSource("https://archive.org/download/ambient_151/ambient.mp3"));
    assert.ok(parseAudioSource("https://ia801234.us.archive.org/0/items/ambient_151/ambient.mp3"));
    assert.equal(redirectTargetAllowed(new URL("https://archive.org/download/ambient_151/ambient.mp3"), new URL("https://evil.example/stolen.mp3")), null);
    const from = new URL("https://discoveryprovider.audius.co/v1/tracks/abc/stream");
    assert.equal(redirectTargetAllowed(from, new URL("https://v.monophonic.digital/tracks/x"))?.hostname, "v.monophonic.digital");
    assert.equal(redirectTargetAllowed(from, new URL("http://169.254.169.254/x")), null);
    assert.equal(redirectTargetAllowed(new URL("https://evil.example/a"), new URL("https://v.monophonic.digital/x")), null);
  });

  it("rejects private hosts, credentials, http, and non-http URLs", () => {
    assert.equal(parseAudioSource("https://user:pass@audio-ssl.itunes.apple.com/a.m4a"), null);
    assert.equal(parseAudioSource("http://audio-ssl.itunes.apple.com/a.m4a"), null);
    assert.equal(parseAudioSource("http://127.0.0.1/a.mp3"), null);
    assert.equal(parseAudioSource("http://169.254.169.254/latest"), null);
    assert.equal(parseAudioSource("https://localhost/a.mp3"), null);
    assert.equal(parseAudioSource("file:///etc/passwd"), null);
    assert.equal(parseAudioSource("https://evil.example/a.mp3"), null);
    assert.equal(musicStreamPath("https://evil.example/a.mp3"), null);
  });

  it("builds a same-origin stream URL and keeps the direct file as fallback", () => {
    const remote = "https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a";
    const sources = streamPlaybackSources([{ src: remote, type: "audio/mp4" }]);
    assert.equal(sources.length, 2);
    assert.equal(sources[0].src, `/api/music-stream?u=${encodeURIComponent(remote)}`);
    assert.equal(sources[0].type, "audio/mp4");
    assert.equal(sources[1].src, remote);
    assert.equal(safeRangeHeader("bytes=0-64"), "bytes=0-64");
    assert.equal(safeRangeHeader("bytes=100-"), "bytes=100-");
    assert.equal(safeRangeHeader("bytes=0-1,2-3"), null);
  });

  it("serves an open or start-at-zero range as the entire track", () => {
    assert.equal(entireTrackRange("bytes=0-"), null);
    assert.equal(entireTrackRange("bytes=0-1048575"), null);
    assert.equal(entireTrackRange("bytes=0-64"), null);
    assert.equal(entireTrackRange(null), null);
    assert.equal(entireTrackRange("bytes=100-"), "bytes=100-");
    assert.equal(entireTrackRange("bytes=100-200"), "bytes=100-");
    assert.equal(entireTrackRange("bytes=0-1,2-3"), null);
    const full = contentSpan("bytes 0-2820608/2820609");
    assert.deepEqual(full, { start: 0, end: 2820608, total: 2820609 });
    assert.equal(spanReachesEnd(full), true);
    assert.equal(spanReachesEnd(contentSpan("bytes 0-1048575/2820609")), false);
    assert.equal(spanReachesEnd(null), true);
  });

  it("accepts audio bytes and rejects documents", () => {
    assert.equal(isStreamableAudioType("audio/mp4"), true);
    assert.equal(isStreamableAudioType("audio/mpeg; charset=binary"), true);
    assert.equal(isStreamableAudioType("application/octet-stream"), true);
    assert.equal(isStreamableAudioType(""), true);
    assert.equal(isStreamableAudioType("text/html"), false);
    assert.equal(isStreamableAudioType("application/json"), false);
    assert.equal(streamContentType("audio/x-m4p"), "audio/mp4");
    assert.equal(streamContentType("audio/mpeg"), "audio/mpeg");
    assert.equal(streamContentType("application/octet-stream"), "application/octet-stream");
    assert.equal(typeFromAudioMagic(Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0, 0])), "audio/mpeg");
    const ftyp = new Uint8Array(12);
    ftyp.set([0x66, 0x74, 0x79, 0x70], 4);
    assert.equal(typeFromAudioMagic(ftyp), "audio/mp4");
    assert.equal(typeFromAudioMagic(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c])), null);
  });

  it("unwraps the licensed URL from a stream path", () => {
    const remote = "https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a";
    const path = musicStreamPath(remote);
    assert.ok(path);
    assert.equal(remoteAudioUrl(`${path}&access=secret`), remote);
    assert.equal(remoteAudioUrl(remote), remote);
    assert.equal(remoteAudioUrl("/api/music-stream?u=https%3A%2F%2Fevil.example%2Fa.mp3"), "/api/music-stream?u=https%3A%2F%2Fevil.example%2Fa.mp3");
  });
});
