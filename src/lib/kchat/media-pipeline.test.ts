import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkCount,
  chunkRange,
  extractMessageLinks,
  formatEta,
  historyBucket,
  isMediaApiUrl,
  missingChunks,
  phaseLabel,
  uploadPct,
  uploadRecoveryMessage,
} from "./media-pipeline.ts";
import { createHash } from "node:crypto";

describe("chunked upload math", () => {
  it("plans chunks without loading the file", () => {
    assert.equal(chunkCount(0, 256), 1);
    assert.equal(chunkCount(256, 256), 1);
    assert.equal(chunkCount(257, 256), 2);
    assert.deepEqual(chunkRange(0, 500, 256), { start: 0, end: 256 });
    assert.deepEqual(chunkRange(1, 500, 256), { start: 256, end: 500 });
    assert.deepEqual(missingChunks(4, [0, 2]), [1, 3]);
    assert.equal(uploadPct(2, 4), 50);
  });

  it("checksums a known buffer", () => {
    const hex = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");
    assert.equal(hex(new Uint8Array([1, 2, 3, 4])).length, 64);
    assert.equal(hex(new Uint8Array([1, 2, 3, 4])), hex(new Uint8Array([1, 2, 3, 4])));
    assert.notEqual(hex(new Uint8Array([1, 2, 3, 4])), hex(new Uint8Array([1, 2, 3, 5])));
  });
});

describe("recovery copy", () => {
  it("never uses a generic upload-failed line", () => {
    assert.match(uploadRecoveryMessage({ phase: "uploading", online: false }), /resume/i);
    assert.match(uploadRecoveryMessage({ phase: "processing" }), /uploaded/i);
    assert.match(uploadRecoveryMessage({ phase: "publishing" }), /safe/i);
    assert.match(uploadRecoveryMessage({ phase: "failed", reason: "Video processing failed. Retry processing." }), /Retry processing/);
  });
});

describe("chat media index helpers", () => {
  it("extracts http(s) links and rejects javascript", () => {
    const links = extractMessageLinks("see https://nyx.app/p/1 and http://example.com/x.js please.");
    assert.equal(links[0]?.domain, "nyx.app");
    assert.equal(links.length, 2);
    assert.equal(extractMessageLinks("javascript:alert(1)").length, 0);
  });

  it("accepts assembled media URLs", () => {
    assert.equal(isMediaApiUrl("/api/media/up_abc"), true);
    assert.equal(isMediaApiUrl("data:video/webm;base64,xx"), false);
  });

  it("labels phases without claiming 100% during processing", () => {
    assert.equal(phaseLabel("processing"), "Processing");
    assert.equal(phaseLabel("ready"), "Ready to post");
    assert.equal(uploadPct(4, 4), 99);
    assert.match(formatEta(90), /1m/);
  });

  it("buckets chat history kinds including links and audio", () => {
    assert.equal(historyBucket("image", ""), "image");
    assert.equal(historyBucket("gif", ""), "image");
    assert.equal(historyBucket("video", ""), "video");
    assert.equal(historyBucket("audio", "clip.m4a"), "file");
    assert.equal(historyBucket("file", "notes.pdf"), "file");
    assert.equal(historyBucket("text", "read https://example.com/a"), "link");
    assert.equal(historyBucket("text", "hello"), null);
  });
});
