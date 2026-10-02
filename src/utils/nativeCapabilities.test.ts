import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeepLink, pinDelayMs, pinShapeOk, mediaSaveName } from "./nativeCapabilities.ts";

describe("native deep links", () => {
  it("maps custom schemes onto existing NYX routes", () => {
    assert.equal(parseDeepLink("nyx://u/alice"), "/u/alice");
    assert.equal(parseDeepLink("nyx://profile/123"), "/u/123");
    assert.equal(parseDeepLink("nyx://post/abc"), "/p/abc");
    assert.equal(parseDeepLink("nyx://chat/c1"), "/inbox/c1");
    assert.equal(parseDeepLink("nyx://message/c1"), "/inbox/c1");
    assert.equal(parseDeepLink("nyx://video"), "/watch");
    assert.equal(parseDeepLink("nyx://highlight/h1"), "/hl/h1");
    assert.equal(parseDeepLink("nyx://list/l1"), "/lists/l1");
    assert.equal(parseDeepLink("nyx://live/room1"), "/live/room1");
    assert.equal(parseDeepLink("nyx://call/c9"), "/call/c9");
    assert.equal(parseDeepLink("nyx://invite/x"), "/friends/x");
    assert.equal(parseDeepLink("com.nyx.app://status/ss1"), "/status/ss1");
    assert.equal(parseDeepLink("https://nyx.app/watch"), "/watch");
    assert.equal(parseDeepLink("https://www.nyx.app/p/abc"), "/p/abc");
    assert.equal(parseDeepLink("https://app.nyx.app/hl/h1"), "/hl/h1");
  });

  it("preserves query strings and rejects unsafe URLs", () => {
    assert.equal(parseDeepLink("https://nyx.app/discover?q=music"), "/discover?q=music");
    assert.equal(parseDeepLink("nyx://admin"), null);
    assert.equal(parseDeepLink("https://evil.example/phish"), null);
    assert.equal(parseDeepLink("javascript:alert(1)"), null);
    assert.equal(parseDeepLink("file:///etc/passwd"), null);
    assert.equal(parseDeepLink(""), null);
  });

  it("accepts a 4–6 digit PIN shape", () => {
    assert.equal(pinShapeOk("1234"), true);
    assert.equal(pinShapeOk("123456"), true);
    assert.equal(pinShapeOk("12"), false);
    assert.equal(pinShapeOk("12345678"), false);
    assert.equal(pinShapeOk("abcd"), false);
    assert.equal(pinDelayMs(1), 0);
    assert.equal(pinDelayMs(5), 30_000);
    assert.equal(pinDelayMs(8), 120_000);
    assert.equal(pinDelayMs(12), 300_000);
  });

  it("builds a safe save filename", () => {
    assert.equal(mediaSaveName("photo.jpg"), "photo.jpg");
    assert.equal(mediaSaveName("../etc/passwd"), ".._etc_passwd");
    assert.match(mediaSaveName(undefined, "image/png"), /\.png$/);
  });
});
