import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactHistory, detectIntent, extractExplicitMemory, isFollowUp, isTopicChange, needsWeb } from "./omni-intent.ts";

describe("detectIntent", () => {
  it("treats phone shopping as a recommendation", () => {
    const r = detectIntent("What phone should I buy?");
    assert.equal(r.intent, "recommend");
    assert.equal(r.needsWeb, false);
  });

  it("explains code as coding, not a web lookup", () => {
    const r = detectIntent("Explain this code.");
    assert.equal(r.intent, "code");
    assert.equal(r.needsWeb, false);
  });

  it("requires the web for latest news", () => {
    const r = detectIntent("Find the latest news about Bitcoin");
    assert.equal(r.intent, "search");
    assert.equal(r.needsWeb, true);
  });

  it("writes when asked to draft", () => {
    assert.equal(detectIntent("Help me write a birthday message").intent, "write");
  });

  it("compares products", () => {
    assert.equal(detectIntent("Compare these two products: iPhone and Pixel").intent, "compare");
  });

  it("does not treat a casual today as search", () => {
    const r = detectIntent("What's on your mind today?");
    assert.equal(r.intent, "chat");
    assert.equal(r.needsWeb, false);
  });

  it("looks up a current price", () => {
    const r = detectIntent("How much is Bitcoin worth today?");
    assert.equal(r.needsWeb, true);
  });

  it("treats generate a picture as image", () => {
    assert.equal(detectIntent("Generate a picture of a car").intent, "image");
    assert.equal(detectIntent("draw a sunset").intent, "image");
  });

  it("treats a video request as video, not an image", () => {
    assert.equal(detectIntent("Make a video of a red circle").intent, "video");
    assert.equal(detectIntent("a short clip of waves", "video").intent, "video");
  });

  it("treats what-is questions as explanations", () => {
    assert.equal(detectIntent("What is photosynthesis?").intent, "explain");
    assert.equal(detectIntent("What is 17 times 19?").intent, "math");
  });

  it("honors research mode for real queries, not greetings", () => {
    assert.equal(detectIntent("brief me on inflation with sources", "research").intent, "research");
    assert.equal(detectIntent("hello", "research").intent, "chat");
    assert.equal(detectIntent("hello", "research").needsWeb, false);
  });
});

describe("needsWeb", () => {
  it("is true for weather and sports", () => {
    assert.equal(needsWeb("weather in Lagos today"), true);
    assert.equal(needsWeb("who won the match yesterday"), true);
  });

  it("is false for stable knowledge", () => {
    assert.equal(needsWeb("What is photosynthesis?"), false);
  });
});

describe("extractExplicitMemory", () => {
  it("stores an explicit remember line", () => {
    const m = extractExplicitMemory("Remember that I prefer TypeScript");
    assert.ok(m);
    assert.match(m!.value, /TypeScript/);
  });

  it("refuses secrets", () => {
    assert.equal(extractExplicitMemory("Remember my password is hunter2"), null);
  });
});

describe("compactHistory", () => {
  it("keeps the tail and summarizes the rest", () => {
    const turns = Array.from({ length: 22 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `turn ${i}`,
    }));
    const c = compactHistory(turns, 6);
    assert.equal(c.recent.length, 6);
    assert.match(c.older, /turn 0/);
    assert.doesNotMatch(c.older, /turn 21/);
  });

  it("defaults to keeping about 20 recent turns", () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `turn ${i}`,
    }));
    const c = compactHistory(turns);
    assert.equal(c.recent.length, 20);
    assert.match(c.older, /turn 0/);
  });
});

describe("topic vs follow-up", () => {
  const dating = [
    { role: "user", content: "I need dating advice" },
    { role: "assistant", content: "Say the true sentence." },
  ];
  it("detects a topic change to image", () => {
    assert.equal(isTopicChange("Generate a picture of a car", dating), true);
    assert.equal(isFollowUp("Generate a picture of a car", dating), false);
  });
  it("treats yes as a follow-up", () => {
    assert.equal(isFollowUp("yes", dating), true);
    assert.equal(isTopicChange("yes", dating), false);
  });
  it("does not treat a new question as a follow-up", () => {
    assert.equal(isFollowUp("What is photosynthesis?", dating), false);
    assert.equal(isTopicChange("What is photosynthesis?", dating), true);
  });
});

describe("frustration and follow-ups", () => {
  const countries = [
    { role: "user", content: "How many countries are there in the world?" },
    { role: "assistant", content: "Got it — that's the current request." },
  ];
  it("does not treat just-tell-me as a topic change", () => {
    assert.equal(isTopicChange("Just tell me.", countries), false);
    assert.equal(isFollowUp("Just tell me.", countries), true);
  });
  it("treats you're-not-answering as a follow-up", () => {
    assert.equal(isTopicChange("You're not answering my question.", countries), false);
    assert.equal(isFollowUp("You're not answering my question.", countries), true);
  });
  it("keeps tell-me-more on the same topic", () => {
    assert.equal(isFollowUp("Tell me more.", countries), true);
    assert.equal(isTopicChange("Tell me more.", countries), false);
  });
  it("keeps what-do-you-mean on the same topic", () => {
    assert.equal(isFollowUp("What do you mean?", countries), true);
    assert.equal(isTopicChange("What do you mean?", countries), false);
  });
});
