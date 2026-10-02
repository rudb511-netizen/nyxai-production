import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNyxDeepLink, closeOpenOverlay } from "./native-capabilities.ts";

describe("deep links", () => {
  it("maps nyx:// and https paths onto existing routes", () => {
    assert.equal(parseNyxDeepLink("nyx://u/alice"), "/u/alice");
    assert.equal(parseNyxDeepLink("nyx://profile/123"), "/u/123");
    assert.equal(parseNyxDeepLink("com.nyx.app://status/ss1"), "/status/ss1");
    assert.equal(parseNyxDeepLink("https://nyx.app/p/post1"), "/p/post1");
    assert.equal(parseNyxDeepLink("https://nyx.app/watch"), "/watch");
    assert.equal(parseNyxDeepLink("nyx://inbox/c1"), "/inbox/c1");
    assert.equal(parseNyxDeepLink("nyx://highlight/h1"), "/hl/h1");
    assert.equal(parseNyxDeepLink("nyx://list/l1"), "/lists/l1");
    assert.equal(parseNyxDeepLink("nyx://live/r1"), "/live/r1");
    assert.equal(parseNyxDeepLink("nyx://call/c9"), "/call/c9");
    assert.equal(parseNyxDeepLink("https://nyx.app/stickers"), "/stickers");
    assert.equal(parseNyxDeepLink("nyx://stickers/create"), "/stickers/create");
  });

  it("rejects unknown destinations", () => {
    assert.equal(parseNyxDeepLink("nyx://admin"), null);
    assert.equal(parseNyxDeepLink("https://evil.example/phish"), null);
    assert.equal(parseNyxDeepLink("javascript:alert(1)"), null);
    assert.equal(parseNyxDeepLink("file:///etc/passwd"), null);
    assert.equal(parseNyxDeepLink(""), null);
  });

  it("preserves query strings on allowed routes", () => {
    assert.equal(parseNyxDeepLink("https://nyx.app/discover?q=music"), "/discover?q=music");
  });
});

describe("overlay close", () => {
  it("is a no-op without a document", () => {
    assert.equal(closeOpenOverlay(null), false);
  });

  it("detects the full-screen media viewer", () => {
    const root = {
      querySelector(sel: string) {
        return /kc-lightbox|data-nyx-overlay/.test(sel) ? { id: "media" } : null;
      },
    };
    assert.equal(closeOpenOverlay(root as unknown as ParentNode), true);
  });
});
