import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySuperOmni, getModel, resolveModel, wantsImage } from "./omni-router.ts";

describe("resolveModel", () => {
  it("honors an explicit model", () => {
    assert.equal(resolveModel("coding", "chat", "hello").id, "coding");
  });

  it("picks research for live questions", () => {
    assert.equal(resolveModel("auto", "chat", "What's the latest news on Bitcoin?").id, "research");
  });

  it("picks research for a current price", () => {
    assert.equal(resolveModel("auto", "chat", "How much is Bitcoin worth today?").id, "research");
  });



  it("does not treat casual today as research", () => {
    assert.equal(resolveModel("auto", "chat", "What's on your mind today?").id, "fast");
  });

  it("picks coding for stack traces", () => {
    assert.equal(resolveModel("auto", "chat", "debug this typescript compile error").id, "coding");
  });

  it("picks reasoning for proofs", () => {
    assert.equal(resolveModel("auto", "chat", "prove why this architecture is better").id, "reasoning");
  });

  it("maps research mode even on auto", () => {
    assert.equal(resolveModel("auto", "research", "brief me on inflation").id, "research");
    assert.equal(resolveModel("auto", "research", "hello").id, "fast");
  });

  it("auto labels stay user-facing", () => {
    assert.equal(getModel("auto").label, "NYXAI Auto");
    assert.doesNotMatch(getModel("research").label, /grok|\bxai\b|chatgpt|claude|gemini/i);
  });
});

describe("wantsImage", () => {
  it("detects image requests", () => {
    assert.equal(wantsImage("generate an image of a mountain at dusk"), true);
    assert.equal(wantsImage("what is an image sensor"), false);
  });
});

describe("applySuperOmni", () => {
  it("raises reasoning and tokens without renaming provider models in research labels for free users", () => {
    const base = getModel("fast");
    const boosted = applySuperOmni(base, true);
    assert.equal(boosted.reasoning, "medium");
    assert.ok(boosted.maxTokens > base.maxTokens);
    assert.equal(applySuperOmni(base, false).maxTokens, base.maxTokens);
  });
});
