import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enhanceUnavailableMessage, pickSuperResolutionProvider } from "./super-resolution.ts";

describe("super-resolution provider", () => {
  it("prefers Real-ESRGAN when a Replicate token is configured", () => {
    assert.equal(
      pickSuperResolutionProvider({ replicateToken: "r8_", xaiKey: "xai-" }),
      "replicate-realesrgan",
    );
  });

  it("uses xAI Imagine when that is the available key", () => {
    assert.equal(pickSuperResolutionProvider({ replicateToken: "", xaiKey: "xai-" }), "xai-imagine");
  });

  it("does not pretend enhancement exists without a provider", () => {
    assert.equal(pickSuperResolutionProvider({}), "none");
    assert.match(enhanceUnavailableMessage("none"), /original photo is kept/i);
  });
});
