import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachEnhancement,
  audioConstraints,
  nextLowerTier,
  tierFromNetwork,
  usesNativeAecSendPath,
  videoConstraints,
} from "./call-audio.ts";

describe("call audio", () => {
  it("asks the capture device for AEC, NS, and AGC", () => {
    const c = audioConstraints("auto") as Record<string, unknown>;
    const echo = c.echoCancellation as { ideal?: boolean } | boolean;
    const ns = c.noiseSuppression as { ideal?: boolean } | boolean;
    const agc = c.autoGainControl as { ideal?: boolean } | boolean;
    assert.equal(typeof echo === "object" ? echo.ideal : echo, true);
    assert.equal(typeof ns === "object" ? ns.ideal : ns, true);
    assert.equal(typeof agc === "object" ? agc.ideal : agc, true);
    assert.equal(usesNativeAecSendPath(), true);
  });

  it("never substitutes a Web Audio destination for the send track", () => {
    const fake = { getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream;
    const r = attachEnhancement(fake, "noise");
    assert.equal(r.stream, fake);
  });

  it("steps video quality down instead of faking 4K", () => {
    assert.equal(nextLowerTier("4k"), "1440");
    assert.equal(tierFromNetwork("2g", 0.2), "480");
    assert.equal(tierFromNetwork("4g", 4), "1080");
    assert.equal(tierFromNetwork("4g", 24), "4k");
  });

  it("does not pin 1080p 16:9 on iOS", () => {
    const ios = videoConstraints({ facing: "user", tier: "1080", ios: true });
    assert.equal("width" in ios, false);
    assert.equal("height" in ios, false);
    const android = videoConstraints({ facing: "user", tier: "1080", ios: false });
    assert.equal((android.height as { ideal?: number }).ideal, 1080);
  });
});
