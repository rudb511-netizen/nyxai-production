import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { omniReply, parseOmniTail, buildOmniSystem, sanitizeOmniOutput, isMetaCommentary } from "./omni-ai.ts";

const BANNED =
  /that's the current request|got it —|a take:|not the vibe|i won'?t stall|i won'?t invent|which layer|tell me the outcome you want|start from the concrete/i;

describe("omniReply", () => {
  it("answers streaks without an API", () => {
    const r = omniReply("How do streaks work on NYX?");
    assert.equal(r.topic, "streaks");
    assert.match(r.text, /24-hour/i);
  });

  it("explains flashes / camera", () => {
    const r = omniReply("what is a flash?");
    assert.equal(r.topic, "flash");
    assert.match(r.text, /disappear/i);
  });

  it("drafts a post for free", () => {
    const r = omniReply("write a first post about sunrise");
    assert.equal(r.topic, "write-post");
    assert.match(r.text, /sunrise/i);
  });

  it("never mentions credits", () => {
    const r = omniReply("are you free?");
    assert.doesNotMatch(r.text, /credit|\bxai\b|subscription|paywall/i);
  });

  it("multiplies worded arithmetic", () => {
    const r = omniReply("What is 17 times 19?");
    assert.equal(r.topic, "math");
    assert.match(r.text, /323/);
    assert.doesNotMatch(r.text, /credit|paused|paywall|slogan|layer/i);
  });

  it("answers 25 × 25 directly", () => {
    const r = omniReply("What is 25 × 25?");
    assert.equal(r.topic, "math");
    assert.match(r.text, /^625$/);
  });

  it("answers country count without a template", () => {
    const r = omniReply("How many countries are there in the world?");
    assert.match(r.text, /195/);
    assert.doesNotMatch(r.text, BANNED);
  });

  it("explains blockchain directly", () => {
    const r = omniReply("Explain blockchain.");
    assert.match(r.text, /ledger|hash|bitcoin/i);
    assert.doesNotMatch(r.text, BANNED);
  });

  it("writes a python calculator", () => {
    const r = omniReply("Write me a Python calculator.");
    assert.match(r.text, /def calculate/);
    assert.match(r.text, /```python/);
  });

  it("answers the current request after a topic change", () => {
    const r = omniReply("Generate a picture of a car", [
      { role: "user", content: "I need dating advice about my crush" },
      { role: "assistant", content: "Say the true sentence, not the polished one." },
    ]);
    assert.equal(r.topic, "image");
    assert.doesNotMatch(r.text, /dating|crush|true sentence/i);
    assert.match(r.text, /image/i);
  });

  it("gives dating advice when asked", () => {
    const r = omniReply("I need dating advice about my crush");
    assert.match(r.text, /./);
    assert.doesNotMatch(r.text, /credit|paywall|slogan/i);
  });

  it("answers a fact without stalling", () => {
    const r = omniReply("What is photosynthesis?");
    assert.match(r.text, /chlorophyll|light|plant/i);
    assert.doesNotMatch(r.text, BANNED);
  });

  it("answers a new fact after dating without repeating dating", () => {
    const r = omniReply("What is photosynthesis?", [
      { role: "user", content: "I need dating advice about my crush" },
      { role: "assistant", content: "Say the true sentence, not the polished one." },
    ]);
    assert.match(r.text, /chlorophyll|light|plant/i);
    assert.doesNotMatch(r.text, /dating|crush|true sentence|still on that thread|last you said|i.m with you|which layer/i);
  });

  it("does not paste the previous assistant reply on a short follow-up", () => {
    const r = omniReply("ok", [
      { role: "user", content: "I need dating advice about my crush" },
      { role: "assistant", content: "Say the true sentence, not the polished one." },
    ]);
    assert.doesNotMatch(r.text, /Say the true sentence|Still on that thread|Last you said|I'm with you|Which layer/i);
  });

  it("answers hi without old context", () => {
    const r = omniReply("Hi", [
      { role: "user", content: "I need dating advice about my crush" },
      { role: "assistant", content: "Say the true sentence, not the polished one." },
    ]);
    assert.equal(r.topic, "hello");
    assert.doesNotMatch(r.text, /crush|true sentence/i);
    assert.match(r.text, /hey/i);
    assert.doesNotMatch(r.text, BANNED);
  });

  it("answers just-tell-me with the open question", () => {
    const r = omniReply("Just tell me.", [
      { role: "user", content: "How many countries are there in the world?" },
      { role: "assistant", content: "Got it — how many countries. That's the current request." },
    ]);
    assert.match(r.text, /195/);
    assert.doesNotMatch(r.text, BANNED);
  });

  it("treats you're-not-answering as answer-the-question", () => {
    const r = omniReply("You're not answering my question.", [
      { role: "user", content: "What is 25 × 25?" },
      { role: "assistant", content: "A take: start from the concrete part." },
    ]);
    assert.match(r.text, /625/);
    assert.doesNotMatch(r.text, BANNED);
  });

  it("continues the last topic on tell me more", () => {
    const r = omniReply("Tell me more.", [
      { role: "user", content: "How many countries are there in the world?" },
      { role: "assistant", content: "There are 195 widely recognized sovereign countries." },
    ]);
    assert.match(r.text, /193|UN|Palestine|Taiwan|Kosovo/i);
    assert.doesNotMatch(r.text, BANNED);
  });
});

describe("parseOmniTail", () => {
  it("splits tap replies", () => {
    const r = parseOmniTail("Hello there.\n>> one | two | three");
    assert.equal(r.text, "Hello there.");
    assert.deepEqual(r.prompts, ["one", "two", "three"]);
  });
});

describe("buildOmniSystem", () => {
  it("forbids credit and provider copy", () => {
    const s = buildOmniSystem({
      name: "NYXAI",
      personality: "friendly",
      custom: "",
      memories: [],
      mode: "chat",
      length: "medium",
      language: "English",
    });
    assert.match(s, /You are NYXAI, a friendly, helpful assistant/);
    assert.match(s, /Never mention API keys, credits/);
    assert.match(s, /Answer the latest user message first/i);
    assert.match(s, /maximally truth-seeking/);
    assert.match(s, /Never claim to be ChatGPT, Claude, Gemini, Perplexity, Grok/);
    assert.doesNotMatch(s, /I am Grok|You are Grok/);
    assert.doesNotMatch(s, /CURRENT REQUEST/);
    assert.doesNotMatch(s, /That's the current request/);
    assert.doesNotMatch(s, /A take/);
    assert.doesNotMatch(s, /not the vibe/);
    assert.doesNotMatch(s, /I won't stall/);
    assert.doesNotMatch(s, /tap-reply/);
    assert.doesNotMatch(s, /which layer/i);
  });
});

describe("sanitizeOmniOutput", () => {
  it("strips the old template", () => {
    const cleaned = sanitizeOmniOutput(
      "Got it — countries. That's the current request.\n\nA take: start from the concrete part of it, not the vibe.\n\nThere are 195 countries.",
    );
    assert.match(cleaned, /195/);
    assert.equal(isMetaCommentary(cleaned), false);
    assert.doesNotMatch(cleaned, BANNED);
  });
});