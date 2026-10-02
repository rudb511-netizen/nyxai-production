import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProvider,
  cooldownMs,
  coolKey,
  failureKind,
  keyPoolStatus,
  resetKeyPool,
  selectKey,
  useKeySlots,
  type KeySlot,
} from "./api-keys.ts";

function slot(id: string, provider: KeySlot["provider"]): KeySlot {
  return { id, provider, secret: `secret-${id}`, cooldownUntil: 0, requests: 0, errors: 0, authBlocked: false };
}

describe("api key pool", () => {
  it("classifies provider from the key prefix", () => {
    assert.equal(classifyProvider("sk-or-v1-example"), "openrouter");
    assert.equal(classifyProvider("sk-proj-example"), "openai");
    assert.equal(classifyProvider("AQ.example"), "gemini");
    assert.equal(classifyProvider("your-key-here"), null);
  });

  it("rotates across healthy keys and skips a cooled-down key", () => {
    resetKeyPool();
    useKeySlots([slot("1", "openrouter"), slot("2", "openrouter"), slot("3", "openai")]);
    const first = selectKey(new Set());
    const second = selectKey(new Set());
    assert.equal(first?.id, "1");
    assert.equal(second?.id, "2");
    coolKey("2", cooldownMs("rate"));
    const excluded = new Set<string>();
    const next = selectKey(excluded);
    excluded.add(next!.id);
    const after = selectKey(excluded);
    assert.notEqual(next?.id, "2");
    assert.notEqual(after?.id, "2");
    assert.equal(keyPoolStatus().find((item) => item.id === "2")?.cooling, true);
    assert.equal(JSON.stringify(keyPoolStatus()).includes("secret"), false);
  });

  it("does not offer an excluded key again in the same request", () => {
    resetKeyPool();
    useKeySlots([slot("1", "openrouter"), slot("2", "openai")]);
    const seen = new Set<string>();
    const a = selectKey(seen);
    seen.add(a!.id);
    const b = selectKey(seen);
    seen.add(b!.id);
    assert.equal(selectKey(seen), null);
    assert.deepEqual([a?.id, b?.id].sort(), ["1", "2"]);
  });

  it("keeps an invalid key cooled longer than a rate limit", () => {
    assert.ok(cooldownMs("auth") > cooldownMs("rate"));
    assert.equal(failureKind(429, "rate limit exceeded"), "rate");
    assert.equal(failureKind(401, "invalid api key"), "auth");
    assert.equal(failureKind(503, "temporarily unavailable"), "temporary");
    assert.equal(failureKind(404, "model not found"), "model");
  });
});
