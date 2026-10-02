import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeTargets,
  ladderForSource,
  mentionsOmniAI,
  pickAdaptive,
  qualityFromHeight,
} from "./video-quality.ts";

describe("video quality", () => {
  it("labels from actual height and never invents 4K", () => {
    assert.equal(qualityFromHeight(720), "720p");
    assert.equal(qualityFromHeight(1080), "1080p");
    assert.equal(qualityFromHeight(2160), "4K");
    assert.equal(qualityFromHeight(4320), "8K");
    assert.equal(qualityFromHeight(480), "480p");
  });

  it("does not offer rungs taller than the source", () => {
    assert.deepEqual(
      ladderForSource(720).includes("4K"),
      false,
    );
    assert.equal(ladderForSource(720).includes("720p"), true);
    assert.equal(encodeTargets(720, 40).includes("4K"), false);
    assert.equal(encodeTargets(2160, 10).includes("1080p"), true);
  });

  it("picks a low rung on slow networks", () => {
    const rungs = [
      { quality: "360p" as const, height: 360 },
      { quality: "720p" as const, height: 720 },
    ];
    assert.equal(pickAdaptive(rungs, "3g"), "360p");
    assert.equal(pickAdaptive(rungs, "4g"), "720p");
  });

  it("detects @NYXAI mentions", () => {
    assert.equal(mentionsOmniAI("hey @omniai help"), true);
    assert.equal(mentionsOmniAI("hey @nyxai help"), true);
    assert.equal(mentionsOmniAI("email me@omniai.com"), false);
    assert.equal(mentionsOmniAI("@NYXAI"), true);
  });
});
