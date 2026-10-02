import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTrackZoom,
  cameraPreviewTransform,
  cameraVideoConstraints,
  clampZoom,
  DEFAULT_ZOOM,
  defaultNativeZoom,
  parseFacing,
  pinchZoom,
  pointerDistance,
  zoomCapsFromTrack,
  zoomPresets,
} from "./camera.ts";

describe("camera FOV + zoom", () => {
  it("never requests a 9:16 crop that zooms the sensor", () => {
    const c = cameraVideoConstraints("user");
    assert.deepEqual(c.facingMode, { ideal: "user" });
    assert.equal((c as { width?: unknown }).width, undefined);
    assert.equal((c as { height?: unknown }).height, undefined);
    assert.deepEqual(c.aspectRatio, { ideal: 3 / 4 });
  });

  it("parses facing and clamps pinch zoom", () => {
    assert.equal(parseFacing("environment"), "environment");
    assert.equal(parseFacing("nope"), "user");
    assert.equal(clampZoom(0.2, 1, 4), 1);
    assert.equal(clampZoom(9, 1, 4), 4);
    assert.equal(pinchZoom(1, 100, 200, 1, 3), 2);
    assert.equal(pinchZoom(1, 0, 200, 1, 3), DEFAULT_ZOOM);
    assert.equal(Math.round(pointerDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })), 5);
  });

  it("reads native zoom caps when present and falls back to digital 1–3x", () => {
    const native = zoomCapsFromTrack({
      getCapabilities: () => ({ zoom: { min: 1, max: 8 } }),
    });
    assert.deepEqual(native, { min: 1, max: 8, native: true });
    const digital = zoomCapsFromTrack({ getCapabilities: () => ({}) });
    assert.equal(digital.native, false);
    assert.equal(digital.max, 3);
  });

  it("defaults to true 1x even when the lens can go wider or tighter", () => {
    assert.equal(defaultNativeZoom({ min: 0.5, max: 8, native: true }), 1);
    assert.equal(defaultNativeZoom({ min: 1, max: 10, native: true }), 1);
    assert.equal(defaultNativeZoom({ min: 1.5, max: 5, native: true }), 1.5);
    assert.deepEqual(zoomPresets({ min: 1, max: 3, native: false }), [1, 2, 3]);
  });

  it("keeps front-camera mirroring when digital zoom is applied", () => {
    assert.equal(cameraPreviewTransform("user", 1), "scaleX(-1) scale(1)");
    assert.equal(cameraPreviewTransform("environment", 2), "scaleX(1) scale(2)");
  });

  it("applies native zoom through constraints when the track supports it", async () => {
    const applied: unknown[] = [];
    const ok = await applyTrackZoom(
      {
        applyConstraints: async (c) => {
          applied.push(c);
        },
      },
      1,
    );
    assert.equal(ok, true);
    assert.equal(applied.length, 1);
  });
});
