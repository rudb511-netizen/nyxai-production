import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMention, mentionAtCaret, splitRichTokens } from "./mention.ts";

describe("mentions", () => {
  it("highlights @names and #tags", () => {
    const parts = splitRichTokens("hey @Nova see #sunset");
    assert.equal(parts[1]?.type, "mention");
    assert.equal(parts[1]?.value, "@Nova");
    assert.equal(parts[3]?.type, "tag");
  });

  it("finds the @query at the caret", () => {
    const hit = mentionAtCaret("hello @no", 9);
    assert.ok(hit);
    assert.equal(hit!.query, "no");
  });

  it("opens the picker on a bare @", () => {
    const hit = mentionAtCaret("hey @", 5);
    assert.ok(hit);
    assert.equal(hit!.query, "");
  });

  it("highlights in-progress @names while typing", () => {
    const parts = splitRichTokens("hi @N more");
    assert.equal(parts[1]?.type, "mention");
    assert.equal(parts[1]?.value, "@N");
  });

  it("inserts a completed mention", () => {
    const r = applyMention("hello @no", 9, "nova");
    assert.equal(r.text, "hello @nova ");
  });

  it("highlights http(s) links without treating javascript as a link", () => {
    const parts = splitRichTokens("see https://nyx.app/p/1 please javascript:alert(1)");
    assert.equal(parts.some((p) => p.type === "link" && p.value === "https://nyx.app/p/1"), true);
    assert.equal(parts.some((p) => p.type === "link" && p.value.includes("javascript")), false);
  });
});
