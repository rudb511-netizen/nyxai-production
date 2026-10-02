import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  megapixels,
  readStillPixelSize,
  recommendedEnhanceScale,
  selectMaxPhotoSize,
  STILL_JPEG_QUALITY,
  STILL_MEMORY_CAP_PX,
} from "./camera-still.ts";

describe("still capture sizing", () => {
  it("picks the sensor's maximum still size", () => {
    const size = selectMaxPhotoSize({ min: 640, max: 4032 }, { min: 480, max: 3024 });
    assert.deepEqual(size, { width: 4032, height: 3024 });
    assert.equal(megapixels(4032, 3024), 12.2);
  });

  it("caps extreme still sizes for memory", () => {
    const size = selectMaxPhotoSize({ min: 1, max: 16000 }, { min: 1, max: 12000 }, STILL_MEMORY_CAP_PX);
    assert.ok(size);
    assert.ok(size.width * size.height <= STILL_MEMORY_CAP_PX);
    assert.ok(size.width > 1000);
  });

  it("returns null when the camera reports no still sizes", () => {
    assert.equal(selectMaxPhotoSize(null, null), null);
    assert.equal(selectMaxPhotoSize({ min: 0, max: 0 }, { min: 0, max: 0 }), null);
  });

  it("keeps JPEG quality at maximum when encoding is required", () => {
    assert.equal(STILL_JPEG_QUALITY, 1);
  });

  it("reads PNG pixel size from the file header", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    assert.deepEqual(readStillPixelSize(new Uint8Array(png)), { width: 1, height: 1 });
  });
});

describe("enhance scale", () => {
  it("skips already-huge stills on small devices", () => {
    assert.equal(recommendedEnhanceScale({ width: 4000, height: 3000, bytes: 4e6, deviceMemoryGb: 3, cores: 4 }), 0);
  });

  it("uses 2x on mid stills and 4x only on small stills with headroom", () => {
    assert.equal(recommendedEnhanceScale({ width: 1920, height: 1440, bytes: 9e5, deviceMemoryGb: 4, cores: 4 }), 2);
    assert.equal(recommendedEnhanceScale({ width: 1280, height: 960, bytes: 4e5, deviceMemoryGb: 8, cores: 8 }), 4);
  });
});
