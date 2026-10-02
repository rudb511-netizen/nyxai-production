import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatTimecode,
  isPlayableReady,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
  playbackErrorMessage,
  videoAspectClass,
} from "./video-playback.ts";

describe("video review playback", () => {
  it("only marks a clip ready when it actually decoded", () => {
    assert.equal(
      isPlayableReady({ readyState: 1, videoWidth: 720, videoHeight: 1280, duration: 4 }),
      false,
    );
    assert.equal(
      isPlayableReady({ readyState: 3, videoWidth: 0, videoHeight: 0, duration: 4 }),
      false,
    );
    assert.equal(
      isPlayableReady({ readyState: 3, videoWidth: 720, videoHeight: 1280, duration: Number.NaN }),
      false,
    );
    assert.equal(
      isPlayableReady({ readyState: 3, videoWidth: 720, videoHeight: 1280, duration: 8.2 }),
      true,
    );
  });

  it("maps media errors to recovery copy", () => {
    assert.match(playbackErrorMessage(MEDIA_ERR_SRC_NOT_SUPPORTED), /isn’t supported/i);
    assert.match(playbackErrorMessage(2), /connection/i);
  });

  it("formats time and aspect without stretching", () => {
    assert.equal(formatTimecode(65), "1:05");
    assert.equal(videoAspectClass(1080, 1920), "portrait");
    assert.equal(videoAspectClass(1920, 1080), "landscape");
    assert.equal(videoAspectClass(1080, 1080), "square");
  });
});
