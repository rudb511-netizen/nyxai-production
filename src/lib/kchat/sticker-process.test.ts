import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeAnimatedGif,
  sniffBytes,
  sniffNameType,
} from "./sticker-process.ts";

describe("sticker media sniff", () => {
  it("reads magic bytes for photos, gifs, and videos", () => {
    const jpeg = sniffBytes(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), "", "");
    assert.deepEqual(jpeg, { kind: "image", mime: "image/jpeg" });
    const png = sniffBytes(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "", "");
    assert.deepEqual(png, { kind: "image", mime: "image/png" });
    const gif = sniffBytes(Uint8Array.from(Buffer.from("GIF89a")), "", "");
    assert.deepEqual(gif, { kind: "gif", mime: "image/gif" });
    const webp = new Uint8Array(12);
    webp.set(Buffer.from("RIFF"));
    webp.set(Buffer.from("WEBP"), 8);
    assert.deepEqual(sniffBytes(webp, "", ""), { kind: "image", mime: "image/webp" });
    const webm = sniffBytes(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0, 0), "", "");
    assert.deepEqual(webm, { kind: "video", mime: "video/webm" });
    const mp4 = new Uint8Array(12);
    mp4.set(Buffer.from("ftyp"), 4);
    mp4.set(Buffer.from("isom"), 8);
    assert.deepEqual(sniffBytes(mp4, "", ""), { kind: "video", mime: "video/mp4" });
    const heic = new Uint8Array(12);
    heic.set(Buffer.from("ftyp"), 4);
    heic.set(Buffer.from("heic"), 8);
    assert.deepEqual(sniffBytes(heic, "", ""), { kind: "image", mime: "image/heic" });
  });

  it("classifies empty MIME from gallery file names", () => {
    assert.deepEqual(sniffNameType("IMG_0001.HEIC", ""), { kind: "image", mime: "image/heic" });
    assert.deepEqual(sniffNameType("clip.MOV", ""), { kind: "video", mime: "video/quicktime" });
    assert.deepEqual(sniffNameType("dance.gif", ""), { kind: "gif", mime: "image/gif" });
    assert.deepEqual(sniffNameType("photo.JPG", ""), { kind: "image", mime: "image/jpeg" });
    assert.equal(sniffNameType("notes.txt", "text/plain"), null);
  });

  it("does not require a browser MIME on Android gallery files", () => {
    const jpeg = sniffBytes(Uint8Array.of(0xff, 0xd8, 0xff, 0xdb), "content", "");
    assert.equal(jpeg?.kind, "image");
    const gif = sniffBytes(Uint8Array.from(Buffer.from("GIF87a")), "content", "");
    assert.equal(gif?.kind, "gif");
  });
});

describe("animated gif encoder", () => {
  it("writes a looping GIF89a", () => {
    const a = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const b = new Uint8ClampedArray([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
    const bytes = encodeAnimatedGif(
      [
        { data: a, width: 2, height: 2 },
        { data: b, width: 2, height: 2 },
      ],
      { delayCs: 10, maxColors: 8 },
    );
    assert.equal(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!, bytes[5]!), "GIF89a");
    assert.ok(bytes.byteLength > 32);
    assert.equal(bytes[bytes.length - 1], 0x3b);
    const asStr = Buffer.from(bytes).toString("latin1");
    assert.ok(asStr.includes("NETSCAPE2.0"));
  });
});
